import express from 'express'
import cors from 'cors'
import bodyParser from 'body-parser'
import fs from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'

import {
  getCatalogIndex,
  refreshCatalog,
  ensureCatalogLoaded,
  catalogReady,
  supabaseEnabled,
  getCatalogMeta,
  normalizeProductName
} from './catalogLoader.js'

// Ensure .env is loaded from the webapp root regardless of cwd
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env') })

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PROJECT_ROOT = path.join(__dirname, '..', '..')
const SYNC_SCRIPT = path.join(PROJECT_ROOT, 'sync_account.py')
const SCRAPE_SCRIPT = path.join(PROJECT_ROOT, 'scrape_account.py')
const CLIENT_DIST = path.join(__dirname, '..', 'dist')
const CLIENT_INDEX = path.join(CLIENT_DIST, 'index.html')
// Supabase client (server-side) for ingesting scraped items
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const SUPABASE_PRODUCTS_TABLE = process.env.SUPABASE_PRODUCTS_TABLE || 'products'  // Unified products table
const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : null
// Use virtualenv Python where Playwright is installed
const DEFAULT_VENV_PYTHON = path.resolve(__dirname, '../../AH/bin/python')
const PYTHON_CMD = process.env.PYTHON || (existsSync(DEFAULT_VENV_PYTHON) ? DEFAULT_VENV_PYTHON : 'python3')
const MAX_LOG_ENTRIES = 200
const CATALOG_REFRESH_INTERVAL_MS = Number.parseInt(process.env.CATALOG_REFRESH_INTERVAL_MS ?? '900000', 10) || 900000

const syncState = {
  running: false,
  startedAt: null,
  lastRun: null,
  logs: []
}

const scrapeState = {
  running: false,
  startedAt: null,
  lastRun: null,
  logs: []
}

function appendSyncLog(stream, chunk) {
  const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0)
  for (const line of lines) {
    syncState.logs.push({
      timestamp: new Date().toISOString(),
      stream,
      message: line
    })
  }
  if (syncState.logs.length > MAX_LOG_ENTRIES) {
    syncState.logs = syncState.logs.slice(syncState.logs.length - MAX_LOG_ENTRIES)
  }
}

function appendScrapeLog(stream, chunk) {
  const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0)
  for (const line of lines) {
    scrapeState.logs.push({
      timestamp: new Date().toISOString(),
      stream,
      message: line
    })
  }
  if (scrapeState.logs.length > MAX_LOG_ENTRIES) {
    scrapeState.logs = scrapeState.logs.slice(scrapeState.logs.length - MAX_LOG_ENTRIES)
  }
}

app.use(cors())
app.use(bodyParser.json({ limit: '2mb' }))

// ============================================================================
// HEALTH CHECK ENDPOINT (for Railway/deployment monitoring)
// ============================================================================
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development'
  })
})

// ============================================================================
// AH USER CHECK ENDPOINT (Email-based user lookup)
// Check if a user exists with the given email address
// Checks both user_ah_credentials and users tables for simpler login
// ============================================================================
app.get('/api/ah-user/check', async (req, res) => {
  try {
    const email = req.query.email
    
    if (!email) {
      return res.status(400).json({ error: 'missing_email', message: 'Email parameter is required' })
    }
    
    if (!supabase) {
      return res.status(500).json({ error: 'db_not_configured', message: 'Database not configured' })
    }
    
    const normalizedEmail = email.toLowerCase().trim()
    
    // First, check user_ah_credentials table (AH email)
    const { data: ahData } = await supabase
      .from('user_ah_credentials')
      .select('id, ah_email, last_sync_at, sync_status')
      .eq('ah_email', normalizedEmail)
      .single()
    
    if (ahData) {
      // Found in user_ah_credentials - get purchase count
      const { count } = await supabase
        .from('user_purchases')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', ahData.id)
      
      return res.json({
        exists: true,
        email: ahData.ah_email,
        lastSync: ahData.last_sync_at,
        syncStatus: ahData.sync_status,
        purchaseCount: count || 0
      })
    }
    
    // Second, check users table (main account email)
    const { data: userData } = await supabase
      .from('users')
      .select('id, email')
      .eq('email', normalizedEmail)
      .single()
    
    if (userData) {
      // Found in users table - check if they have linked AH credentials
      const { data: linkedAh } = await supabase
        .from('user_ah_credentials')
        .select('id, ah_email, last_sync_at, sync_status')
        .eq('user_id', userData.id)
        .single()
      
      if (linkedAh) {
        const { count } = await supabase
          .from('user_purchases')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', linkedAh.id)
        
        return res.json({
          exists: true,
          email: linkedAh.ah_email,
          lastSync: linkedAh.last_sync_at,
          syncStatus: linkedAh.sync_status,
          purchaseCount: count || 0
        })
      }
      
      // User exists but no AH link - still allow login (can connect later)
      return res.json({
        exists: true,
        email: userData.email,
        lastSync: null,
        syncStatus: 'not_connected',
        purchaseCount: 0
      })
    }
    
    // Not found in either table - auto-create user in user_ah_credentials for thesis participants
    // This ensures purchases can be linked correctly
    const { data: newUser, error: insertError } = await supabase
      .from('user_ah_credentials')
      .insert([{ 
        ah_email: normalizedEmail, 
        sync_status: 'pending',
        created_at: new Date().toISOString() 
      }])
      .select()
      .single()
    
    if (insertError) {
      console.error('Error auto-creating user:', insertError)
      return res.json({ 
        exists: false, 
        message: 'Could not create account. Please try again.' 
      })
    }
    
    console.log(`[Auth] Auto-created user ${newUser.id} for ${normalizedEmail}`)
    return res.json({
      exists: true,
      email: newUser.ah_email,
      lastSync: null,
      syncStatus: 'pending',
      purchaseCount: 0,
      isNew: true
    })
  } catch (err) {
    console.error('Error checking AH user:', err)
    res.status(500).json({ error: 'check_failed', message: err.message })
  }
})

// ============================================================================
// AH USER REGISTER ENDPOINT (Create new user with AH email)
// For new users who want to start tracking their sustainability
// ============================================================================
app.post('/api/ah-user/register', async (req, res) => {
  try {
    const { email } = req.body
    
    if (!email) {
      return res.status(400).json({ error: 'missing_email', message: 'Email is required' })
    }
    
    const normalizedEmail = email.toLowerCase().trim()
    
    if (!supabase) {
      return res.status(500).json({ error: 'db_not_configured', message: 'Database not configured' })
    }
    
    // Check if user already exists
    const { data: existing } = await supabase
      .from('user_ah_credentials')
      .select('id, ah_email')
      .eq('ah_email', normalizedEmail)
      .single()
    
    if (existing) {
      // User already exists, that's fine
      return res.json({ 
        success: true, 
        email: existing.ah_email,
        message: 'Account found. Welcome back!' 
      })
    }
    
    // Create new user
    const { data: newUser, error: insertError } = await supabase
      .from('user_ah_credentials')
      .insert([{
        ah_email: normalizedEmail,
        sync_status: 'pending',
        created_at: new Date().toISOString()
      }])
      .select()
      .single()
    
    if (insertError) {
      console.error('Error creating AH user:', insertError)
      return res.status(500).json({ error: 'create_failed', message: 'Could not create account' })
    }
    
    res.json({ 
      success: true, 
      email: newUser.ah_email,
      message: 'Account created! You can now sync your Albert Heijn purchases.' 
    })
  } catch (err) {
    console.error('Error registering AH user:', err)
    res.status(500).json({ error: 'register_failed', message: err.message })
  }
})

// ============================================================================
// PASSWORD-BASED AUTHENTICATION ENDPOINTS
// Simple email + password login for thesis participants
// ============================================================================

// Register new user with email and password
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password } = req.body
    
    if (!email || !password) {
      return res.status(400).json({ error: 'missing_fields', message: 'Email and password are required' })
    }
    
    if (password.length < 4) {
      return res.status(400).json({ error: 'password_too_short', message: 'Password must be at least 4 characters' })
    }
    
    const normalizedEmail = email.toLowerCase().trim()
    
    if (!supabase) {
      return res.status(500).json({ error: 'db_not_configured', message: 'Database not configured' })
    }
    
    // Check if user already exists
    const { data: existing } = await supabase
      .from('user_ah_credentials')
      .select('id, ah_email')
      .eq('ah_email', normalizedEmail)
      .single()
    
    if (existing) {
      return res.status(409).json({ 
        error: 'user_exists', 
        message: 'An account with this email already exists. Please login instead.' 
      })
    }
    
    // Hash password
    const passwordHash = await bcrypt.hash(password, 10)
    
    // Create new user with password
    const { data: newUser, error: insertError } = await supabase
      .from('user_ah_credentials')
      .insert([{
        ah_email: normalizedEmail,
        password_hash: passwordHash,
        sync_status: 'pending',
        created_at: new Date().toISOString()
      }])
      .select('id, ah_email')
      .single()
    
    if (insertError) {
      console.error('Error creating user:', insertError)
      return res.status(500).json({ error: 'create_failed', message: 'Could not create account' })
    }
    
    console.log(`[Auth] Registered new user: ${normalizedEmail}`)
    res.json({ 
      success: true, 
      email: newUser.ah_email,
      userId: newUser.id
    })
  } catch (err) {
    console.error('Error registering user:', err)
    res.status(500).json({ error: 'register_failed', message: err.message })
  }
})

// Login with email and password
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body
    
    if (!email || !password) {
      return res.status(400).json({ error: 'missing_fields', message: 'Email and password are required' })
    }
    
    const normalizedEmail = email.toLowerCase().trim()
    
    if (!supabase) {
      return res.status(500).json({ error: 'db_not_configured', message: 'Database not configured' })
    }
    
    // Find user
    const { data: user, error } = await supabase
      .from('user_ah_credentials')
      .select('id, ah_email, password_hash, sync_status, last_sync_at')
      .eq('ah_email', normalizedEmail)
      .single()
    
    if (error || !user) {
      return res.status(401).json({ 
        error: 'invalid_credentials', 
        message: 'Invalid email or password' 
      })
    }
    
    // Check if password_hash exists (legacy users might not have one)
    if (!user.password_hash) {
      return res.status(401).json({ 
        error: 'no_password', 
        message: 'This account does not have a password set. Please register again.' 
      })
    }
    
    // Verify password
    const isValid = await bcrypt.compare(password, user.password_hash)
    
    if (!isValid) {
      return res.status(401).json({ 
        error: 'invalid_credentials', 
        message: 'Invalid email or password' 
      })
    }
    
    // Get purchase count
    const { count } = await supabase
      .from('user_purchases')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
    
    console.log(`[Auth] User logged in: ${normalizedEmail}`)
    res.json({ 
      success: true, 
      email: user.ah_email,
      userId: user.id,
      syncStatus: user.sync_status,
      lastSync: user.last_sync_at,
      purchaseCount: count || 0
    })
  } catch (err) {
    console.error('Error logging in:', err)
    res.status(500).json({ error: 'login_failed', message: err.message })
  }
})

// ============================================================================
// BOOKMARKLET SCRIPT ROUTE
// Serve the bookmarklet.js with CORS for cross-origin loading from ah.nl
// ============================================================================
app.get('/bookmarklet.js', async (req, res) => {
  res.setHeader('Content-Type', 'application/javascript')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Cache-Control', 'no-cache')
  
  try {
    const bookmarkletPath = path.join(__dirname, '..', 'public', 'bookmarklet.js')
    const content = await fs.readFile(bookmarkletPath, 'utf-8')
    res.send(content)
  } catch (err) {
    res.status(404).send('// Bookmarklet not found')
  }
})

// ============================================================================
// USER AUTHENTICATION HELPER
// Extract user from Supabase JWT token in Authorization header
// ============================================================================
async function getUserFromRequest(req) {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return null
  }
  
  const token = authHeader.substring(7)
  if (!supabase) return null
  
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token)
    if (error || !user) return null
    return user
  } catch (err) {
    console.error('Auth error:', err.message)
    return null
  }
}

// Get or create a user ID from session ID (for anonymous users)
// Returns the user ID (UUID) from the user_ah_credentials table
async function getUserIdFromSession(req) {
  // First check for JWT auth
  const jwtUser = await getUserFromRequest(req)
  if (jwtUser) {
    console.log('[DEBUG] getUserIdFromSession: JWT user found:', jwtUser.id)
    return jwtUser.id
  }
  
  // Check for session ID header
  const sessionId = req.headers['x-session-id']
  console.log('[DEBUG] getUserIdFromSession: sessionId header:', sessionId, 'supabase:', !!supabase)
  if (!sessionId || !supabase) {
    console.log('[DEBUG] getUserIdFromSession: No session ID or no supabase, returning null')
    return null
  }
  
  console.log('[DEBUG] Looking up user by session ID:', sessionId)
  
  try {
    // Try to find existing user by session_id
    const { data: existing, error: findError } = await supabase
      .from('user_ah_credentials')
      .select('id')
      .eq('session_id', sessionId)
      .maybeSingle()
    
    if (findError) {
      console.error('[ERROR] Error looking up session:', findError.message)
      return null
    }
    
    if (existing) {
      console.log('[DEBUG] Found existing user for session:', existing.id)
      return existing.id
    }
    
    // Create new anonymous user
    const newId = crypto.randomUUID()
    console.log('[DEBUG] Creating new session user with id:', newId)
    const { error: insertError } = await supabase
      .from('user_ah_credentials')
      .insert({
        id: newId,
        session_id: sessionId,
        ah_email: null
        // Don't set sync_status - let database use default
      })
    
    if (insertError) {
      console.error('[ERROR] Error creating session user:', insertError.message)
      return null
    }
    
    console.log('[DEBUG] Created new user for session:', newId)
    return newId
  } catch (err) {
    console.error('[ERROR] Session lookup error:', err.message)
    return null
  }
}

// Get ALL user IDs associated with this request (both JWT and session)
// This helps when a user was previously session-based and is now JWT authenticated
async function getAllUserIds(req) {
  const userIds = []
  
  // Get JWT user ID
  const jwtUser = await getUserFromRequest(req)
  if (jwtUser) {
    userIds.push(jwtUser.id)
  }
  
  // Also get session-based user ID if present
  const sessionId = req.headers['x-session-id']
  if (sessionId && supabase) {
    const { data: sessionUser } = await supabase
      .from('user_ah_credentials')
      .select('id')
      .eq('session_id', sessionId)
      .maybeSingle()
    
    if (sessionUser && !userIds.includes(sessionUser.id)) {
      userIds.push(sessionUser.id)
    }
  }
  
  return userIds
}

// Middleware to require authentication (supports both JWT and session-based auth)
function requireAuth(req, res, next) {
  getUserFromRequest(req).then(user => {
    if (user) {
      req.user = user
      return next()
    }
    
    // Fallback: check for session-based auth
    return getUserIdFromSession(req).then(sessionUserId => {
      if (!sessionUserId) {
        return res.status(401).json({ error: 'unauthorized', message: 'Please log in to access this resource' })
      }
      // Create a pseudo-user object for session-based users
      req.user = { id: sessionUserId, session_based: true }
      next()
    })
  }).catch(err => {
    res.status(500).json({ error: 'auth_error', message: err.message })
  })
}

// ============================================================================
// EMAIL-BASED USER IDENTIFICATION (Simple auth for thesis participants)
// Users are identified by their AH email address - no password/login needed
// ============================================================================

/**
 * Look up a user by their email address.
 * Checks both user_ah_credentials.ah_email AND users.email tables.
 * Returns the user_id if found, null otherwise.
 */
async function getUserIdByAHEmail(ahEmail) {
  if (!supabase || !ahEmail) return null
  
  const normalizedEmail = ahEmail.toLowerCase().trim()
  
  try {
    // First, check user_ah_credentials table (AH-specific email)
    // Note: Use 'id' column as the user identifier (not 'user_id' which may be null)
    const { data: credData, error: credError } = await supabase
      .from('user_ah_credentials')
      .select('id, ah_email')
      .eq('ah_email', normalizedEmail)
      .single()
    
    if (!credError && credData) {
      console.log(`[Auth] Found user ${credData.id} via user_ah_credentials for ${normalizedEmail}`)
      return credData.id
    }
    
    // Second, check users table (main account email)
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('id, email')
      .eq('email', normalizedEmail)
      .single()
    
    if (!userError && userData) {
      console.log(`[Auth] Found user ${userData.id} via users table for ${normalizedEmail}`)
      return userData.id
    }
    
    console.log(`[Auth] No user found for email: ${normalizedEmail}`)
    return null
  } catch (err) {
    console.error('Error looking up user by AH email:', err.message)
    return null
  }
}

/**
 * Middleware for email-based authentication.
 * Checks X-AH-Email header and looks up the corresponding user_id.
 * Falls back to JWT auth if no email header is present.
 */
function requireAHEmail(req, res, next) {
  const ahEmail = req.headers['x-ah-email']
  
  if (ahEmail) {
    // Email-based auth
    getUserIdByAHEmail(ahEmail).then(userId => {
      if (!userId) {
        return res.status(401).json({ 
          error: 'user_not_found', 
          message: 'No account found for this email. Please connect your Albert Heijn account first.' 
        })
      }
      // Create a minimal user object with the user_id
      req.user = { id: userId, email: ahEmail }
      next()
    }).catch(err => {
      res.status(500).json({ error: 'auth_error', message: err.message })
    })
  } else {
    // Fall back to JWT auth for backwards compatibility
    getUserFromRequest(req).then(user => {
      if (!user) {
        return res.status(401).json({ error: 'unauthorized', message: 'Please provide your AH email or log in' })
      }
      req.user = user
      next()
    }).catch(err => {
      res.status(500).json({ error: 'auth_error', message: err.message })
    })
  }
}

// ============================================================================
// PRODUCT NAME EXTRACTION HELPER
// Consistently extract product ID and name from AH URLs
// ============================================================================
const GENERIC_PRODUCT_NAMES = new Set([
  'premium', 'biologisch', 'bio', 'nederlands', 'holland', 'fresh',
  'nieuw', 'new', 'sale', 'aanbieding', 'bonus', 'actie'
])

/**
 * Convert a relative AH URL to an absolute URL
 * @param {string} url - The URL (may be relative or absolute)
 * @returns {string|null} - Absolute URL or null
 */
function makeAbsoluteAhUrl(url) {
  if (!url) return null
  if (url.startsWith('http')) return url
  return `https://www.ah.nl${url.startsWith('/') ? '' : '/'}${url}`
}

/**
 * Extract product ID and display name from an AH product URL.
 * Falls back to original name if URL parsing fails.
 * 
 * @param {string} url - The product URL
 * @param {string} originalName - The original product name from scraper
 * @returns {{ id: string | null, name: string, normalized: string }}
 */
function extractProductFromUrl(url, originalName) {
  const name = (originalName || '').toString().trim()
  const normalized = normalizeProductName(name)
  
  if (!url) {
    // No URL - use name as fallback
    if (normalized && normalized.length > 2) {
      return {
        id: `ah-${normalized.replace(/\s+/g, '-').toLowerCase()}`,
        name,
        normalized
      }
    }
    return { id: null, name, normalized }
  }
  
  try {
    const u = new URL(url)
    
    // Strategy 1: /producten/product/<wi...>/<slug> format
    const match1 = u.pathname.match(/\/producten\/product\/[^/]+\/([^/?#]+)/)
    if (match1 && match1[1]) {
      const slug = match1[1].toLowerCase()
      if (/^[a-z0-9-]+$/.test(slug) && slug.length > 2) {
        let displayName = slug.replace(/-/g, ' ')
        displayName = displayName.replace(/\b[a-z]/g, c => c.toUpperCase())
        return {
          id: slug,
          name: name || displayName,
          normalized: normalizeProductName(slug.replace(/-/g, ' '))
        }
      }
    }
    
    // Strategy 2: /wi/<id>/<slug> format
    const match2 = u.pathname.match(/\/wi\/([^/]+)\/([^/?#]+)/)
    if (match2) {
      const wiId = match2[1]
      const slug = match2[2].toLowerCase()
      if (slug.length > 2) {
        let displayName = slug.replace(/-/g, ' ')
        displayName = displayName.replace(/\b[a-z]/g, c => c.toUpperCase())
        return {
          id: `wi-${wiId}-${slug}`.substring(0, 100),  // Keep it reasonably short
          name: name || displayName,
          normalized: normalizeProductName(slug.replace(/-/g, ' '))
        }
      }
    }
    
    // Strategy 3: Just /wi/<id> format
    const match3 = u.pathname.match(/\/wi\/([^/?#]+)/)
    if (match3 && match3[1]) {
      const wiId = match3[1]
      return {
        id: `wi-${wiId}`,
        name: name || `Product ${wiId}`,
        normalized: normalized || wiId
      }
    }
    
    // Strategy 4: Any URL with a slug at the end
    const pathParts = u.pathname.split('/').filter(p => p.length > 2)
    if (pathParts.length > 0) {
      const lastPart = pathParts[pathParts.length - 1]
      const cleanSlug = lastPart.toLowerCase().replace(/[^a-z0-9-]/g, '')
      if (cleanSlug.length > 3) {
        let displayName = cleanSlug.replace(/-/g, ' ')
        displayName = displayName.replace(/\b[a-z]/g, c => c.toUpperCase())
        return {
          id: `ah-${cleanSlug}`.substring(0, 100),
          name: name || displayName,
          normalized: normalizeProductName(cleanSlug.replace(/-/g, ' '))
        }
      }
    }
  } catch (_) {
    // URL parsing failed
  }
  
  // Fallback: use original name
  if (normalized && normalized.length > 2) {
    return {
      id: `ah-${normalized.replace(/\s+/g, '-').toLowerCase()}`.substring(0, 100),
      name,
      normalized
    }
  }
  
  return { id: null, name, normalized }
}

// Data file path - DEPRECATED: Now using Supabase for all purchases
// const DATA_FILE = path.join(__dirname, 'purchases.json')

// Sustainability database
const SUSTAINABILITY_DB = {
  categories: {
    organic: { score: 10, icon: '🌱' },
    local: { score: 8, icon: '🏡' },
    plant_based: { score: 9, icon: '🥬' },
    fair_trade: { score: 8, icon: '🤝' },
    plastic_free: { score: 7, icon: '♻️' },
    meat: { score: 2, icon: '🥩' },
    processed: { score: 3, icon: '📦' },
    imported: { score: 4, icon: '✈️' },
    fruit: { score: 5, icon: '🍎' },
    vegetable: { score: 5, icon: '🥕' },
    dairy: { score: 5, icon: '🥛' },
    grain: { score: 5, icon: '🌾' },
    legume: { score: 5, icon: '🫘' },
    plant_protein: { score: 5, icon: '🌿' },
    snack: { score: 5, icon: '🍫' },
    beverage: { score: 5, icon: '🥤' },
    egg: { score: 5, icon: '🥚' },
    seafood: { score: 5, icon: '🐟' }
  },
  products: {
    'bio melk': { categories: ['organic', 'local'], co2: 1.2 },
    'gewone melk': { categories: ['local'], co2: 1.5 },
    havermelk: { categories: ['plant_based'], co2: 0.3 },
    sojamelk: { categories: ['plant_based'], co2: 0.4 },
    amandelmelk: { categories: ['plant_based'], co2: 0.7 },
    rundvlees: { categories: ['meat'], co2: 27.0 },
    kip: { categories: ['meat'], co2: 6.9 },
    varkensvlees: { categories: ['meat'], co2: 12.1 },
    tofu: { categories: ['plant_based'], co2: 2.0 },
    tempeh: { categories: ['plant_based'], co2: 2.0 },
    'bananen fair trade': { categories: ['fair_trade'], co2: 0.7 },
    bananen: { categories: ['imported'], co2: 0.7 },
    appels: { categories: ['local'], co2: 0.3 },
    tomaten: { categories: ['local'], co2: 0.7 },
    brood: { categories: ['local'], co2: 0.6 },
    pasta: { categories: ['processed'], co2: 1.0 },
    rijst: { categories: ['imported'], co2: 2.7 }
  }
}

const CATEGORY_KEYS = new Set(Object.keys(SUSTAINABILITY_DB.categories))

const KEYWORD_RULES = [
  { code: 'keyword_bio', delta: 2, match: (name) => name.includes('bio') || name.includes('organic') },
  { code: 'keyword_fair', delta: 2, match: (name) => name.includes('fair trade') },
  { code: 'keyword_local', delta: 1, match: (name) => name.includes('lokaal') || name.includes('local') || name.includes('nederland') || name.includes('hollands') },
  { code: 'keyword_plant', delta: 2, match: (name) => name.includes('plantaardig') || name.includes('vegan') || name.includes('vega ') || name.includes('soja') || name.includes('tofu') || name.includes('havermelk') || name.includes('terra ') },
  // NOTE: Meat keyword penalties are applied ONLY when enriched data is NOT available AND the name doesn't indicate plant-based
  { code: 'keyword_meat', delta: -3, match: (name) => name.includes('vlees') || name.includes('beef') || name.includes('rund') || name.includes('kip') || name.includes('meat'), excludeIf: (name) => name.includes('plantaardig') || name.includes('vegan') || name.includes('terra') || name.includes('vega') },
  { code: 'keyword_plastic', delta: -1, match: (name) => name.includes('plastic') || name.includes('verpakt') }
]

// Helper to check if a product name indicates plant-based despite having meat-like words
function isLikelyPlantBased(name) {
  const lower = (name || '').toLowerCase()
  const plantIndicators = ['plantaardig', 'vegan', 'veganist', 'terra', 'beyond', 'impossible', 'vega ']
  return plantIndicators.some(indicator => lower.includes(indicator))
}

// Helper to check if a product name indicates organic/bio certification
function isLikelyOrganic(name) {
  const lower = (name || '').toLowerCase()
  const organicIndicators = ['biologisch', 'biologische', ' bio ', 'bio-', 'eko-', 'organic']
  // Also check if name starts with 'bio ' or ends with ' bio'
  return organicIndicators.some(indicator => lower.includes(indicator)) ||
         lower.startsWith('bio ') || lower.endsWith(' bio')
}

// ============================================================================
// ENRICHED FIELD SCORING RULES
// These use scraped product detail data for more accurate scoring
// ============================================================================

const ENRICHED_SCORING = {
  // Dietary preferences
  is_vegan: { delta: 3, icon: '🌱', label: 'Vegan' },
  is_vegetarian: { delta: 1, icon: '🥗', label: 'Vegetarian' },  // Only if not vegan
  is_organic: { delta: 2, icon: '🌿', label: 'Organic/Bio' },
  
  // Ethical certifications
  is_fairtrade: { delta: 2, icon: '🤝', label: 'Fairtrade' },
  
  // NOTE: Nutri-Score is scraped and stored but NOT used for sustainability scoring
  // Reason: Nutri-Score measures nutritional health, not environmental sustainability
  
  // Origin scoring based on transport distance:
  // NL only: +2 (regional/local)
  // EU countries: +1 (short transport)
  // Near non-EU (Mediterranean/Africa): -1
  // Far overseas: -2
  origin_country: {
    // Netherlands (regional, best)
    'Netherlands': { delta: 2, region: 'local' },
    // EU countries (+1)
    'Belgium': { delta: 1, region: 'europe' },
    'Germany': { delta: 1, region: 'europe' },
    'France': { delta: 1, region: 'europe' },
    'Spain': { delta: 1, region: 'europe' },
    'Italy': { delta: 1, region: 'europe' },
    'Poland': { delta: 1, region: 'europe' },
    'Greece': { delta: 1, region: 'europe' },
    'Portugal': { delta: 1, region: 'europe' },
    'Austria': { delta: 1, region: 'europe' },
    'Ireland': { delta: 1, region: 'europe' },
    'Denmark': { delta: 1, region: 'europe' },
    'Sweden': { delta: 1, region: 'europe' },
    'Hungary': { delta: 1, region: 'europe' },
    'Czech Republic': { delta: 1, region: 'europe' },
    'Romania': { delta: 1, region: 'europe' },
    'Bulgaria': { delta: 1, region: 'europe' },
    'Croatia': { delta: 1, region: 'europe' },
    'Slovenia': { delta: 1, region: 'europe' },
    'Slovakia': { delta: 1, region: 'europe' },
    'Lithuania': { delta: 1, region: 'europe' },
    'Latvia': { delta: 1, region: 'europe' },
    'Estonia': { delta: 1, region: 'europe' },
    'Finland': { delta: 1, region: 'europe' },
    'Luxembourg': { delta: 1, region: 'europe' },
    'Cyprus': { delta: 1, region: 'europe' },
    'Malta': { delta: 1, region: 'europe' },
    // Near non-EU (Mediterranean/Middle East/Africa) - moderate transport
    'Morocco': { delta: -1, region: 'mediterranean' },
    'Turkey': { delta: -1, region: 'mediterranean' },
    'Egypt': { delta: -1, region: 'africa' },
    'South Africa': { delta: -1, region: 'africa' },
    'Kenya': { delta: -1, region: 'africa' },
    'Israel': { delta: -1, region: 'mediterranean' },
    'Tunisia': { delta: -1, region: 'mediterranean' },
    'UK': { delta: -1, region: 'nearby' },
    'United Kingdom': { delta: -1, region: 'nearby' },
    'Norway': { delta: -1, region: 'nearby' },
    'Switzerland': { delta: -1, region: 'nearby' },
    // Far overseas (-2)
    'United States': { delta: -2, region: 'americas' },
    'Brazil': { delta: -2, region: 'americas' },
    'Argentina': { delta: -2, region: 'americas' },
    'Chile': { delta: -2, region: 'americas' },
    'Costa Rica': { delta: -2, region: 'americas' },
    'Ecuador': { delta: -2, region: 'americas' },
    'Colombia': { delta: -2, region: 'americas' },
    'Peru': { delta: -2, region: 'americas' },
    'Mexico': { delta: -2, region: 'americas' },
    'China': { delta: -2, region: 'asia' },
    'India': { delta: -2, region: 'asia' },
    'Thailand': { delta: -2, region: 'asia' },
    'Vietnam': { delta: -2, region: 'asia' },
    'Indonesia': { delta: -2, region: 'asia' },
    'Philippines': { delta: -2, region: 'asia' },
    'Malaysia': { delta: -2, region: 'asia' },
    'Sri Lanka': { delta: -2, region: 'asia' },
    'Pakistan': { delta: -2, region: 'asia' },
    'Bangladesh': { delta: -2, region: 'asia' },
    'Australia': { delta: -2, region: 'oceania' },
    'New Zealand': { delta: -2, region: 'oceania' }
  }
}

// Month abbreviations for origin_by_month lookups
const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/**
 * Get the current month key for origin_by_month lookup
 * @returns {string} Current month as 3-letter lowercase key (e.g., 'jan', 'feb')
 */
function getCurrentMonthKey() {
  const now = new Date()
  return MONTH_KEYS[now.getMonth()]
}

/**
 * Get the origin country for the current month from origin_by_month data
 * @param {Object} originByMonth - JSONB object with monthly origins (values can be strings or arrays)
 * @returns {string|null} - Country name for current month, or null if not available
 */
function getOriginForCurrentMonth(originByMonth) {
  if (!originByMonth || typeof originByMonth !== 'object') return null
  const monthKey = getCurrentMonthKey()
  const monthOrigin = originByMonth[monthKey]
  if (!monthOrigin) return null
  // Handle both array format (["Netherlands", "Spain"]) and string format ("Netherlands")
  if (Array.isArray(monthOrigin)) {
    return monthOrigin[0] || null  // Return first country in the list
  }
  return monthOrigin
}

// ============================================================================
// USER PROFILING SYSTEM
// Analyzes purchase patterns to understand user preferences
// ============================================================================

const USER_PROFILE_TYPES = {
  'plant_forward': { 
    label: '🌱 Plant-Forward Shopper', 
    description: 'You prioritize plant-based foods. Great for sustainability!',
    tips: ['Keep exploring new plant proteins', 'Try seasonal local vegetables']
  },
  'balanced': { 
    label: '⚖️ Balanced Shopper', 
    description: 'You have a varied diet with room for sustainable swaps.',
    tips: ['Consider swapping 1-2 meat meals per week', 'Try organic versions of your favorites']
  },
  'meat_heavy': { 
    label: '🥩 Protein-Focused Shopper', 
    description: 'Your cart is protein-heavy. Small swaps can make a big difference!',
    tips: ['Try chicken instead of beef (4x less CO2)', 'Explore legumes as protein sources']
  },
  'convenience': { 
    label: '📦 Convenience Shopper', 
    description: 'You favor processed/ready foods. Fresh alternatives can boost your score.',
    tips: ['Try batch cooking on weekends', 'Fresh produce has higher sustainability scores']
  },
  'eco_champion': {
    label: '🏆 Eco Champion',
    description: 'Amazing! You\'re already making excellent sustainable choices.',
    tips: ['Share your habits with friends', 'Try reducing packaging waste next']
  }
}

// Product category detection for profiling
const PRODUCT_CATEGORIES_PROFILE = {
  meat: {
    keywords: ['vlees', 'beef', 'rund', 'kip', 'varken', 'ham', 'spek', 'worst', 'gehakt', 'biefstuk', 'chicken', 'meat', 'pork', 'bacon'],
    weight: -2
  },
  plant_protein: {
    keywords: ['tofu', 'tempeh', 'seitan', 'vega', 'plantaardi', 'beyond', 'impossible', 'linzen', 'kikkererwt', 'bonen'],
    weight: 2
  },
  dairy: {
    keywords: ['melk', 'kaas', 'yoghurt', 'boter', 'room', 'cheese', 'milk', 'butter'],
    weight: 0
  },
  plant_dairy: {
    keywords: ['havermelk', 'sojamelk', 'amandelmelk', 'kokosmelk', 'oat milk', 'soy milk', 'plantaardig'],
    weight: 2
  },
  organic: {
    keywords: ['bio', 'biologisch', 'organic', 'eko'],
    weight: 2
  },
  processed: {
    keywords: ['kant-en-klaar', 'diepvries', 'pizza', 'lasagne', 'nuggets', 'kroket', 'snack', 'chips'],
    weight: -1
  },
  fresh_produce: {
    keywords: ['appel', 'peer', 'banaan', 'tomaat', 'komkommer', 'sla', 'spinazie', 'wortel', 'groente', 'fruit'],
    weight: 1
  }
}

/**
 * Analyze user's purchase history to build a profile
 */
function analyzeUserProfile(purchases) {
  const profile = {
    totalProducts: purchases.length,
    categoryBreakdown: {},
    scoreDistribution: { low: 0, medium: 0, high: 0 },
    avgScore: 0,
    profileType: 'balanced',
    improvements: [],
    strengths: []
  }

  if (!purchases || purchases.length === 0) {
    return profile
  }

  let totalScore = 0
  const categoryCounts = {}
  const lowScoreProducts = []
  const highScoreProducts = []

  for (const purchase of purchases) {
    const name = (purchase.product_name || '').toLowerCase()
    const evaluation = evaluateProduct(purchase.product_name)
    const score = evaluation.score
    totalScore += score

    if (score <= 4) {
      profile.scoreDistribution.low++
      lowScoreProducts.push({ name: purchase.product_name, score, evaluation })
    } else if (score <= 6) {
      profile.scoreDistribution.medium++
    } else {
      profile.scoreDistribution.high++
      highScoreProducts.push({ name: purchase.product_name, score })
    }

    for (const [category, data] of Object.entries(PRODUCT_CATEGORIES_PROFILE)) {
      if (data.keywords.some(kw => name.includes(kw))) {
        // Don't count as meat if it's a plant-based product
        if (category === 'meat' && isLikelyPlantBased(name)) {
          categoryCounts['plant_protein'] = (categoryCounts['plant_protein'] || 0) + 1
          continue
        }
        categoryCounts[category] = (categoryCounts[category] || 0) + 1
      }
    }
  }

  profile.avgScore = totalScore / purchases.length
  profile.categoryBreakdown = categoryCounts

  const meatCount = categoryCounts.meat || 0
  const plantProteinCount = categoryCounts.plant_protein || 0
  const organicCount = categoryCounts.organic || 0
  const processedCount = categoryCounts.processed || 0
  const totalCount = purchases.length

  const meatRatio = meatCount / totalCount
  const plantRatio = plantProteinCount / totalCount
  const processedRatio = processedCount / totalCount

  if (profile.avgScore >= 7.5) {
    profile.profileType = 'eco_champion'
  } else if (meatRatio > 0.25) {
    profile.profileType = 'meat_heavy'
  } else if (plantRatio > 0.15 || organicCount > totalCount * 0.2) {
    profile.profileType = 'plant_forward'
  } else if (processedRatio > 0.3) {
    profile.profileType = 'convenience'
  } else {
    profile.profileType = 'balanced'
  }

  profile.improvements = lowScoreProducts.sort((a, b) => a.score - b.score).slice(0, 5)
  profile.strengths = highScoreProducts.sort((a, b) => b.score - a.score).slice(0, 3)

  return profile
}

/**
 * Find sustainable replacement suggestions from the product catalog
 */
function findReplacementSuggestions(lowScoreProducts, catalogProducts) {
  const suggestions = []

  for (const product of lowScoreProducts) {
    const name = (product.name || '').toLowerCase()
    let alternatives = []

    // Meat → Plant protein replacements
    if (PRODUCT_CATEGORIES_PROFILE.meat.keywords.some(kw => name.includes(kw))) {
      alternatives = catalogProducts.filter(p => {
        const pName = (p.name || '').toLowerCase()
        return PRODUCT_CATEGORIES_PROFILE.plant_protein.keywords.some(kw => pName.includes(kw))
      }).slice(0, 3)
    }
    // Dairy → Plant dairy replacements
    else if (PRODUCT_CATEGORIES_PROFILE.dairy.keywords.some(kw => name.includes(kw))) {
      alternatives = catalogProducts.filter(p => {
        const pName = (p.name || '').toLowerCase()
        return PRODUCT_CATEGORIES_PROFILE.plant_dairy.keywords.some(kw => pName.includes(kw))
      }).slice(0, 3)
    }
    // Non-organic → Organic version
    else if (!PRODUCT_CATEGORIES_PROFILE.organic.keywords.some(kw => name.includes(kw))) {
      const baseTokens = name.split(/\s+/).filter(t => t.length > 2)
      alternatives = catalogProducts.filter(p => {
        const pName = (p.name || '').toLowerCase()
        const isBio = PRODUCT_CATEGORIES_PROFILE.organic.keywords.some(kw => pName.includes(kw))
        const hasSimilarTokens = baseTokens.some(t => pName.includes(t))
        return isBio && hasSimilarTokens
      }).slice(0, 2)
    }

    if (alternatives.length > 0) {
      const bestAlt = alternatives[0]
      const altScore = evaluateProduct(bestAlt.name).score
      const improvement = altScore - product.score

      if (improvement > 0) {
        suggestions.push({
          original: { name: product.name, score: product.score },
          replacement: {
            name: bestAlt.name,
            score: altScore,
            url: makeAbsoluteAhUrl(bestAlt.url),
            image_url: bestAlt.image_url,
            price: bestAlt.price
          },
          improvement,
          reason: getReplacementReason(product.name, bestAlt.name)
        })
      }
    }
  }

  return suggestions.sort((a, b) => b.improvement - a.improvement).slice(0, 6)
}

/**
 * Generate a human-readable reason for a replacement suggestion
 */
function getReplacementReason(originalName, replacementName) {
  const orig = originalName.toLowerCase()
  const repl = replacementName.toLowerCase()

  if (PRODUCT_CATEGORIES_PROFILE.meat.keywords.some(kw => orig.includes(kw)) &&
      PRODUCT_CATEGORIES_PROFILE.plant_protein.keywords.some(kw => repl.includes(kw))) {
    return '🌱 Plant-based alternative - up to 90% less CO2'
  }
  if (PRODUCT_CATEGORIES_PROFILE.dairy.keywords.some(kw => orig.includes(kw)) &&
      PRODUCT_CATEGORIES_PROFILE.plant_dairy.keywords.some(kw => repl.includes(kw))) {
    return '🥛 Plant-based dairy - 75% less emissions'
  }
  if (!PRODUCT_CATEGORIES_PROFILE.organic.keywords.some(kw => orig.includes(kw)) &&
      PRODUCT_CATEGORIES_PROFILE.organic.keywords.some(kw => repl.includes(kw))) {
    return '🌱 Organic version - better for soil & biodiversity'
  }
  return '✨ More sustainable choice'
}

// Helper functions (DEPRECATED: These were for local file storage, now using Supabase)
// Kept for reference but no longer used
// async function loadPurchases() { ... }
// async function savePurchases(purchases) { ... }

function roundClamp(value) {
  return Math.max(0, Math.min(10, Math.round(value)))
}

function clamp(value) {
  return Math.max(0, Math.min(10, value))
}

function findCatalogMatch(productName = '') {
  const normalized = normalizeProductName(productName)
  if (!normalized) return null

  const catalogIndex = getCatalogIndex()
  let bestEntry = null
  let bestRank = 0
  let bestMatchName = null

  // Common Dutch stop words to ignore in token matching
  const stopWords = new Set(['de', 'het', 'een', 'en', 'van', 'in', 'met', 'voor', 'op', 'te', 'aan', 'is', 'dat', 'die', 'er'])

  for (const entry of catalogIndex) {
    for (const candidate of entry.normalizedNames) {
      if (!candidate) continue
      let rank = 0
      if (candidate === normalized) {
        rank = 5
      } else if (candidate.startsWith(normalized) || normalized.startsWith(candidate)) {
        rank = 4
      } else if (candidate.includes(normalized) || normalized.includes(candidate)) {
        rank = 3
      } else {
        // Filter out stop words and very short tokens for matching
        const tokens = normalized.split(' ').filter(t => t.length >= 3 && !stopWords.has(t))
        if (tokens.length > 1 && tokens.every((token) => candidate.includes(token))) {
          rank = 2
        } else if (tokens.some((token) => token && candidate.includes(token))) {
          rank = Math.max(rank, 1)
        }
      }

      if (rank > bestRank) {
        bestRank = rank
        bestEntry = entry
        bestMatchName = candidate
      }
    }
  }

  if (!bestEntry) return null

  return {
    entry: bestEntry,
    matchedName: bestMatchName,
    rank: bestRank,
    normalizedQuery: normalized
  }
}

function evaluateProduct(productName = '', enrichedData = null, lang = 'nl') {
  const input = typeof productName === 'string' ? productName : ''
  const normalized = normalizeProductName(input)
  const lowerProduct = input.toLowerCase()
  let workingScore = 5
  const adjustments = []
  const matchedCategories = []
  const matchedKeywords = []
  const matchedEnriched = []  // Track enriched field matches
  const categorySet = new Set()
  let suggestions = getSuggestions(input, lang)
  let notes = null
  let matchedProduct = null

  const applyCategory = (category, skipScoring = false) => {
    if (!category || categorySet.has(category) || !CATEGORY_KEYS.has(category)) return
    categorySet.add(category)
    const catData = SUSTAINABILITY_DB.categories[category]
    if (catData) {
      matchedCategories.push({
        category,
        icon: catData.icon,
        referenceScore: catData.score
      })
      // Skip scoring adjustment if flagged (e.g., organic category when enriched data is used)
      if (skipScoring) return
      const delta = catData.score - 5
      if (delta) {
        workingScore += delta
        adjustments.push({
          type: 'category',
          code: `category_${category}`,
          category,
          delta,
          resultingScore: clamp(workingScore)
        })
      }
    }
  }

  const applyDelta = (type, code, delta) => {
    if (!delta) return
    workingScore += delta
    adjustments.push({
      type,
      code,
      delta,
      resultingScore: clamp(workingScore)
    })
  }

  const catalogMatch = findCatalogMatch(input)
  if (catalogMatch) {
    const { entry } = catalogMatch
    matchedProduct = {
      id: entry.id,
      canonicalName: entry.names[0],
      matchedName: catalogMatch.matchedName,
      rank: catalogMatch.rank,
      baseScore: entry.baseScore ?? 5
    }

    if (entry.notes) {
      notes = entry.notes
    }

    // Note: We no longer override suggestions from catalog entries
    // because getSuggestions() already handles i18n translations

    // Only apply catalog-based scoring if the product is NOT plant-based
    // (Avoid penalizing "plantaardige gehakt" as meat)
    const skipMeatScoring = (enrichedData?.is_vegan === true) ||
                            (enrichedData?.is_vegetarian === true) ||
                            isLikelyPlantBased(input)

    // Apply base score delta only if it's not a meat penalty for plant-based products
    const baseDelta = (entry.baseScore ?? 5) - 5
    const isMeatCatalog = Array.isArray(entry.categories) && entry.categories.includes('meat')
    if (baseDelta && !(skipMeatScoring && isMeatCatalog)) {
      applyDelta('catalog', 'catalog_base', baseDelta)
    }

    if (Array.isArray(entry.categories)) {
      for (const category of entry.categories) {
        // Skip meat category if product is known/likely plant-based
        if (category === 'meat' && skipMeatScoring) {
          continue
        }
        // Skip category scoring if enriched data is available (avoid double scoring)
        // enriched data is more accurate than hardcoded categories
        const skipScoring = 
          (category === 'organic' && enrichedData?.is_organic === true) ||
          (category === 'local' && (enrichedData?.origin_country || enrichedData?.origin_by_month)) ||
          (category === 'fair_trade' && enrichedData?.is_fairtrade === true)
        applyCategory(category, skipScoring)
      }
    }

    if (Array.isArray(entry.adjustments)) {
      for (const adj of entry.adjustments) {
        if (!adj || typeof adj.delta !== 'number') continue
        // Skip meat-related trait adjustments for plant-based products
        // These traits are only relevant for actual animal products
        const meatRelatedTraits = ['trait_high_methane', 'trait_high_emissions', 'trait_animal_welfare', 'trait_meat']
        if (skipMeatScoring && isMeatCatalog && meatRelatedTraits.includes(adj.code)) {
          continue
        }
        applyDelta('catalog', adj.code, adj.delta)
      }
    }
  }

  const productData = SUSTAINABILITY_DB.products[normalized] || SUSTAINABILITY_DB.products[lowerProduct]
  if (productData && Array.isArray(productData.categories)) {
    for (const category of productData.categories) {
      // Skip meat category if product is known/likely plant-based
      if (category === 'meat' && (
        (enrichedData?.is_vegan === true) ||
        (enrichedData?.is_vegetarian === true) ||
        isLikelyPlantBased(input)
      )) {
        continue  // Skip meat penalty for plant-based products
      }
      // Skip category scoring if enriched data is available (avoid double scoring)
      const skipScoring = 
        (category === 'organic' && enrichedData?.is_organic === true) ||
        (category === 'local' && (enrichedData?.origin_country || enrichedData?.origin_by_month)) ||
        (category === 'fair_trade' && enrichedData?.is_fairtrade === true)
      applyCategory(category, skipScoring)
    }
  }

  // Apply keyword rules (with exclusion logic to prevent double-scoring)
  for (const rule of KEYWORD_RULES) {
    if (rule.match(lowerProduct)) {
      // Check if this rule should be excluded for plant-based products
      if (rule.excludeIf && rule.excludeIf(lowerProduct)) {
        continue  // Skip this rule
      }
      // Skip meat keywords if we have enriched data showing vegan/vegetarian
      if (rule.code === 'keyword_meat' && (
        enrichedData?.is_vegan === true ||
        enrichedData?.is_vegetarian === true
      )) {
        continue
      }
      // Skip bio/organic keyword if we have enriched is_organic data (avoid double scoring)
      if (rule.code === 'keyword_bio' && enrichedData?.is_organic === true) {
        continue
      }
      // Skip local keyword if we have enriched origin data (avoid double scoring)
      if (rule.code === 'keyword_local' && (enrichedData?.origin_country || enrichedData?.origin_by_month)) {
        continue
      }
      // Skip fair trade keyword if we have enriched is_fairtrade data (avoid double scoring)
      if (rule.code === 'keyword_fair' && enrichedData?.is_fairtrade === true) {
        continue
      }
      applyDelta('keyword', rule.code, rule.delta)
      matchedKeywords.push(rule.code)
    }
  }

  // Apply enriched data scoring (from scraped product details)
  if (enrichedData && typeof enrichedData === 'object') {
    // Vegan scoring (highest plant-based bonus)
    if (enrichedData.is_vegan === true) {
      const scoring = ENRICHED_SCORING.is_vegan
      applyDelta('enriched', 'enriched_vegan', scoring.delta)
      matchedEnriched.push({ code: 'vegan', icon: scoring.icon, label: scoring.label, delta: scoring.delta })
    } 
    // Vegetarian scoring (only if not vegan to avoid double counting)
    else if (enrichedData.is_vegetarian === true) {
      const scoring = ENRICHED_SCORING.is_vegetarian
      applyDelta('enriched', 'enriched_vegetarian', scoring.delta)
      matchedEnriched.push({ code: 'vegetarian', icon: scoring.icon, label: scoring.label, delta: scoring.delta })
    }

    // Organic/Bio scoring
    if (enrichedData.is_organic === true) {
      const scoring = ENRICHED_SCORING.is_organic
      applyDelta('enriched', 'enriched_organic', scoring.delta)
      matchedEnriched.push({ code: 'organic', icon: scoring.icon, label: scoring.label, delta: scoring.delta })
    }

    // Fairtrade scoring
    if (enrichedData.is_fairtrade === true) {
      const scoring = ENRICHED_SCORING.is_fairtrade
      applyDelta('enriched', 'enriched_fairtrade', scoring.delta)
      matchedEnriched.push({ code: 'fairtrade', icon: scoring.icon, label: scoring.label, delta: scoring.delta })
    }

    // NOTE: Nutri-Score is NOT included in sustainability scoring
    // It's still scraped and stored as a data point, but doesn't affect the score
    // Reason: Nutri-Score measures nutritional health, not environmental impact

    // Origin country scoring (local vs imported)
    // Check monthly origin first (origin_by_month), then fall back to static origin_country
    let effectiveOrigin = null
    let isSeasonalOrigin = false
    
    if (enrichedData.origin_by_month) {
      effectiveOrigin = getOriginForCurrentMonth(enrichedData.origin_by_month)
      isSeasonalOrigin = effectiveOrigin !== null
    }
    
    // Fall back to static origin if no monthly origin available
    if (!effectiveOrigin && enrichedData.origin_country) {
      effectiveOrigin = enrichedData.origin_country
    }
    
    if (effectiveOrigin) {
      const originScoring = ENRICHED_SCORING.origin_country[effectiveOrigin]
      const monthLabel = isSeasonalOrigin ? ` (${getCurrentMonthKey().toUpperCase()})` : ''
      
      if (originScoring) {
        if (originScoring.delta !== 0) {
          applyDelta('enriched', `enriched_origin_${originScoring.region}`, originScoring.delta)
          matchedEnriched.push({ 
            code: `origin_${originScoring.region}`, 
            icon: originScoring.delta > 0 ? '📍' : '✈️', 
            label: `Origin: ${effectiveOrigin}${monthLabel}`, 
            delta: originScoring.delta,
            country: effectiveOrigin,
            region: originScoring.region,
            isSeasonal: isSeasonalOrigin,
            originByMonth: enrichedData.origin_by_month
          })
        }
      } else {
        // Unknown country - apply slight negative for uncertainty
        applyDelta('enriched', 'enriched_origin_unknown', -0.5)
        matchedEnriched.push({ 
          code: 'origin_unknown', 
          icon: '🌍', 
          label: `Origin: ${effectiveOrigin}${monthLabel} (unknown region)`, 
          delta: -0.5,
          country: effectiveOrigin,
          isSeasonal: isSeasonalOrigin
        })
      }
    }
  }

  const rawScore = clamp(workingScore)
  const finalScore = roundClamp(workingScore)

  return {
    product: input,
    normalized,
    baseScore: matchedProduct?.baseScore ?? 5,
    rawScore,
    score: finalScore,
    adjustments,
    categories: matchedCategories,
    keywords: matchedKeywords,
    enriched: matchedEnriched,  // Include enriched data matches
    suggestions,
    rating: getRating(finalScore),
    notes,
    matched: matchedProduct,
    hasEnrichedData: enrichedData !== null && matchedEnriched.length > 0
  }
}

function calculateScore(productName) {
  return evaluateProduct(productName).score
}

/**
 * Extract enriched data from a product database record for use in evaluateProduct
 * @param {Object} product - Product record from database
 * @returns {Object|null} - Enriched data object or null if no enriched data available
 */
function getEnrichedData(product) {
  if (!product) return null
  
  // Check if product has any enriched fields
  // Use != null to treat undefined and null the same (both = no data)
  const hasEnrichedData = 
    product.is_vegan != null || 
    product.is_vegetarian != null || 
    product.is_organic != null || 
    product.is_fairtrade != null ||
    product.nutri_score != null || 
    product.origin_country != null ||
    product.origin_by_month != null
  
  if (!hasEnrichedData) return null
  
  return {
    is_vegan: product.is_vegan,
    is_vegetarian: product.is_vegetarian,
    is_organic: product.is_organic,
    is_fairtrade: product.is_fairtrade,
    nutri_score: product.nutri_score,
    origin_country: product.origin_country,
    origin_by_month: product.origin_by_month,
    brand: product.brand,
    allergens: product.allergens,
    details_scraped_at: product.details_scraped_at
  }
}

/**
 * Evaluate a product with automatic enriched data extraction
 * @param {string} productName - Product name
 * @param {Object} productRecord - Optional database record with enriched fields
 * @returns {Object} - Evaluation result
 */
function evaluateProductWithRecord(productName, productRecord = null) {
  const enrichedData = getEnrichedData(productRecord)
  return evaluateProduct(productName, enrichedData)
}

function searchProducts(query = '') {
  const normalized = normalizeProductName(query)
  if (!normalized) return []

  const catalogIndex = getCatalogIndex()
  const results = []
  const seen = new Set()

  for (const entry of catalogIndex) {
    let bestRank = 0
    for (const candidate of entry.normalizedNames) {
      if (!candidate) continue
      let rank = 0
      if (candidate === normalized) {
        rank = 5
      } else if (candidate.startsWith(normalized) || normalized.startsWith(candidate)) {
        rank = 4
      } else if (candidate.includes(normalized) || normalized.includes(candidate)) {
        rank = 3
      } else {
        const tokens = normalized.split(' ')
        if (tokens.length > 1 && tokens.every((token) => candidate.includes(token))) {
          rank = 2
        } else if (tokens.some((token) => token && candidate.includes(token))) {
          rank = Math.max(rank, 1)
        }
      }
      if (rank > bestRank) {
        bestRank = rank
      }
    }

    if (bestRank > 0 && !seen.has(entry.id)) {
      const displayName = entry.names[0]
      const evalResult = evaluateProduct(displayName)
      results.push({
        name: displayName,
        score: evalResult.score,
        categories: entry.categories || [],
        rank: bestRank,
        id: entry.id
      })
      seen.add(entry.id)
    }
  }

  if (results.length === 0) {
    for (const name of Object.keys(SUSTAINABILITY_DB.products)) {
      const candidate = normalizeProductName(name)
      if (!candidate.includes(normalized)) continue
      const evalResult = evaluateProduct(name)
      results.push({
        name,
        score: evalResult.score,
        categories: SUSTAINABILITY_DB.products[name].categories || [],
        rank: 1,
        id: `legacy-${name}`
      })
    }
  }

  results.sort((a, b) => {
    if (b.rank !== a.rank) return b.rank - a.rank
    if (b.score !== a.score) return b.score - a.score
    return a.name.localeCompare(b.name)
  })

  return results.slice(0, 10)
}

function getSuggestions(productName, lang = 'nl') {
  const suggestions = []
  const lowerProduct = productName.toLowerCase()

  const i18n = {
    nl: {
      oat_milk: '🥬 Probeer havermelk of sojamelk - 75% minder CO2!',
      tofu: '🥬 Probeer tofu of tempeh - 90% minder CO2!',
      plant_chicken: '🥬 Probeer plantaardige kip alternatieven',
      bio: '🌱 Zoek naar biologische of Fair Trade varianten',
      packaging: '♻️ Kies voor producten met minder verpakking',
      great_choice: 'Geweldig! Je maakt al een goede keuze! ✨'
    },
    en: {
      oat_milk: '🥬 Try oat milk or soy milk - 75% less CO2!',
      tofu: '🥬 Try tofu or tempeh - 90% less CO2!',
      plant_chicken: '🥬 Try plant-based chicken alternatives',
      bio: '🌱 Look for organic or Fair Trade options',
      packaging: '♻️ Choose products with less packaging',
      great_choice: 'Great! You\'re already making a good choice! ✨'
    }
  }

  const t = i18n[lang] || i18n.nl

  if ((lowerProduct.includes('melk') || lowerProduct.includes('milk')) && !lowerProduct.includes('haver') && !lowerProduct.includes('soja')) {
    suggestions.push(t.oat_milk)
  }

  if (lowerProduct.includes('vlees') || lowerProduct.includes('beef') || lowerProduct.includes('rund')) {
    suggestions.push(t.tofu)
  }

  if (lowerProduct.includes('kip') || lowerProduct.includes('chicken')) {
    suggestions.push(t.plant_chicken)
  }

  if (!lowerProduct.includes('bio') && !lowerProduct.includes('organic') && !lowerProduct.includes('fair')) {
    suggestions.push(t.bio)
  }

  if (lowerProduct.includes('plastic') || lowerProduct.includes('verpakt')) {
    suggestions.push(t.packaging)
  }

  return suggestions.length > 0 ? suggestions : [t.great_choice]
}

function getRating(avgScore) {
  if (avgScore >= 8) return "🌟 Excellent! You're making great sustainable choices!"
  if (avgScore >= 6) return '👍 Good! Room for improvement though.'
  if (avgScore >= 4) return '😐 Average. Consider more sustainable alternatives.'
  return "⚠️ Needs work. Let's find better options!"
}

function minutes(ms) {
  return Math.round(ms / 60000)
}

// ============================================================================
// USER API ROUTES
// ============================================================================

// Get current user profile
app.get('/api/user/profile', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', req.user.id)
      .single()
    
    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: 'fetch_failed', message: err.message })
  }
})

// Update user profile
app.patch('/api/user/profile', requireAuth, async (req, res) => {
  try {
    const { display_name } = req.body
    const { data, error } = await supabase
      .from('users')
      .update({ display_name })
      .eq('id', req.user.id)
      .select()
      .single()
    
    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: 'update_failed', message: err.message })
  }
})

// Get user's AH credentials status (not the actual credentials)
app.get('/api/user/ah-credentials', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('user_ah_credentials')
      .select('id, ah_email, cookies_updated_at, last_sync_at, sync_status, created_at')
      .eq('user_id', req.user.id)
      .single()
    
    if (error && error.code !== 'PGRST116') throw error  // PGRST116 = no rows
    res.json(data || { configured: false })
  } catch (err) {
    res.status(500).json({ error: 'fetch_failed', message: err.message })
  }
})

// Save user's AH credentials
app.post('/api/user/ah-credentials', requireAuth, async (req, res) => {
  try {
    const { ah_email, cookies } = req.body
    
    // Encrypt cookies before storing (simple encryption, consider Supabase Vault for production)
    const encryptionKey = process.env.COOKIES_ENCRYPTION_KEY || 'default-key-change-in-production'
    const iv = crypto.randomBytes(16)
    const cipher = crypto.createCipheriv('aes-256-cbc', crypto.scryptSync(encryptionKey, 'salt', 32), iv)
    let encrypted = cipher.update(JSON.stringify(cookies), 'utf8', 'hex')
    encrypted += cipher.final('hex')
    const cookies_encrypted = iv.toString('hex') + ':' + encrypted
    
    const { data, error } = await supabase
      .from('user_ah_credentials')
      .upsert({
        user_id: req.user.id,
        ah_email,
        cookies_encrypted,
        cookies_updated_at: new Date().toISOString()
      }, { onConflict: 'user_id' })
      .select('id, ah_email, cookies_updated_at, last_sync_at, sync_status')
      .single()
    
    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: 'save_failed', message: err.message })
  }
})

// Save user's AH email and password for scraping (encrypted)
app.post('/api/user/ah-credentials/password', requireAuth, async (req, res) => {
  try {
    const { ah_email, ah_password } = req.body
    
    if (!ah_email || !ah_password) {
      return res.status(400).json({ error: 'missing_credentials', message: 'Both email and password are required' })
    }
    
    // Encrypt password before storing
    const encryptionKey = process.env.COOKIES_ENCRYPTION_KEY || 'default-key-change-in-production'
    const iv = crypto.randomBytes(16)
    const cipher = crypto.createCipheriv('aes-256-cbc', crypto.scryptSync(encryptionKey, 'salt', 32), iv)
    let encrypted = cipher.update(ah_password, 'utf8', 'hex')
    encrypted += cipher.final('hex')
    const password_encrypted = iv.toString('hex') + ':' + encrypted
    
    const { data, error } = await supabase
      .from('user_ah_credentials')
      .upsert({
        user_id: req.user.id,
        ah_email: ah_email,
        ah_password_encrypted: password_encrypted,
        cookies_updated_at: new Date().toISOString(),
        sync_status: 'success'
      }, { onConflict: 'user_id' })
      .select('id, ah_email, cookies_updated_at, last_sync_at, sync_status')
      .single()
    
    if (error) throw error
    res.json({ success: true, message: 'Credentials saved. An admin will run the scrape for you.', credentials: data })
  } catch (err) {
    console.error('Error saving AH credentials:', err)
    res.status(500).json({ error: 'save_failed', message: err.message })
  }
})

// Get user's purchase history
app.get('/api/user/purchases', requireAHEmail, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500)
    const offset = parseInt(req.query.offset) || 0
    
    const { data, error, count } = await supabase
      .from('user_purchases')
      .select('*', { count: 'exact' })
      .eq('user_id', req.user.id)
      .order('scraped_at', { ascending: false })
      .range(offset, offset + limit - 1)
    
    if (error) throw error
    res.json({ purchases: data, total: count, limit, offset })
  } catch (err) {
    res.status(500).json({ error: 'fetch_failed', message: err.message })
  }
})

// Get user's purchase summary/stats
app.get('/api/user/purchases/summary', requireAHEmail, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('user_purchase_summary')
      .select('*')
      .eq('user_id', req.user.id)
      .single()
    
    if (error && error.code !== 'PGRST116') throw error
    res.json(data || { total_purchases: 0, unique_products: 0, total_spent: 0 })
  } catch (err) {
    res.status(500).json({ error: 'fetch_failed', message: err.message })
  }
})

// Delete a specific purchase
app.delete('/api/user/purchases/:id', requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from('user_purchases')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
    
    if (error) throw error
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: 'delete_failed', message: err.message })
  }
})

// Add a manual purchase for authenticated user
app.post('/api/user/purchases', requireAuth, async (req, res) => {
  try {
    const { product, quantity, price } = req.body
    
    if (!product || typeof product !== 'string' || product.trim().length === 0) {
      return res.status(400).json({ error: 'missing_product', message: 'Product name is required' })
    }
    
    const evaluation = evaluateProduct(product)
    
    const purchase = {
      user_id: req.user.id,
      product_name: product.trim(),
      quantity: parseInt(quantity) || 1,
      price: parseFloat(price) || 0,
      scraped_at: new Date().toISOString(),
      source: 'manual'
    }
    
    const { data, error } = await supabase
      .from('user_purchases')
      .insert([purchase])
      .select()
      .single()
    
    if (error) throw error
    
    res.json({ 
      success: true, 
      purchase: {
        ...data,
        product: data.product_name, // for backward compatibility with frontend
        sustainability_score: evaluation.score // Calculate on the fly for response
      }
    })
  } catch (err) {
    console.error('Error adding user purchase:', err)
    res.status(500).json({ error: 'add_failed', message: err.message })
  }
})

// Get user's purchase insights/dashboard data
app.get('/api/user/insights', requireAHEmail, async (req, res) => {
  try {
    // Get all user IDs (JWT + session-based) to merge purchases
    const userIds = await getAllUserIds(req)
    console.log('[Insights] Fetching for user IDs:', userIds)
    
    if (userIds.length === 0) {
      return res.json({ message: 'No purchases yet!' })
    }
    
    const { data: purchases, error } = await supabase
      .from('user_purchases')
      .select('product_name, quantity, price')
      .in('user_id', userIds)
    
    if (error) throw error
    
    if (!purchases || purchases.length === 0) {
      return res.json({ message: 'No purchases yet!' })
    }
    
    // Calculate sustainability scores on the fly
    const purchasesWithScores = purchases.map(p => ({
      ...p,
      sustainability_score: evaluateProduct(p.product_name).score
    }))
    
    const totalScore = purchasesWithScores.reduce((sum, p) => sum + (p.sustainability_score || 0), 0)
    const avgScore = totalScore / purchasesWithScores.length
    
    const best = purchasesWithScores.reduce((max, p) => 
      ((p.sustainability_score || 0) > (max.sustainability_score || 0) ? p : max), purchasesWithScores[0])
    const worst = purchasesWithScores.reduce((min, p) => 
      ((p.sustainability_score || 0) < (min.sustainability_score || 0) ? p : min), purchasesWithScores[0])
    
    res.json({
      total_purchases: purchasesWithScores.length,
      average_score: avgScore,
      rating: getRating(avgScore),
      best_purchase: best.product_name,
      worst_purchase: worst.product_name,
      total_spent: purchasesWithScores.reduce((sum, p) => sum + (p.price || 0), 0)
    })
  } catch (err) {
    console.error('Error fetching user insights:', err)
    res.status(500).json({ error: 'fetch_failed', message: err.message })
  }
})

// Get user's purchase rank history - shows how products moved in purchase order over time
app.get('/api/user/purchases/rank-history', requireAHEmail, async (req, res) => {
  try {
    const productId = req.query.product_id
    const limit = Math.min(parseInt(req.query.limit) || 100, 500)
    
    let query = supabase
      .from('purchase_rank_history')
      .select('*')
      .eq('user_id', req.user.id)
      .order('scraped_at', { ascending: false })
      .limit(limit)
    
    // If specific product requested, filter to that product
    if (productId) {
      query = query.eq('product_id', productId)
    }
    
    const { data, error } = await query
    
    if (error) throw error
    res.json({ rank_history: data })
  } catch (err) {
    console.error('Error fetching rank history:', err)
    res.status(500).json({ error: 'fetch_failed', message: err.message })
  }
})

// Get purchase rank changes - shows products that moved in rank between scrapes
app.get('/api/user/purchases/rank-changes', requireAHEmail, async (req, res) => {
  try {
    // Get the two most recent scrapes for this user
    const { data: scrapes, error: scrapeError } = await supabase
      .from('purchase_rank_history')
      .select('scraped_at')
      .eq('user_id', req.user.id)
      .order('scraped_at', { ascending: false })
      .limit(2)
    
    if (scrapeError) throw scrapeError
    
    if (!scrapes || scrapes.length < 2) {
      return res.json({ 
        message: 'Need at least 2 scrapes to show rank changes',
        rank_changes: [],
        current_scrape: scrapes?.[0]?.scraped_at || null,
        previous_scrape: null
      })
    }
    
    const [currentScrape, previousScrape] = scrapes
    
    // Get current ranks
    const { data: currentRanks, error: currentError } = await supabase
      .from('purchase_rank_history')
      .select('product_id, product_name, purchase_rank')
      .eq('user_id', req.user.id)
      .eq('scraped_at', currentScrape.scraped_at)
    
    if (currentError) throw currentError
    
    // Get previous ranks
    const { data: previousRanks, error: previousError } = await supabase
      .from('purchase_rank_history')
      .select('product_id, purchase_rank')
      .eq('user_id', req.user.id)
      .eq('scraped_at', previousScrape.scraped_at)
    
    if (previousError) throw previousError
    
    // Build map of previous ranks
    const prevRankMap = new Map(previousRanks.map(r => [r.product_id, r.purchase_rank]))
    
    // Calculate rank changes
    const rankChanges = currentRanks.map(curr => {
      const prevRank = prevRankMap.get(curr.product_id)
      const change = prevRank ? prevRank - curr.purchase_rank : null  // Positive = moved up (more recent purchase)
      return {
        product_id: curr.product_id,
        product_name: curr.product_name,
        current_rank: curr.purchase_rank,
        previous_rank: prevRank || null,
        rank_change: change,
        is_new: prevRank === undefined  // Product wasn't in previous scrape
      }
    })
    
    // Sort by rank change (biggest movers first)
    rankChanges.sort((a, b) => {
      // New products first
      if (a.is_new && !b.is_new) return -1
      if (!a.is_new && b.is_new) return 1
      // Then by rank change (positive = moved up)
      return (b.rank_change || 0) - (a.rank_change || 0)
    })
    
    res.json({
      current_scrape: currentScrape.scraped_at,
      previous_scrape: previousScrape.scraped_at,
      rank_changes: rankChanges,
      new_purchases: rankChanges.filter(r => r.is_new).length,
      moved_up: rankChanges.filter(r => r.rank_change && r.rank_change > 0).length
    })
  } catch (err) {
    console.error('Error fetching rank changes:', err)
    res.status(500).json({ error: 'fetch_failed', message: err.message })
  }
})

// Get latest purchase ranks (most recent scrape)
app.get('/api/user/purchases/latest-ranks', requireAHEmail, async (req, res) => {
  try {
    // Get the most recent scrape timestamp
    const { data: latestScrape } = await supabase
      .from('purchase_rank_history')
      .select('scraped_at')
      .eq('user_id', req.user.id)
      .order('scraped_at', { ascending: false })
      .limit(1)
      .single()
    
    if (!latestScrape) {
      return res.json({ 
        message: 'No rank history available',
        ranks: [],
        scraped_at: null
      })
    }
    
    // Get all ranks from that scrape
    const { data: ranks, error } = await supabase
      .from('purchase_rank_history')
      .select('product_id, product_name, purchase_rank')
      .eq('user_id', req.user.id)
      .eq('scraped_at', latestScrape.scraped_at)
      .order('purchase_rank', { ascending: true })
    
    if (error) throw error
    
    res.json({
      scraped_at: latestScrape.scraped_at,
      ranks: ranks,
      total_products: ranks.length
    })
  } catch (err) {
    console.error('Error fetching latest ranks:', err)
    res.status(500).json({ error: 'fetch_failed', message: err.message })
  }
})

// Get user's full purchase history with enriched product data
app.get('/api/user/purchases/history', requireAHEmail, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const limit = Math.min(parseInt(req.query.limit) || 50, 100)
    const offset = (page - 1) * limit
    const sortBy = req.query.sortBy || 'scraped_at'  // Use scraped_at as default
    const sortOrder = req.query.sortOrder === 'asc' ? true : false
    
    // Get all user IDs (JWT + session-based) to merge purchases
    const userIds = await getAllUserIds(req)
    console.log('[History] Fetching for user IDs:', userIds)
    
    if (userIds.length === 0) {
      return res.json({ 
        purchases: [], 
        total: 0,
        page,
        limit,
        totalPages: 0
      })
    }
    
    // Get user purchases - use * to get all columns
    const { data: purchases, error, count } = await supabase
      .from('user_purchases')
      .select('*', { count: 'exact' })
      .in('user_id', userIds)
      .order(sortBy, { ascending: sortOrder })
      .range(offset, offset + limit - 1)
    
    if (error) {
      console.error('Purchase history fetch error:', error)
      throw error
    }
    
    console.log(`[History] Fetched ${purchases?.length || 0} purchases for user IDs ${userIds.join(', ')}`)
    
    if (!purchases || purchases.length === 0) {
      return res.json({ 
        purchases: [], 
        total: 0,
        page,
        limit,
        totalPages: 0
      })
    }
    
    // Get product IDs to fetch enriched data
    const productIds = [...new Set(purchases.map(p => p.product_id).filter(Boolean))]
    
    // Fetch enriched product data (if enriched columns are available)
    let enrichedProducts = {}
    let hasEnrichedData = false
    
    if (productIds.length > 0 && enrichedColumnsAvailable) {
      const { data: products, error: enrichError } = await supabase
        .from('products')
        .select('id, is_vegan, is_vegetarian, is_organic, is_fairtrade, nutri_score, origin_country, origin_by_month, brand, image_url, url')
        .in('id', productIds)
      
      if (enrichError?.message?.includes('does not exist')) {
        enrichedColumnsAvailable = false
        console.log('[History] Enriched columns not available')
      } else if (products) {
        hasEnrichedData = true
        enrichedProducts = products.reduce((acc, p) => {
          acc[p.id] = p
          return acc
        }, {})
      }
    }
    
    // If enriched columns not available, at least get basic product info (image_url, url)
    if (productIds.length > 0 && !hasEnrichedData) {
      const { data: products } = await supabase
        .from('products')
        .select('id, image_url, url')
        .in('id', productIds)
      
      if (products) {
        enrichedProducts = products.reduce((acc, p) => {
          acc[p.id] = p
          return acc
        }, {})
      }
    }
    
    // Combine purchase data with enriched product data and sustainability scores
    const purchasesWithDetails = purchases.map(purchase => {
      const enriched = enrichedProducts[purchase.product_id]
      // Use enriched data ONLY if this specific product has data in the products table
      const evaluation = enriched
        ? evaluateProductWithRecord(purchase.product_name, enriched)
        : evaluateProduct(purchase.product_name)
      
      // Support both scraped_at and purchased_at column names
      const purchaseDate = purchase.scraped_at || purchase.purchased_at || purchase.created_at
      
      return {
        id: purchase.id,
        product_id: purchase.product_id,
        product_name: purchase.product_name,
        price: purchase.price,
        quantity: purchase.quantity,
        source: purchase.source,
        purchased_at: purchaseDate,  // Normalize to purchased_at for frontend
        created_at: purchase.created_at,
        // Enriched fields (will be null if not available)
        is_vegan: enriched?.is_vegan ?? null,
        is_vegetarian: enriched?.is_vegetarian ?? null,
        is_organic: enriched?.is_organic ?? null,
        is_fairtrade: enriched?.is_fairtrade ?? null,
        nutri_score: enriched?.nutri_score ?? null,
        origin_country: enriched?.origin_country ?? null,
        origin_by_month: enriched?.origin_by_month ?? null,
        brand: enriched?.brand ?? null,
        image_url: enriched?.image_url ?? null,
        product_url: enriched?.url ?? null,
        // Sustainability scoring
        sustainability_score: evaluation.score,
        sustainability_rating: evaluation.rating,
        has_enriched_data: evaluation.hasEnrichedData || false,
        enriched_factors: evaluation.enriched || []
      }
    })
    
    res.json({
      purchases: purchasesWithDetails,
      total: count || purchases.length,
      page,
      limit,
      totalPages: Math.ceil((count || purchases.length) / limit)
    })
  } catch (err) {
    console.error('Error fetching purchase history:', err)
    res.status(500).json({ error: 'fetch_failed', message: err.message })
  }
})

// =============================================================================
// BONUS CARD BASED ACCESS (No Login Required)
// =============================================================================

// Get user info by bonus card number
app.get('/api/bonus/:cardNumber/user', async (req, res) => {
  try {
    const { cardNumber } = req.params
    
    if (!cardNumber || cardNumber.length < 13) {
      return res.status(400).json({ error: 'invalid_card', message: 'Invalid bonus card number' })
    }
    
    // Try to get user from ah_bonus_users
    const { data: user, error } = await supabase
      .from('ah_bonus_users')
      .select('*')
      .eq('bonus_card_number', cardNumber)
      .single()
    
    if (user) {
      return res.json(user)
    }
    
    // If no user record exists, check if they have purchases
    // (they might have synced before the user record system was added)
    const { data: purchases, error: purchaseError } = await supabase
      .from('user_purchases')
      .select('id', { count: 'exact', head: true })
      .eq('bonus_card_number', cardNumber)
      .limit(1)
    
    if (!purchaseError && purchases !== null) {
      // User has purchases but no ah_bonus_users record - create one
      const { data: newUser, error: createError } = await supabase
        .from('ah_bonus_users')
        .upsert({
          bonus_card_number: cardNumber,
          created_at: new Date().toISOString()
        }, { onConflict: 'bonus_card_number' })
        .select()
        .single()
      
      if (newUser) {
        return res.json(newUser)
      }
      
      // Return synthetic user if creation failed
      return res.json({
        bonus_card_number: cardNumber,
        created_at: new Date().toISOString(),
        _synthetic: true
      })
    }
    
    return res.status(404).json({ error: 'not_found', message: 'No data found for this bonus card. Please run a scrape first.' })
  } catch (err) {
    console.error('Error fetching bonus user:', err)
    res.status(500).json({ error: 'fetch_failed', message: err.message })
  }
})

// Get purchase history by bonus card number (no login required)
app.get('/api/bonus/:cardNumber/purchases', async (req, res) => {
  try {
    const { cardNumber } = req.params
    const page = parseInt(req.query.page) || 1
    const limit = Math.min(parseInt(req.query.limit) || 50, 100)
    const offset = (page - 1) * limit
    const sortBy = req.query.sortBy || 'scraped_at'
    const sortOrder = req.query.sortOrder === 'asc' ? true : false
    
    if (!cardNumber || cardNumber.length < 13) {
      return res.status(400).json({ error: 'invalid_card', message: 'Invalid bonus card number' })
    }
    
    // Get purchases by bonus card number
    const { data: purchases, error, count } = await supabase
      .from('user_purchases')
      .select('*', { count: 'exact' })
      .eq('bonus_card_number', cardNumber)
      .order(sortBy, { ascending: sortOrder })
      .range(offset, offset + limit - 1)
    
    if (error) {
      console.error('Bonus purchase history fetch error:', error)
      throw error
    }
    
    console.log(`[Bonus] Fetched ${purchases?.length || 0} purchases for card ${cardNumber.slice(0,4)}...`)
    
    if (!purchases || purchases.length === 0) {
      return res.json({ 
        purchases: [], 
        total: 0,
        page,
        limit,
        totalPages: 0
      })
    }
    
    // Get product IDs to fetch enriched data
    const productIds = [...new Set(purchases.map(p => p.product_id).filter(Boolean))]
    
    // Fetch enriched product data
    let enrichedProducts = {}
    if (productIds.length > 0) {
      const { data: products } = await supabase
        .from('products')
        .select('id, is_vegan, is_vegetarian, is_organic, is_fairtrade, nutri_score, origin_country, origin_by_month, brand, image_url, url')
        .in('id', productIds)
      
      if (products) {
        enrichedProducts = products.reduce((acc, p) => {
          acc[p.id] = p
          return acc
        }, {})
      }
    }
    
    // Combine purchase data with enriched product data
    const purchasesWithDetails = purchases.map(purchase => {
      const enriched = enrichedProducts[purchase.product_id] || {}
      const evaluation = evaluateProduct(purchase.product_name)
      
      return {
        id: purchase.id,
        product_id: purchase.product_id,
        product_name: purchase.product_name,
        price: purchase.price,
        quantity: purchase.quantity,
        source: purchase.source,
        purchased_at: purchase.scraped_at || purchase.created_at,
        is_vegan: enriched.is_vegan ?? null,
        is_vegetarian: enriched.is_vegetarian ?? null,
        is_organic: enriched.is_organic ?? null,
        is_fairtrade: enriched.is_fairtrade ?? null,
        nutri_score: enriched.nutri_score ?? null,
        origin_country: enriched.origin_country ?? null,
        origin_by_month: enriched.origin_by_month ?? null,
        brand: enriched.brand ?? null,
        image_url: enriched.image_url ?? null,
        product_url: enriched.url ?? null,
        sustainability_score: evaluation.score,
        rating: evaluation.rating,
        name: purchase.product_name
      }
    })
    
    res.json({
      purchases: purchasesWithDetails,
      total: count || purchases.length,
      page,
      limit,
      totalPages: Math.ceil((count || purchases.length) / limit)
    })
  } catch (err) {
    console.error('Error fetching bonus purchase history:', err)
    res.status(500).json({ error: 'fetch_failed', message: err.message })
  }
})

// Get suggestions by bonus card (returns same format as /api/user/insights for Dashboard compatibility)
app.get('/api/bonus/:cardNumber/suggestions', async (req, res) => {
  try {
    const { cardNumber } = req.params
    
    if (!cardNumber || cardNumber.length < 13) {
      return res.status(400).json({ error: 'invalid_card', message: 'Invalid bonus card number' })
    }
    
    // Get user's purchases
    const { data: purchases, error } = await supabase
      .from('user_purchases')
      .select('product_name, quantity, price')
      .eq('bonus_card_number', cardNumber)
    
    if (error) throw error
    
    if (!purchases || purchases.length === 0) {
      return res.json({
        total_purchases: 0,
        average_score: 0,
        rating: 'Start Shopping!',
        best_purchase: null,
        worst_purchase: null,
        total_spent: 0
      })
    }
    
    // Calculate sustainability scores on the fly (same as /api/user/insights)
    const purchasesWithScores = purchases.map(p => ({
      ...p,
      sustainability_score: evaluateProduct(p.product_name).score
    }))
    
    const totalScore = purchasesWithScores.reduce((sum, p) => sum + (p.sustainability_score || 0), 0)
    const avgScore = totalScore / purchasesWithScores.length
    
    const best = purchasesWithScores.reduce((max, p) => 
      ((p.sustainability_score || 0) > (max.sustainability_score || 0) ? p : max), purchasesWithScores[0])
    const worst = purchasesWithScores.reduce((min, p) => 
      ((p.sustainability_score || 0) < (min.sustainability_score || 0) ? p : min), purchasesWithScores[0])
    
    // Return same format as /api/user/insights for Dashboard compatibility
    res.json({
      total_purchases: purchasesWithScores.length,
      average_score: avgScore,
      rating: getRating(avgScore),
      best_purchase: best.product_name,
      worst_purchase: worst.product_name,
      total_spent: purchasesWithScores.reduce((sum, p) => sum + (p.price || 0), 0)
    })
  } catch (err) {
    console.error('Error fetching bonus suggestions:', err)
    res.status(500).json({ error: 'fetch_failed', message: err.message })
  }
})

// Get personalized suggestions based on user's purchase history
app.get('/api/user/suggestions', requireAHEmail, async (req, res) => {
  try {
    // Get all user IDs (JWT + session-based) to merge purchases
    const userIds = await getAllUserIds(req)
    console.log('[Suggestions] Fetching for user IDs:', userIds)
    
    if (userIds.length === 0) {
      return res.json({
        profile: {
          total_products: 0,
          avg_sustainability_score: 0,
          profile_type: 'balanced',
          profile_info: USER_PROFILE_TYPES['balanced']
        },
        replacements: [],
        suggestions: []
      })
    }
    
    // Get user's purchases to analyze their profile
    const { data: purchases, error: purchasesError } = await supabase
      .from('user_purchases')
      .select('product_name, quantity, price')
      .in('user_id', userIds)
    
    if (purchasesError) throw purchasesError
    
    // If user has no purchases, return empty suggestions
    if (!purchases || purchases.length === 0) {
      return res.json({
        profile: {
          total_products: 0,
          avg_sustainability_score: 0,
          profile_type: 'balanced',
          profile_info: USER_PROFILE_TYPES['balanced']
        },
        replacements: [],
        suggestions: []
      })
    }
    
    // Analyze user profile
    const userProfile = analyzeUserProfile(purchases)
    const profileInfo = USER_PROFILE_TYPES[userProfile.profileType] || USER_PROFILE_TYPES['balanced']
    
    // Get products from catalog for replacement suggestions
    let catalogProducts = []
    
    if (enrichedColumnsAvailable) {
      const { data, error: productsError } = await supabase
        .from('products')
        .select('id, name, url, image_url, price, is_vegan, is_vegetarian, is_organic, is_fairtrade, nutri_score, origin_country, origin_by_month, brand')
        .order('seen_count', { ascending: false })
        .limit(200)
      
      if (productsError?.message?.includes('does not exist')) {
        enrichedColumnsAvailable = false
      } else if (!productsError) {
        catalogProducts = data || []
      }
    }
    
    if (!enrichedColumnsAvailable || catalogProducts.length === 0) {
      const { data, error: productsError } = await supabase
        .from('products')
        .select('id, name, url, image_url, price')
        .order('seen_count', { ascending: false })
        .limit(200)
      
      if (!productsError) {
        catalogProducts = data || []
      }
    }
    
    // Find replacement suggestions for low-score products
    const replacements = findReplacementSuggestions(
      userProfile.improvements, 
      catalogProducts
    )
    
    // Also include generic high-score suggestions
    const highScoreSuggestions = catalogProducts
      .map(p => {
        return {
          name: p.name,
          url: makeAbsoluteAhUrl(p.url),
          image_url: p.image_url,
          price: p.price,
          sustainability_score: enrichedColumnsAvailable ? evaluateProductWithRecord(p.name, p).score : evaluateProduct(p.name).score,
          is_vegan: p.is_vegan,
          is_organic: p.is_organic,
          nutri_score: p.nutri_score,
          origin_country: p.origin_country
        }
      })
      .filter(s => s.sustainability_score >= 7)
      .sort((a, b) => b.sustainability_score - a.sustainability_score)
      .slice(0, 6)
    
    res.json({
      profile: {
        total_products: userProfile.totalProducts,
        avg_sustainability_score: userProfile.avgScore,
        profile_type: userProfile.profileType,
        profile_info: profileInfo,
        score_distribution: userProfile.scoreDistribution,
        category_breakdown: userProfile.categoryBreakdown,
        strengths: userProfile.strengths
      },
      replacements,  // "Replace X with Y" suggestions
      suggestions: highScoreSuggestions  // General high-score products
    })
  } catch (err) {
    console.error('Error fetching user suggestions:', err)
    res.status(500).json({ error: 'fetch_failed', message: err.message })
  }
})

// ============================================================================
// GLOBAL PRODUCT CATALOG API (public, read-only)
// ============================================================================

// Flag to track if enriched columns are available (avoid repeated failures)
let enrichedColumnsAvailable = true

// Get popular products (aggregated from all users)
app.get('/api/products/popular', async (req, res) => {
  try {
    if (!supabase) {
      return res.status(503).json({ error: 'database_unavailable' })
    }
    
    const limit = Math.min(parseInt(req.query.limit) || 50, 200)
    
    let data, error
    
    // Try with enriched fields if we believe they're available
    if (enrichedColumnsAvailable) {
      const result = await supabase
        .from('products')
        .select('id, name, normalized_name, url, image_url, price, seen_count, created_at, last_seen_at, is_vegan, is_vegetarian, is_organic, is_fairtrade, nutri_score, origin_country, origin_by_month, brand, details_scraped_at')
        .order('seen_count', { ascending: false })
        .limit(limit)
      
      if (result.error?.message?.includes('does not exist')) {
        // Enriched columns not available, fall back to basic query
        enrichedColumnsAvailable = false
        console.log('[Products] Enriched columns not found, disabling enriched queries')
      } else {
        data = result.data
        error = result.error
      }
    }
    
    // Fall back to basic query if enriched columns not available
    if (!enrichedColumnsAvailable || !data) {
      const result = await supabase
        .from('products')
        .select('id, name, normalized_name, url, image_url, price, seen_count, created_at, last_seen_at')
        .order('seen_count', { ascending: false })
        .limit(limit)
      data = result.data
      error = result.error
    }
    
    if (error) throw error
    
    // Add sustainability scores
    const withScores = data.map(p => ({
      ...p,
      sustainability_score: enrichedColumnsAvailable ? evaluateProductWithRecord(p.name, p).score : evaluateProduct(p.name).score
    }))
    
    res.json(withScores)
  } catch (err) {
    res.status(500).json({ error: 'fetch_failed', message: err.message })
  }
})

// Search global product catalog
app.get('/api/products/search', async (req, res) => {
  try {
    if (!supabase) {
      return res.status(503).json({ error: 'database_unavailable' })
    }
    
    const query = req.query.q?.trim()
    if (!query) {
      return res.status(400).json({ error: 'missing_query' })
    }
    
    let data, error
    
    // Try with enriched fields if available
    if (enrichedColumnsAvailable) {
      const result = await supabase
        .from('products')
        .select('id, name, normalized_name, url, image_url, price, is_vegan, is_vegetarian, is_organic, is_fairtrade, nutri_score, origin_country, origin_by_month, brand')
        .ilike('normalized_name', `%${query.toLowerCase()}%`)
        .limit(50)
      
      if (result.error?.message?.includes('does not exist')) {
        enrichedColumnsAvailable = false
      } else {
        data = result.data
        error = result.error
      }
    }
    
    // Fall back to basic query
    if (!enrichedColumnsAvailable || !data) {
      const result = await supabase
        .from('products')
        .select('id, name, normalized_name, url, image_url, price')
        .ilike('normalized_name', `%${query.toLowerCase()}%`)
        .limit(50)
      data = result.data
      error = result.error
    }
    
    if (error) throw error
    
    // Add sustainability scores
    const withScores = data.map(p => ({
      ...p,
      sustainability_score: enrichedColumnsAvailable ? evaluateProductWithRecord(p.name, p).score : evaluateProduct(p.name).score
    }))
    
    res.json(withScores)
  } catch (err) {
    res.status(500).json({ error: 'fetch_failed', message: err.message })
  }
})

// ============================================================================
// PRODUCT DETAIL ENRICHMENT API
// Scrapes detailed info from individual AH product pages
// ============================================================================

// Get products that need detail enrichment
app.get('/api/products/pending-enrichment', async (req, res) => {
  try {
    if (!supabase) {
      return res.status(503).json({ error: 'database_unavailable' })
    }
    
    const limit = Math.min(parseInt(req.query.limit) || 50, 200)
    
    const { data, error } = await supabase
      .from('products')
      .select('id, name, url, details_scrape_status, details_scraped_at')
      .not('url', 'is', null)
      .or('details_scrape_status.eq.pending,details_scraped_at.is.null')
      .order('seen_count', { ascending: false })
      .limit(limit)
    
    if (error) throw error
    res.json({ count: data?.length || 0, products: data || [] })
  } catch (err) {
    res.status(500).json({ error: 'fetch_failed', message: err.message })
  }
})

// Get enrichment status
app.get('/api/products/enrichment/status', (req, res) => {
  res.json({
    running: productEnrichState.running,
    startedAt: productEnrichState.startedAt,
    progress: productEnrichState.progress,
    processed: productEnrichState.processed,
    total: productEnrichState.total,
    lastRun: productEnrichState.lastRun,
    logs: productEnrichState.logs.slice(-20)
  })
})

// Get auto-enrichment status and configuration
app.get('/api/products/auto-enrich/status', (req, res) => {
  res.json({
    enabled: autoEnrichConfig.enabled,
    config: {
      batchSize: autoEnrichConfig.batchSize,
      delayBetweenProducts: autoEnrichConfig.delayBetweenProducts,
      checkInterval: autoEnrichConfig.checkInterval,
      maxQueueSize: autoEnrichConfig.maxQueueSize
    },
    queue: {
      size: autoEnrichQueue.productIds.size,
      processing: autoEnrichQueue.processing,
      lastCheck: autoEnrichQueue.lastCheck
    },
    stats: autoEnrichQueue.stats
  })
})

// Toggle auto-enrichment on/off
app.post('/api/products/auto-enrich/toggle', (req, res) => {
  const { enabled } = req.body
  
  if (typeof enabled === 'boolean') {
    autoEnrichConfig.enabled = enabled
    
    if (enabled && !autoEnrichInterval && !process.env.VERCEL) {
      // Start interval if enabling
      autoEnrichInterval = setInterval(checkForUnenrichedProducts, autoEnrichConfig.checkInterval)
      console.log('[Auto-Enrich] Enabled')
    } else if (!enabled && autoEnrichInterval) {
      // Stop interval if disabling
      clearInterval(autoEnrichInterval)
      autoEnrichInterval = null
      console.log('[Auto-Enrich] Disabled')
    }
  }
  
  res.json({ 
    enabled: autoEnrichConfig.enabled,
    message: autoEnrichConfig.enabled ? 'Auto-enrichment enabled' : 'Auto-enrichment disabled'
  })
})

// Manually trigger queue check
app.post('/api/products/auto-enrich/check', async (req, res) => {
  if (process.env.VERCEL) {
    return res.status(501).json({ error: 'not_supported_on_hosted' })
  }
  
  await checkForUnenrichedProducts()
  
  res.json({
    queueSize: autoEnrichQueue.productIds.size,
    processing: autoEnrichQueue.processing,
    lastCheck: autoEnrichQueue.lastCheck
  })
})

// Enrich a single product by ID
app.post('/api/products/:productId/enrich', async (req, res) => {
  if (process.env.VERCEL) {
    return res.status(501).json({
      error: 'not_supported_on_hosted',
      message: 'Product enrichment requires local server.'
    })
  }
  
  const { productId } = req.params
  
  try {
    // Get product URL from database
    const { data: product, error: fetchError } = await supabase
      .from('products')
      .select('id, name, url')
      .eq('id', productId)
      .single()
    
    if (fetchError || !product) {
      return res.status(404).json({ error: 'product_not_found' })
    }
    
    if (!product.url) {
      return res.status(400).json({ error: 'no_url', message: 'Product has no URL to scrape' })
    }
    
    // Check if script exists
    try {
      await fs.access(PRODUCT_DETAIL_SCRIPT)
    } catch {
      return res.status(500).json({ error: 'script_missing' })
    }
    
    // Run scraper for this single product
    const scrapeProcess = spawn(PYTHON_CMD, [
      PRODUCT_DETAIL_SCRIPT,
      '--url', product.url,
      '--headless'
    ], {
      cwd: __dirname,
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    })
    
    let resultData = null
    let stdout = ''
    
    scrapeProcess.stdout.on('data', (data) => {
      stdout += data.toString()
      const resultMatch = stdout.match(/\[RESULT\]\s*(\{.*\})/s)
      if (resultMatch) {
        try {
          resultData = JSON.parse(resultMatch[1])
        } catch (e) {
          console.error('Failed to parse scrape result:', e)
        }
      }
    })
    
    scrapeProcess.on('close', async (code) => {
      if (code === 0 && resultData?.success && resultData.results?.[0]) {
        const details = resultData.results[0]
        
        // Update product in database
        const { error: updateError } = await supabase
          .from('products')
          .update({
            is_vegan: details.is_vegan,
            is_vegetarian: details.is_vegetarian,
            is_organic: details.is_organic,
            nutri_score: details.nutri_score,
            origin_country: details.origin_country,
            brand: details.brand,
            unit_size: details.unit_size,
            allergens: details.allergens || [],
            ingredients: details.ingredients,
            details_scraped_at: new Date().toISOString(),
            details_scrape_status: 'success',
            updated_at: new Date().toISOString()
          })
          .eq('id', productId)
        
        if (updateError) {
          console.error('Failed to update product:', updateError)
        }
      } else {
        // Mark as failed
        await supabase
          .from('products')
          .update({
            details_scrape_status: 'failed',
            updated_at: new Date().toISOString()
          })
          .eq('id', productId)
      }
    })
    
    res.json({ status: 'started', productId, url: product.url })
    
  } catch (err) {
    console.error('Enrichment error:', err)
    res.status(500).json({ error: 'enrichment_failed', message: err.message })
  }
})

// Batch enrich products (runs in background)
app.post('/api/products/enrich-batch', async (req, res) => {
  if (process.env.VERCEL) {
    return res.status(501).json({
      error: 'not_supported_on_hosted',
      message: 'Batch enrichment requires local server.'
    })
  }
  
  if (productEnrichState.running) {
    return res.status(409).json({ error: 'enrichment_in_progress' })
  }
  
  const limit = Math.min(parseInt(req.body.limit) || 20, 100)
  
  try {
    // Get products that need enrichment
    const { data: products, error: fetchError } = await supabase
      .from('products')
      .select('id, name, url')
      .not('url', 'is', null)
      .or('details_scrape_status.eq.pending,details_scraped_at.is.null')
      .order('seen_count', { ascending: false })
      .limit(limit)
    
    if (fetchError) throw fetchError
    
    if (!products || products.length === 0) {
      return res.json({ status: 'no_products', message: 'No products need enrichment' })
    }
    
    // Start batch enrichment in background
    productEnrichState.running = true
    productEnrichState.startedAt = new Date().toISOString()
    productEnrichState.processed = 0
    productEnrichState.total = products.length
    productEnrichState.progress = 'Starting batch enrichment...'
    productEnrichState.logs = []
    
    // Run async
    ;(async () => {
      for (let i = 0; i < products.length; i++) {
        const product = products[i]
        productEnrichState.progress = `Processing ${i + 1}/${products.length}: ${product.name}`
        productEnrichState.logs.push({
          timestamp: new Date().toISOString(),
          message: `Enriching: ${product.name}`
        })
        
        try {
          // Run scraper for this product
          const result = await new Promise((resolve) => {
            const proc = spawn(PYTHON_CMD, [
              PRODUCT_DETAIL_SCRIPT,
              '--url', product.url,
              '--headless'
            ], {
              cwd: __dirname,
              env: { ...process.env, PYTHONUNBUFFERED: '1' }
            })
            
            let stdout = ''
            proc.stdout.on('data', (data) => { stdout += data.toString() })
            proc.on('close', (code) => {
              const match = stdout.match(/\[RESULT\]\s*(\{.*\})/s)
              if (match) {
                try {
                  resolve(JSON.parse(match[1]))
                } catch {
                  resolve(null)
                }
              } else {
                resolve(null)
              }
            })
          })
          
          if (result?.success && result.results?.[0]) {
            const details = result.results[0]
            await supabase
              .from('products')
              .update({
                is_vegan: details.is_vegan,
                is_vegetarian: details.is_vegetarian,
                is_organic: details.is_organic,
                nutri_score: details.nutri_score,
                origin_country: details.origin_country,
                brand: details.brand,
                unit_size: details.unit_size,
                allergens: details.allergens || [],
                ingredients: details.ingredients,
                details_scraped_at: new Date().toISOString(),
                details_scrape_status: 'success',
                updated_at: new Date().toISOString()
              })
              .eq('id', product.id)
            
            productEnrichState.logs.push({
              timestamp: new Date().toISOString(),
              message: `✅ ${product.name}: vegan=${details.is_vegan}, organic=${details.is_organic}, nutri=${details.nutri_score}`
            })
          } else {
            await supabase
              .from('products')
              .update({ details_scrape_status: 'failed', updated_at: new Date().toISOString() })
              .eq('id', product.id)
            
            productEnrichState.logs.push({
              timestamp: new Date().toISOString(),
              message: `❌ ${product.name}: failed`
            })
          }
        } catch (err) {
          productEnrichState.logs.push({
            timestamp: new Date().toISOString(),
            message: `❌ ${product.name}: ${err.message}`
          })
        }
        
        productEnrichState.processed = i + 1
        
        // Delay between requests
        if (i < products.length - 1) {
          await new Promise(r => setTimeout(r, 2000))
        }
      }
      
      productEnrichState.running = false
      productEnrichState.lastRun = {
        completedAt: new Date().toISOString(),
        processed: productEnrichState.processed,
        total: productEnrichState.total
      }
      productEnrichState.progress = 'Completed'
    })()
    
    res.json({ status: 'started', total: products.length })
    
  } catch (err) {
    productEnrichState.running = false
    console.error('Batch enrichment error:', err)
    res.status(500).json({ error: 'batch_failed', message: err.message })
  }
})

// Get product details including enriched fields
app.get('/api/products/:productId', async (req, res) => {
  try {
    if (!supabase) {
      return res.status(503).json({ error: 'database_unavailable' })
    }
    
    const { productId } = req.params
    
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('id', productId)
      .single()
    
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'not_found' })
    
    // Add computed sustainability score
    const evaluation = evaluateProduct(data.name)
    
    res.json({
      ...data,
      computed_score: evaluation.score,
      score_details: evaluation
    })
  } catch (err) {
    res.status(500).json({ error: 'fetch_failed', message: err.message })
  }
})

// Get detailed product analysis with scoring breakdown and alternatives
app.get('/api/product/:productId/details', async (req, res) => {
  try {
    const { productId } = req.params
    
    // Get product from database (if available)
    let product = null
    if (supabase) {
      const { data } = await supabase
        .from('products')
        .select('*')
        .eq('id', productId)
        .maybeSingle()
      product = data
    }
    
    // Get product name from database, user_purchases, or use productId as fallback
    let productName = product?.name
    if (!productName && supabase) {
      // Try to find the product name from user_purchases
      const { data: purchase } = await supabase
        .from('user_purchases')
        .select('product_name')
        .eq('product_id', productId)
        .limit(1)
        .maybeSingle()
      productName = purchase?.product_name
    }
    if (!productName) {
      productName = decodeURIComponent(productId).replace(/-/g, ' ')
    }
    
    // Get enriched data if available
    const enrichedData = product ? getEnrichedData(product) : null
    
    // Evaluate product with full scoring breakdown
    const evaluation = evaluateProduct(productName, enrichedData)
    
    // Create user-friendly breakdown
    const breakdown = []
    
    // Base score
    breakdown.push({
      label: 'Base Score',
      value: '5',
      positive: false,
      negative: false
    })
    
    // Add adjustment explanations
    for (const adj of evaluation.adjustments) {
      let label = ''
      let positive = adj.delta > 0
      let negative = adj.delta < 0
      
      switch (adj.type) {
        case 'catalog':
          if (adj.code === 'catalog_base') {
            label = 'Product Type'
          } else {
            label = adj.code.replace('catalog_', '').replace(/_/g, ' ')
          }
          break
        case 'category':
          label = adj.category?.replace(/_/g, ' ') || 'Category'
          label = label.charAt(0).toUpperCase() + label.slice(1)
          break
        case 'keyword':
          const keywordMap = {
            'keyword_organic': 'Organic/Bio',
            'keyword_local': 'Local Product',
            'keyword_seasonal': 'Seasonal',
            'keyword_fairtrade': 'Fairtrade',
            'keyword_processed': 'Processed Food',
            'keyword_plastic_packaging': 'Plastic Packaging',
            'keyword_meat': 'Meat Product',
            'keyword_palm_oil': 'Contains Palm Oil'
          }
          label = keywordMap[adj.code] || adj.code.replace('keyword_', '').replace(/_/g, ' ')
          break
        case 'enriched':
          const enrichedMap = {
            'enriched_vegan': 'Vegan',
            'enriched_vegetarian': 'Vegetarian',
            'enriched_organic': 'Organic Certified',
            'enriched_fairtrade': 'Fairtrade Certified',
            'enriched_nutriscore_A': 'Nutri-Score A',
            'enriched_nutriscore_B': 'Nutri-Score B',
            'enriched_nutriscore_C': 'Nutri-Score C',
            'enriched_nutriscore_D': 'Nutri-Score D',
            'enriched_nutriscore_E': 'Nutri-Score E',
            'enriched_origin_local': 'Regional (NL)',
            'enriched_origin_europe': 'EU Origin',
            'enriched_origin_nearby': 'Near Import',
            'enriched_origin_mediterranean': 'Mediterranean Import',
            'enriched_origin_africa': 'African Import',
            'enriched_origin_americas': 'Overseas Import',
            'enriched_origin_asia': 'Overseas Import',
            'enriched_origin_oceania': 'Overseas Import',
            'enriched_origin_unknown': 'Unknown Origin'
          }
          label = enrichedMap[adj.code] || adj.code.replace('enriched_', '').replace(/_/g, ' ')
          break
        default:
          label = adj.code?.replace(/_/g, ' ') || 'Unknown'
      }
      
      breakdown.push({
        label,
        value: (adj.delta > 0 ? '+' : '') + adj.delta.toFixed(1),
        positive,
        negative
      })
    }
    
    // NOTE: Final Score removed from breakdown - it's already shown above the breakdown section
    
    // Create improvement reasons
    const improvements = []
    
    // Positive factors
    for (const cat of evaluation.categories) {
      if (cat.referenceScore > 5) {
        improvements.push({
          reason: `${cat.icon || '📦'} ${cat.category.replace(/_/g, ' ')} category bonus`,
          positive: true
        })
      }
    }
    for (const adj of evaluation.adjustments.filter(a => a.delta > 0)) {
      if (adj.type === 'keyword') {
        improvements.push({
          reason: `✅ ${adj.code.replace('keyword_', '').replace(/_/g, ' ')} bonus`,
          positive: true
        })
      }
    }
    
    // Negative factors
    for (const cat of evaluation.categories) {
      if (cat.referenceScore < 5) {
        improvements.push({
          reason: `${cat.icon || '📦'} Low sustainability for ${cat.category.replace(/_/g, ' ')}`,
          positive: false
        })
      }
    }
    for (const adj of evaluation.adjustments.filter(a => a.delta < 0)) {
      if (adj.type === 'keyword') {
        improvements.push({
          reason: `⚠️ ${adj.code.replace('keyword_', '').replace(/_/g, ' ')} penalty`,
          positive: false
        })
      }
    }
    
    // Find better alternatives from catalog
    let alternatives = []
    if (supabase && evaluation.score < 9) {
      // Get products with better scores from the same general category
      let query = supabase
        .from('products')
        .select('id, name, url, image_url, price, is_vegan, is_vegetarian, is_organic, nutri_score')
        .neq('id', productId)
        .order('seen_count', { ascending: false })
        .limit(100)
      
      const { data: candidates } = await query
      
      if (candidates && candidates.length > 0) {
        // Score all candidates and filter for better ones
        const scored = candidates
          .map(c => {
            const enriched = getEnrichedData(c)
            const productEval = evaluateProduct(c.name, enriched)
            return {
              id: c.id,
              name: c.name,
              url: c.url,
              image_url: c.image_url,
              price: c.price,
              score: productEval.score,
              is_vegan: c.is_vegan,
              is_organic: c.is_organic
            }
          })
          .filter(c => c.score > evaluation.score)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)
        
        alternatives = scored
      }
    }
    
    res.json({
      productId,
      productName,
      score: evaluation.score,
      rating: evaluation.rating,
      breakdown,
      improvements,
      alternatives,
      categories: evaluation.categories,
      suggestions: evaluation.suggestions,
      hasEnrichedData: evaluation.hasEnrichedData
    })
  } catch (err) {
    console.error('[product/details] Error:', err)
    res.status(500).json({ error: 'fetch_failed', message: err.message })
  }
})

// API Routes

// DEPRECATED: Legacy purchase endpoints - now require authentication
// These are kept as stubs for backward compatibility but redirect to auth
app.get('/api/purchases', (req, res) => {
  res.status(401).json({ 
    error: 'auth_required', 
    message: 'This endpoint is deprecated. Please log in and use /api/user/purchases instead.' 
  })
})

app.post('/api/purchases', (req, res) => {
  res.status(401).json({ 
    error: 'auth_required', 
    message: 'This endpoint is deprecated. Please log in and use /api/user/purchases instead.' 
  })
})

// Support both GET and POST for score lookup
app.get('/api/score', (req, res) => {
  const { product, item, lang } = req.query
  const language = lang === 'en' ? 'en' : 'nl'
  const input = typeof product === 'string' && product.trim().length > 0
    ? product
    : (typeof item === 'string' ? item : '')
  if (!product || typeof product !== 'string' || product.trim().length === 0) {
    if (!input || input.trim().length === 0) {
      return res.status(400).json({ error: 'missing_product' })
    }
  }

  const evaluation = evaluateProduct(input || product, null, language)
  res.json(evaluation)
})

app.get('/api/score/search', (req, res) => {
  // Accept query or q as the search param for compatibility
  const { query, q } = req.query
  const term = typeof query === 'string' && query.length > 0 ? query : (typeof q === 'string' ? q : '')
  const results = searchProducts(term)
  res.json({ results })
})

app.post('/api/score', (req, res) => {
  const { product, item } = req.body || {}
  const input = typeof product === 'string' && product.trim().length > 0
    ? product
    : (typeof item === 'string' ? item : '')
  if (!input || input.trim().length === 0) {
    return res.status(400).json({ error: 'missing_product' })
  }
  const evaluation = evaluateProduct(input)
  res.json(evaluation)
})

app.get('/api/suggestions', (req, res) => {
  const { product } = req.query
  const suggestions = getSuggestions(product || '')
  res.json({ suggestions })
})

// DEPRECATED: Legacy insights endpoint - now requires authentication
app.get('/api/insights', (req, res) => {
  res.status(401).json({ 
    error: 'auth_required', 
    message: 'This endpoint is deprecated. Please log in and use /api/user/insights instead.' 
  })
})

// DEPRECATED: Legacy profile suggestions - now requires authentication
app.get('/api/profile_suggestions', (req, res) => {
  res.status(401).json({ 
    error: 'auth_required', 
    message: 'This endpoint is deprecated. Please log in and use /api/user/suggestions instead.' 
  })
})

app.get('/api/catalog/meta', async (req, res) => {
  if (req.query.refresh === 'true') {
    await refreshCatalog({ force: true })
  }
  res.json(getCatalogMeta())
})

// Ingest scraped items from the user's browser (extension/bookmarklet)
// Products go to shared 'products' table (unified catalog)
// Purchases are recorded per-user in user_purchases table (by user_id or bonus_card)
app.post('/api/ingest/scrape', async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : []
    if (!items.length) return res.status(400).json({ error: 'no_items' })

    // Get authenticated user OR bonus card (optional - if neither, just store products)
    const user = await getUserFromRequest(req)
    const userId = user?.id || null
    const bonusCard = req.body?.bonus_card?.toString().trim() || null
    
    console.log(`[Ingest] Received ${items.length} items, userId: ${userId ? 'yes' : 'no'}, bonusCard: ${bonusCard ? bonusCard.slice(-4) : 'none'}`)

    // Normalize and de-duplicate by URL if present, else by normalized name + source
    const seen = new Set()
    const cleaned = []
    const seenIds = new Set()
    for (const raw of items) {
      const rawName = (raw?.name || '').toString().trim()
      if (!rawName) continue
      const url = (raw?.url || '').toString().trim()
      const source = (raw?.source || 'ah_bonus').toString().trim()
      
      // Use helper to extract ID and name from URL
      const extracted = extractProductFromUrl(url, rawName)
      if (!extracted.id) continue
      
      const key = url || `${extracted.normalized}::${source}`
      if (seen.has(key)) continue
      seen.add(key)

      // De-duplicate by final id to avoid ON CONFLICT multiple-affect error
      if (seenIds.has(extracted.id)) {
        continue
      }
      seenIds.add(extracted.id)

      // Auto-detect dietary and organic properties from product name
      const isPlantBased = isLikelyPlantBased(extracted.name)
      const isOrganic = isLikelyOrganic(extracted.name)

      // Parse price - handle both number and string formats (e.g., "€2.99", "2,99")
      let parsedPrice = null
      if (typeof raw?.price === 'number' && !Number.isNaN(raw.price)) {
        parsedPrice = raw.price
      } else if (typeof raw?.price === 'string') {
        // Remove currency symbols and convert comma to dot
        const priceStr = raw.price.replace(/[€$£\s]/g, '').replace(',', '.')
        const num = parseFloat(priceStr)
        if (!Number.isNaN(num) && num > 0) {
          parsedPrice = num
        }
      }

      cleaned.push({
        id: extracted.id,
        name: extracted.name,
        normalized_name: extracted.normalized,
        url: url || null,
        image_url: (raw?.image_url || raw?.image || '').toString().trim() || null,
        price: parsedPrice,
        source,
        // Auto-detected properties (only set if true, preserve existing data otherwise)
        ...(isPlantBased ? { is_vegan: true, is_vegetarian: true } : {}),
        ...(isOrganic ? { is_organic: true } : {}),
        updated_at: new Date().toISOString()
      })
    }

    if (!cleaned.length) return res.status(400).json({ error: 'no_valid_items' })

    let stored = 0
    let purchasesRecorded = 0
    let queuedForEnrichment = 0
    
    if (!supabase) {
      console.warn('[Ingest] Supabase not configured - SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing')
      return res.status(500).json({ 
        error: 'supabase_not_configured', 
        detail: 'Server missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY'
      })
    }
    
    let purchaseError = null
    
    if (supabase) {
      // 1. Upsert products to shared 'products' table (unified catalog)
      console.log(`[Ingest] Upserting ${cleaned.length} products to ${SUPABASE_PRODUCTS_TABLE}`)
      const { error: productError } = await supabase
        .from(SUPABASE_PRODUCTS_TABLE)
        .upsert(cleaned, { onConflict: 'id' })
      if (productError) {
        console.error('Product upsert error:', JSON.stringify(productError, null, 2))
        console.error('First product sample:', JSON.stringify(cleaned[0], null, 2))
        return res.status(500).json({ 
          error: 'supabase_insert_failed', 
          detail: productError.message,
          code: productError.code,
          hint: productError.hint
        })
      }
      stored = cleaned.length

      // 3. Queue new products for auto-enrichment (if enabled)
      if (autoEnrichConfig.enabled && cleaned.length > 0) {
        try {
          // Find which of the upserted products don't have enrichment data yet
          const productIds = cleaned.map(p => p.id)
          const { data: unenriched } = await supabase
            .from('products')
            .select('id')
            .in('id', productIds)
            .is('details_scraped_at', null)
          
          if (unenriched?.length > 0) {
            queueProductsForEnrichment(unenriched.map(p => p.id))
            queuedForEnrichment = unenriched.length
            console.log(`[Auto-Enrich] Queued ${unenriched.length} new products for enrichment`)
          }
        } catch (e) {
          console.error('[Auto-Enrich] Failed to queue products:', e.message)
        }
      }

      // 2. If bonus card provided, ensure user record exists in ah_bonus_users
      if (bonusCard) {
        try {
          const { error: userError } = await supabase
            .from('ah_bonus_users')
            .upsert({
              bonus_card_number: bonusCard,
              last_scrape_at: new Date().toISOString(),
              scrape_count: 1  // Will be incremented on conflict
            }, {
              onConflict: 'bonus_card_number',
              ignoreDuplicates: false
            })
          
          if (userError) {
            console.error('Bonus user upsert error:', userError.message)
          } else {
            // Increment scrape count for existing users
            await supabase.rpc('increment_scrape_count', { card: bonusCard }).catch(() => {})
            console.log(`[Ingest] Bonus user ${bonusCard.slice(-4)} updated`)
          }
        } catch (e) {
          console.error('Bonus user record error:', e.message)
        }
      }

      // 3. If user is authenticated OR bonus card provided, record purchases
      // Uses upsert to prevent duplicates when scanning same products again
      if (userId || bonusCard) {
        const now = new Date().toISOString()
        const purchaseRecords = cleaned.map(p => ({
          ...(userId ? { user_id: userId } : {}),
          ...(bonusCard ? { bonus_card_number: bonusCard } : {}),
          product_id: p.id,
          product_name: p.name,
          price: p.price,
          quantity: 1,
          source: req.body?.source || 'bookmarklet',
          purchased_at: now,
          scraped_at: now,      // Required NOT NULL column
          last_seen_at: now
        }))

        console.log(`[Ingest] Recording ${purchaseRecords.length} purchases for ${userId ? 'user' : 'bonus card'} ${bonusCard?.slice(-4) || userId}`)
        console.log(`[Ingest] Sample purchase record:`, JSON.stringify(purchaseRecords[0], null, 2))

        // Try simple insert for bonus card users
        const { data, error: insertError } = await supabase
          .from('user_purchases')
          .insert(purchaseRecords)
          .select()
        
        if (insertError) {
          purchaseError = insertError
          console.error('[Ingest] Purchase insert FAILED:', JSON.stringify({
            code: insertError.code,
            message: insertError.message,
            details: insertError.details,
            hint: insertError.hint
          }, null, 2))
          // If it's a duplicate key error, that's OK
          if (insertError.code === '23505') {
            console.log(`[Ingest] Duplicate key - purchases already exist`)
            purchasesRecorded = purchaseRecords.length
            purchaseError = null
          }
        } else {
          purchasesRecorded = data?.length || purchaseRecords.length
          console.log(`[Ingest] SUCCESS: Inserted ${purchasesRecorded} purchase records`)
        }
      }
    }

    // Build redirect URL for bookmarklet
    // Use custom APP_URL env var, or default to production domain
    // (VERCEL_URL gives the preview URL, not the custom domain)
    const appUrl = process.env.APP_URL || 'https://www.bubblebrainz.com/#dashboard'
    const redirectUrl = bonusCard ? `${appUrl}/?card=${bonusCard}` : null

    return res.json({ 
      ok: true, 
      received: items.length, 
      stored,
      purchasesRecorded,
      purchaseError: purchaseError ? { code: purchaseError.code, message: purchaseError.message, hint: purchaseError.hint } : null,
      queuedForEnrichment,
      userId: userId ? 'authenticated' : (bonusCard ? 'bonus_card' : 'anonymous'),
      bonusCard: bonusCard ? bonusCard.slice(-4).padStart(13, '•') : null,
      redirect_url: redirectUrl
    })
  } catch (e) {
    return res.status(500).json({ error: 'ingest_failed', detail: e.message })
  }
})

app.post('/api/sync', async (req, res) => {
  if (syncState.running) {
    return res.status(409).json({ error: 'sync_in_progress', startedAt: syncState.startedAt })
  }

  const mode = (req.body?.mode || req.query?.mode || process.env.SYNC_MODE || 'sync').toString()

  // Serverless environments (like Vercel) cannot run local Python/browser flows
  if (process.env.VERCEL) {
    return res.status(501).json({ error: 'not_supported_on_vercel', details: 'Run this endpoint locally.' })
  }

  const scriptPath = mode === 'scrape' ? SCRAPE_SCRIPT : SYNC_SCRIPT
  const scriptName = path.basename(scriptPath)

  try {
    await fs.access(scriptPath)
  } catch (error) {
    return res.status(500).json({ error: `${mode}_script_missing`, details: `${scriptName} not found` })
  }

  const startedAt = new Date().toISOString()
  syncState.running = true
  syncState.startedAt = startedAt
  syncState.lastRun = { status: 'running', startedAt, mode }
  appendSyncLog('info', `Starting ${mode} using ${PYTHON_CMD} ${scriptPath}`)

  if (mode === 'scrape') {
    appendSyncLog('info', 'This flow opens a browser for you to log into AH, then scrapes your account pages.')
  }

  let syncProcess
  try {
    syncProcess = spawn(PYTHON_CMD, [scriptPath], {
      cwd: PROJECT_ROOT,
      env: process.env
    })
  } catch (error) {
    syncState.running = false
    syncState.startedAt = null
    syncState.lastRun = {
      status: 'error',
      startedAt,
      completedAt: new Date().toISOString(),
      exitCode: null,
      durationMs: 0,
      error: error.message,
      mode
    }
    appendSyncLog('stderr', `Failed to launch ${mode}: ${error.message}`)
    return res.status(500).json({ error: `${mode}_launch_failed`, details: error.message })
  }

  syncProcess.stdout.on('data', (chunk) => appendSyncLog('stdout', chunk))
  syncProcess.stderr.on('data', (chunk) => appendSyncLog('stderr', chunk))

  syncProcess.on('error', (error) => {
    appendSyncLog('stderr', `${mode} process error: ${error.message}`)
  })

  syncProcess.on('close', (code) => {
    const completedAt = new Date().toISOString()
    const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime()
    syncState.running = false
    syncState.startedAt = null
    syncState.lastRun = {
      status: code === 0 ? 'success' : 'error',
      exitCode: code,
      startedAt,
      completedAt,
      durationMs,
      error: code === 0 ? null : `${mode} exited with code ${code}`,
      mode
    }
    appendSyncLog('info', code === 0 ? `${mode} completed successfully.` : `${mode} exited with code ${code}`)
  })

  return res.status(202).json({ status: 'started', startedAt, mode })
})

app.get('/api/sync/status', (req, res) => {
  res.json({
    status: syncState.running ? 'running' : 'idle',
    running: syncState.running,
    startedAt: syncState.startedAt,
    lastRun: syncState.lastRun,
    logs: syncState.logs.slice(-100)
  })
})

// New: trigger account scraping instead of traditional sync
app.post('/api/scrape', async (req, res) => {
  if (scrapeState.running) {
    return res.status(409).json({ error: 'scrape_in_progress', startedAt: scrapeState.startedAt })
  }

  try {
    await fs.access(SCRAPE_SCRIPT)
  } catch (error) {
    return res.status(500).json({ error: 'scrape_script_missing', details: 'scrape_account.py not found' })
  }

  const startedAt = new Date().toISOString()
  scrapeState.running = true
  scrapeState.startedAt = startedAt
  scrapeState.lastRun = { status: 'running', startedAt }
  appendScrapeLog('info', `Starting scrape using ${PYTHON_CMD} ${SCRAPE_SCRIPT}`)

  let scrapeProcess
  try {
    scrapeProcess = spawn(PYTHON_CMD, [SCRAPE_SCRIPT], {
      cwd: PROJECT_ROOT,
      env: process.env
    })
  } catch (error) {
    scrapeState.running = false
    scrapeState.startedAt = null
    scrapeState.lastRun = {
      status: 'error',
      startedAt,
      completedAt: new Date().toISOString(),
      exitCode: null,
      durationMs: 0,
      error: error.message
    }
    appendScrapeLog('stderr', `Failed to launch scrape: ${error.message}`)
    return res.status(500).json({ error: 'scrape_launch_failed', details: error.message })
  }

  scrapeProcess.stdout.on('data', (chunk) => appendScrapeLog('stdout', chunk))
  scrapeProcess.stderr.on('data', (chunk) => appendScrapeLog('stderr', chunk))

  scrapeProcess.on('error', (error) => {
    appendScrapeLog('stderr', `Scrape process error: ${error.message}`)
  })

  scrapeProcess.on('close', (code) => {
    const completedAt = new Date().toISOString()
    const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime()
    scrapeState.running = false
    scrapeState.startedAt = null
    scrapeState.lastRun = {
      status: code === 0 ? 'success' : 'error',
      exitCode: code,
      startedAt,
      completedAt,
      durationMs,
      error: code === 0 ? null : `Scrape exited with code ${code}`
    }
    appendScrapeLog('info', code === 0 ? 'Scrape completed successfully.' : `Scrape exited with code ${code}`)
  })

  return res.status(202).json({ status: 'started', startedAt })
})

app.get('/api/scrape/status', (req, res) => {
  res.json({
    status: scrapeState.running ? 'running' : 'idle',
    running: scrapeState.running,
    startedAt: scrapeState.startedAt,
    lastRun: scrapeState.lastRun,
    logs: scrapeState.logs.slice(-100)
  })
})

// ============================================================================
// AUTO-SCRAPE: Automated login and scraping with user credentials
// ============================================================================

const autoScrapeState = {
  running: false,
  startedAt: null,
  lastRun: null,
  logs: [],
  progress: null
}

function appendAutoScrapeLog(stream, chunk) {
  const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0)
  for (const line of lines) {
    autoScrapeState.logs.push({
      timestamp: new Date().toISOString(),
      stream,
      message: line
    })
    
    // Parse progress from log messages
    if (line.includes('[INFO]')) {
      autoScrapeState.progress = line.replace(/\[INFO\]\s*/, '')
    } else if (line.includes('[SUCCESS]')) {
      autoScrapeState.progress = line.replace(/\[SUCCESS\]\s*/, '')
    } else if (line.includes('[ERROR]')) {
      autoScrapeState.progress = line.replace(/\[ERROR\]\s*/, '')
    }
  }
  if (autoScrapeState.logs.length > MAX_LOG_ENTRIES) {
    autoScrapeState.logs = autoScrapeState.logs.slice(autoScrapeState.logs.length - MAX_LOG_ENTRIES)
  }
}

const AUTO_SCRAPE_SCRIPT = path.join(__dirname, 'auto_scraper.py')
const PRODUCT_DETAIL_SCRIPT = path.join(__dirname, 'product_detail_scraper.py')

// State for product detail enrichment
const productEnrichState = {
  running: false,
  startedAt: null,
  progress: '',
  processed: 0,
  total: 0,
  lastRun: null,
  logs: []
}

// ============================================================================
// AUTO-ENRICHMENT SYSTEM
// Automatically enriches new products when added to the global catalog
// ============================================================================

const autoEnrichConfig = {
  enabled: process.env.AUTO_ENRICH_ENABLED !== 'false', // Enabled by default
  batchSize: parseInt(process.env.AUTO_ENRICH_BATCH_SIZE) || 5, // Products per batch
  delayBetweenProducts: parseInt(process.env.AUTO_ENRICH_DELAY) || 3000, // ms between products
  checkInterval: parseInt(process.env.AUTO_ENRICH_INTERVAL) || 60000, // Check every 60s
  maxQueueSize: 100 // Don't queue more than this many products
}

const autoEnrichQueue = {
  productIds: new Set(), // Queue of product IDs to enrich
  processing: false,
  lastCheck: null,
  stats: {
    totalQueued: 0,
    totalProcessed: 0,
    totalFailed: 0
  }
}

/**
 * Queue products for auto-enrichment
 * @param {string[]} productIds - Array of product IDs to enrich
 */
function queueProductsForEnrichment(productIds) {
  if (!autoEnrichConfig.enabled || !productIds?.length) return
  
  for (const id of productIds) {
    if (autoEnrichQueue.productIds.size < autoEnrichConfig.maxQueueSize) {
      autoEnrichQueue.productIds.add(id)
      autoEnrichQueue.stats.totalQueued++
    }
  }
  
  // Trigger processing if not already running
  if (!autoEnrichQueue.processing && autoEnrichQueue.productIds.size > 0) {
    processEnrichmentQueue()
  }
}

/**
 * Check for new products that need enrichment and queue them
 */
async function checkForUnenrichedProducts() {
  if (!supabase || !autoEnrichConfig.enabled) return
  
  try {
    autoEnrichQueue.lastCheck = new Date().toISOString()
    
    let products = []
    let error = null
    
    // Try with enriched columns first (if migration has been run)
    if (enrichedColumnsAvailable) {
      const result = await supabase
        .from('products')
        .select('id')
        .is('details_scraped_at', null)
        .is('details_scrape_status', null)
        .not('url', 'is', null)  // Only products with URLs can be enriched
        .order('created_at', { ascending: false })
        .limit(autoEnrichConfig.batchSize)
      
      if (result.error?.message?.includes('does not exist')) {
        enrichedColumnsAvailable = false
        console.log('[Auto-Enrich] Enriched columns not available - migration needed')
      } else {
        products = result.data || []
        error = result.error
      }
    }
    
    // If enriched columns not available, we can't track what's been enriched
    // Just log a message once
    if (!enrichedColumnsAvailable) {
      // Can't do enrichment without the migration - the columns to store results don't exist
      return
    }
    
    if (error) {
      console.error('[Auto-Enrich] Error checking for unenriched products:', error.message)
      return
    }
    
    if (products?.length > 0) {
      const newIds = products
        .map(p => p.id)
        .filter(id => !autoEnrichQueue.productIds.has(id))
      
      if (newIds.length > 0) {
        console.log(`[Auto-Enrich] Found ${newIds.length} new products to enrich`)
        queueProductsForEnrichment(newIds)
      }
    }
  } catch (err) {
    console.error('[Auto-Enrich] Check error:', err.message)
  }
}

/**
 * Process the enrichment queue in the background
 */
async function processEnrichmentQueue() {
  if (autoEnrichQueue.processing || autoEnrichQueue.productIds.size === 0) return
  if (!supabase || productEnrichState.running) return // Don't run if manual batch is running
  
  autoEnrichQueue.processing = true
  console.log(`[Auto-Enrich] Starting to process ${autoEnrichQueue.productIds.size} queued products`)
  
  try {
    // Get batch of products to process
    const idsToProcess = Array.from(autoEnrichQueue.productIds).slice(0, autoEnrichConfig.batchSize)
    
    for (const productId of idsToProcess) {
      // Remove from queue before processing
      autoEnrichQueue.productIds.delete(productId)
      
      try {
        // Get product details
        const { data: product, error: fetchError } = await supabase
          .from('products')
          .select('id, name, url')
          .eq('id', productId)
          .single()
        
        if (fetchError || !product) {
          console.log(`[Auto-Enrich] Product ${productId} not found, skipping`)
          continue
        }
        
        // Skip if no URL
        if (!product.url) {
          console.log(`[Auto-Enrich] Product ${productId} has no URL, marking as skipped`)
          await supabase
            .from('products')
            .update({ details_scrape_status: 'no_url' })
            .eq('id', productId)
          continue
        }
        
        console.log(`[Auto-Enrich] Enriching: ${product.name}`)
        
        // Mark as pending
        await supabase
          .from('products')
          .update({ details_scrape_status: 'pending' })
          .eq('id', productId)
        
        // Run the scraper
        const result = await runProductDetailScraper(product.url)
        
        if (result.success) {
          // Update product with enriched data
          const updateData = {
            is_vegan: result.data.is_vegan ?? null,
            is_vegetarian: result.data.is_vegetarian ?? null,
            is_organic: result.data.is_organic ?? null,
            is_fairtrade: result.data.is_fairtrade ?? null,
            nutri_score: result.data.nutri_score ?? null,
            origin_country: result.data.origin_country ?? null,
            origin_by_month: result.data.origin_by_month ?? null,
            brand: result.data.brand ?? null,
            unit_size: result.data.unit_size ?? null,
            allergens: result.data.allergens ?? null,
            ingredients: result.data.ingredients ?? null,
            details_scraped_at: new Date().toISOString(),
            details_scrape_status: 'success'
          }
          
          await supabase
            .from('products')
            .update(updateData)
            .eq('id', productId)
          
          autoEnrichQueue.stats.totalProcessed++
          console.log(`[Auto-Enrich] Successfully enriched: ${product.name}`)
        } else {
          // Mark as failed
          await supabase
            .from('products')
            .update({ 
              details_scrape_status: 'failed',
              details_scraped_at: new Date().toISOString()
            })
            .eq('id', productId)
          
          autoEnrichQueue.stats.totalFailed++
          console.log(`[Auto-Enrich] Failed to enrich ${product.name}: ${result.error}`)
        }
        
        // Delay between products
        if (autoEnrichQueue.productIds.size > 0) {
          await new Promise(r => setTimeout(r, autoEnrichConfig.delayBetweenProducts))
        }
        
      } catch (err) {
        console.error(`[Auto-Enrich] Error processing ${productId}:`, err.message)
        autoEnrichQueue.stats.totalFailed++
      }
    }
  } catch (err) {
    console.error('[Auto-Enrich] Queue processing error:', err.message)
  } finally {
    autoEnrichQueue.processing = false
    
    // Continue processing if more items in queue
    if (autoEnrichQueue.productIds.size > 0) {
      setTimeout(processEnrichmentQueue, 1000)
    }
  }
}

/**
 * Run the product detail scraper for a single URL
 * @param {string} url - Product URL to scrape
 * @returns {Promise<{success: boolean, data?: object, error?: string}>}
 */
async function runProductDetailScraper(url) {
  return new Promise((resolve) => {
    const scriptPath = PRODUCT_DETAIL_SCRIPT
    
    // Check if script exists
    if (!existsSync(scriptPath)) {
      resolve({ success: false, error: 'Scraper script not found' })
      return
    }
    
    const pythonProcess = spawn(PYTHON_CMD, [scriptPath, url], {
      cwd: path.dirname(scriptPath),
      env: { ...process.env }
    })
    
    let stdout = ''
    let stderr = ''
    
    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString()
    })
    
    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString()
    })
    
    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        resolve({ success: false, error: stderr || `Script exited with code ${code}` })
        return
      }
      
      try {
        // Extract JSON from stdout (last line should be the JSON result)
        const lines = stdout.trim().split('\n')
        const jsonLine = lines.find(line => line.startsWith('{') && line.endsWith('}'))
        
        if (jsonLine) {
          const data = JSON.parse(jsonLine)
          resolve({ success: true, data })
        } else {
          resolve({ success: false, error: 'No JSON output from scraper' })
        }
      } catch (err) {
        resolve({ success: false, error: `Parse error: ${err.message}` })
      }
    })
    
    // Timeout after 60 seconds
    setTimeout(() => {
      pythonProcess.kill()
      resolve({ success: false, error: 'Scraper timeout' })
    }, 60000)
  })
}

// Start auto-enrichment interval check (only on non-Vercel environments)
let autoEnrichInterval = null
if (!process.env.VERCEL && autoEnrichConfig.enabled) {
  autoEnrichInterval = setInterval(checkForUnenrichedProducts, autoEnrichConfig.checkInterval)
  console.log(`[Auto-Enrich] Enabled - checking every ${autoEnrichConfig.checkInterval / 1000}s`)
}

// Start automated scraping with user credentials
app.post('/api/auto-scrape', async (req, res) => {
  // Block on hosted environments (Vercel) unless Browserless is configured
  const hasBrowserless = !!process.env.BROWSERLESS_URL
  if (process.env.VERCEL && !hasBrowserless) {
    return res.status(501).json({ 
      error: 'not_supported_on_hosted',
      message: 'Automated scraping requires BROWSERLESS_URL to be configured on hosted environments. Please use the bookmarklet method instead.'
    })
  }
  
  if (autoScrapeState.running) {
    return res.status(409).json({ 
      error: 'scrape_in_progress', 
      startedAt: autoScrapeState.startedAt 
    })
  }
  
  const { email, password, save_credentials } = req.body || {}
  
  // Get user from auth header if provided (optional - allows saving credentials)
  let userId = null
  const authHeader = req.headers.authorization
  if (authHeader && authHeader.startsWith('Bearer ') && supabase) {
    const token = authHeader.slice(7)
    try {
      const { data: { user }, error } = await supabase.auth.getUser(token)
      if (!error && user) {
        userId = user.id
      }
    } catch (e) {
      // Auth is optional for this endpoint
    }
  }
  
  if (!email || !password) {
    return res.status(400).json({ error: 'missing_credentials' })
  }
  
  // Validate email format
  if (!email.includes('@')) {
    return res.status(400).json({ error: 'invalid_email' })
  }
  
  // Check if script exists
  try {
    await fs.access(AUTO_SCRAPE_SCRIPT)
  } catch (error) {
    return res.status(500).json({ 
      error: 'scrape_script_missing', 
      details: 'auto_scraper.py not found' 
    })
  }
  
  const startedAt = new Date().toISOString()
  autoScrapeState.running = true
  autoScrapeState.startedAt = startedAt
  autoScrapeState.lastRun = { status: 'running', startedAt, userId }
  autoScrapeState.logs = []
  autoScrapeState.progress = 'Starting automated scraper...'
  
  // Save credentials immediately when provided (so admin can use them even if scrape fails)
  if (save_credentials && userId) {
    try {
      // Encrypt password before storing
      const encryptionKey = process.env.COOKIES_ENCRYPTION_KEY || 'default-key-change-in-production'
      const iv = crypto.randomBytes(16)
      const cipher = crypto.createCipheriv('aes-256-cbc', crypto.scryptSync(encryptionKey, 'salt', 32), iv)
      let encrypted = cipher.update(password, 'utf8', 'hex')
      encrypted += cipher.final('hex')
      const password_encrypted = iv.toString('hex') + ':' + encrypted
      
      await supabase
        .from('user_ah_credentials')
        .upsert({
          user_id: userId,
          ah_email: email,
          ah_password_encrypted: password_encrypted,
          cookies_updated_at: new Date().toISOString(),
          sync_status: 'scraping'
        }, { onConflict: 'user_id' })
      
      appendAutoScrapeLog('info', 'Credentials saved for future use.')
    } catch (e) {
      appendAutoScrapeLog('stderr', `Failed to save credentials: ${e.message}`)
    }
    // Also keep in memory for updating status on completion
    autoScrapeState.pendingCredentials = { userId, email, password }
  }
  
  appendAutoScrapeLog('info', 'Starting automated AH scraper...')
  appendAutoScrapeLog('info', `Email: ${email.substring(0, 3)}***@${email.split('@')[1] || '***'}`)
  
  // Build command arguments
  // NOTE: AH blocks headless browsers on login, so we use --no-headless
  // This requires a display (X11/Xvfb on Linux, or remote browser service)
  const scriptArgs = [
    AUTO_SCRAPE_SCRIPT,
    '--email', email,
    '--password', password,
    '--no-headless'  // AH blocks headless browsers
  ]
  
  // Add Browserless URL if available (for Vercel/serverless)
  const browserlessUrl = process.env.BROWSERLESS_URL
  if (browserlessUrl) {
    scriptArgs.push('--browserless-url', browserlessUrl)
    appendAutoScrapeLog('info', 'Using remote browser service (Browserless)')
  }
  
  let autoScrapeProcess
  try {
    autoScrapeProcess = spawn(PYTHON_CMD, scriptArgs, {
      cwd: __dirname,
      env: { ...process.env, PYTHONUNBUFFERED: '1', BROWSERLESS_URL: browserlessUrl || '' }
    })
  } catch (error) {
    autoScrapeState.running = false
    autoScrapeState.startedAt = null
    autoScrapeState.lastRun = {
      status: 'error',
      startedAt,
      completedAt: new Date().toISOString(),
      exitCode: null,
      durationMs: 0,
      error: error.message
    }
    appendAutoScrapeLog('stderr', `Failed to launch scraper: ${error.message}`)
    return res.status(500).json({ error: 'spawn_failed', details: error.message })
  }
  
  let resultData = null
  
  autoScrapeProcess.stdout.on('data', (data) => {
    const text = data.toString()
    appendAutoScrapeLog('stdout', text)
    
    // Try to parse result from output
    const resultMatch = text.match(/\[RESULT\]\s*(\{.*\})/s)
    if (resultMatch) {
      try {
        resultData = JSON.parse(resultMatch[1])
      } catch (e) {
        console.error('Failed to parse scrape result:', e)
      }
    }
  })
  
  autoScrapeProcess.stderr.on('data', (data) => {
    appendAutoScrapeLog('stderr', data)
  })
  
  autoScrapeProcess.on('close', async (code) => {
    const completedAt = new Date().toISOString()
    const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime()
    
    autoScrapeState.running = false
    autoScrapeState.startedAt = null
    
    // Determine specific error message for credential-based scraping
    let errorMessage = null
    if (code !== 0) {
      if (resultData?.error === 'login_failed') {
        // Check logs for CAPTCHA indication
        const logText = autoScrapeState.logs.map(l => l.message).join(' ')
        if (logText.includes('CAPTCHA') || logText.includes('captcha')) {
          errorMessage = 'CAPTCHA required - Albert Heijn requires manual verification. Please use the "Easy Connect" feature instead, which opens a browser window for you to log in manually.'
        } else {
          errorMessage = 'Login failed - please check your email and password'
        }
      } else if (resultData?.error) {
        errorMessage = resultData.error
      } else {
        errorMessage = `Scraper exited with code ${code}`
      }
    }
    
    autoScrapeState.lastRun = {
      status: code === 0 && resultData?.success ? 'success' : 'error',
      startedAt,
      completedAt,
      durationMs,
      error: errorMessage,
      productsFound: resultData?.count || 0
    }
    
    appendAutoScrapeLog('info', code === 0 ? 'Auto-scrape process completed.' : `Auto-scrape exited with code ${code}`)
    
    // If we got products, ingest them to Supabase
    if (resultData?.success && resultData?.products?.length > 0 && supabase) {
      appendAutoScrapeLog('info', `Ingesting ${resultData.products.length} products to database...`)
      
      try {
        // Normalize and prepare products for ingestion using helper
        const cleaned = resultData.products.map((item) => {
          const rawName = (item.name || '').toString().trim()
          const url = (item.url || '').toString().trim()
          
          // Use helper to extract ID and name from URL
          const extracted = extractProductFromUrl(url, rawName)
          if (!extracted.id) return null
          
          return {
            id: extracted.id,
            name: extracted.name,
            normalized_name: extracted.normalized,
            url: url || null,
            image_url: (item.image || '').toString().trim() || null,
            price: typeof item.price === 'number' ? item.price : null,
            source: 'ah_auto_scrape',
            tags: null,
            updated_at: new Date().toISOString()
          }
        }).filter((item) => item && item.name && item.id)
        
        // Upsert to Supabase
        const { error: upsertError } = await supabase
          .from(SUPABASE_PRODUCTS_TABLE)
          .upsert(cleaned, { onConflict: 'id' })
        
        if (upsertError) {
          appendAutoScrapeLog('stderr', `Database upsert failed: ${upsertError.message}`)
        } else {
          appendAutoScrapeLog('info', `Successfully stored ${cleaned.length} products in database.`)
          autoScrapeState.lastRun.productsStored = cleaned.length
          
          // Update sync status to success (credentials already saved at scrape start)
          if (autoScrapeState.pendingCredentials && supabase) {
            const { userId } = autoScrapeState.pendingCredentials
            try {
              await supabase
                .from('user_ah_credentials')
                .update({
                  last_sync_at: new Date().toISOString(),
                  sync_status: 'success'
                })
                .eq('user_id', userId)
              
              appendAutoScrapeLog('info', 'Sync status updated to success.')
              autoScrapeState.lastRun.credentialsSaved = true
            } catch (e) {
              appendAutoScrapeLog('stderr', `Failed to update sync status: ${e.message}`)
            }
            autoScrapeState.pendingCredentials = null
          }
        }
      } catch (e) {
        appendAutoScrapeLog('stderr', `Ingestion error: ${e.message}`)
      }
    }
    
    // Update sync status to failed if credentials were pending
    if (autoScrapeState.pendingCredentials && supabase) {
      const { userId } = autoScrapeState.pendingCredentials
      try {
        await supabase
          .from('user_ah_credentials')
          .update({ sync_status: 'failed' })
          .eq('user_id', userId)
      } catch (e) {
        // Ignore
      }
    }
    autoScrapeState.pendingCredentials = null
  })
  
  return res.status(202).json({ status: 'started', startedAt })
})

// Re-scrape using saved credentials (requires authentication)
app.post('/api/auto-scrape/resync', requireAuth, async (req, res) => {
  // Block on hosted environments unless Browserless is configured
  const hasBrowserless = !!process.env.BROWSERLESS_URL
  if (process.env.VERCEL && !hasBrowserless) {
    return res.status(501).json({ 
      error: 'not_supported_on_hosted',
      message: 'Automated scraping requires BROWSERLESS_URL. Please use the bookmarklet method instead.'
    })
  }
  
  if (autoScrapeState.running) {
    return res.status(409).json({ 
      error: 'scrape_in_progress', 
      startedAt: autoScrapeState.startedAt 
    })
  }
  
  // Get user's saved credentials
  const { data: credentials, error: fetchError } = await supabase
    .from('user_ah_credentials')
    .select('ah_email, ah_password_encrypted')
    .eq('user_id', req.user.id)
    .single()
  
  if (fetchError || !credentials?.ah_email || !credentials?.ah_password_encrypted) {
    return res.status(404).json({ 
      error: 'no_saved_credentials',
      message: 'No saved AH credentials found. Please log in with your AH account first.'
    })
  }
  
  // Decrypt password
  let password
  try {
    const encryptionKey = process.env.COOKIES_ENCRYPTION_KEY || 'default-key-change-in-production'
    const [ivHex, encrypted] = credentials.ah_password_encrypted.split(':')
    const iv = Buffer.from(ivHex, 'hex')
    const decipher = crypto.createDecipheriv('aes-256-cbc', crypto.scryptSync(encryptionKey, 'salt', 32), iv)
    password = decipher.update(encrypted, 'hex', 'utf8') + decipher.final('utf8')
  } catch (e) {
    return res.status(500).json({ error: 'decryption_failed', message: 'Failed to decrypt saved credentials.' })
  }
  
  // Check if script exists
  try {
    await fs.access(AUTO_SCRAPE_SCRIPT)
  } catch (error) {
    return res.status(500).json({ 
      error: 'scrape_script_missing', 
      details: 'auto_scraper.py not found' 
    })
  }
  
  const email = credentials.ah_email
  const startedAt = new Date().toISOString()
  autoScrapeState.running = true
  autoScrapeState.startedAt = startedAt
  autoScrapeState.lastRun = { status: 'running', startedAt, userId: req.user.id }
  autoScrapeState.logs = []
  autoScrapeState.progress = 'Starting automated scraper with saved credentials...'
  
  appendAutoScrapeLog('info', 'Starting automated AH scraper (using saved credentials)...')
  appendAutoScrapeLog('info', `Email: ${email.substring(0, 3)}***@${email.split('@')[1] || '***'}`)
  
  // Build command arguments
  const scriptArgs = [
    AUTO_SCRAPE_SCRIPT,
    '--email', email,
    '--password', password,
    '--no-headless'
  ]
  
  const browserlessUrl = process.env.BROWSERLESS_URL
  if (browserlessUrl) {
    scriptArgs.push('--browserless-url', browserlessUrl)
    appendAutoScrapeLog('info', 'Using remote browser service (Browserless)')
  }
  
  let autoScrapeProcess
  try {
    autoScrapeProcess = spawn(PYTHON_CMD, scriptArgs, {
      cwd: __dirname,
      env: { ...process.env, PYTHONUNBUFFERED: '1', BROWSERLESS_URL: browserlessUrl || '' }
    })
  } catch (error) {
    autoScrapeState.running = false
    autoScrapeState.startedAt = null
    autoScrapeState.lastRun = {
      status: 'error',
      startedAt,
      completedAt: new Date().toISOString(),
      exitCode: null,
      durationMs: 0,
      error: error.message
    }
    appendAutoScrapeLog('stderr', `Failed to launch scraper: ${error.message}`)
    return res.status(500).json({ error: 'spawn_failed', details: error.message })
  }
  
  let resultData = null
  
  autoScrapeProcess.stdout.on('data', (data) => {
    const text = data.toString()
    appendAutoScrapeLog('stdout', text)
    
    const resultMatch = text.match(/\[RESULT\]\s*(\{.*\})/s)
    if (resultMatch) {
      try {
        resultData = JSON.parse(resultMatch[1])
      } catch (e) {
        console.error('Failed to parse scrape result:', e)
      }
    }
  })
  
  autoScrapeProcess.stderr.on('data', (data) => {
    appendAutoScrapeLog('stderr', data)
  })
  
  autoScrapeProcess.on('close', async (code) => {
    const completedAt = new Date().toISOString()
    const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime()
    
    autoScrapeState.running = false
    autoScrapeState.startedAt = null
    autoScrapeState.lastRun = {
      status: code === 0 && resultData?.success ? 'success' : 'error',
      startedAt,
      completedAt,
      durationMs,
      error: code !== 0 ? `Scraper exited with code ${code}` : (resultData?.error || null),
      productsFound: resultData?.count || 0
    }
    
    appendAutoScrapeLog('info', code === 0 ? 'Auto-scrape process completed.' : `Auto-scrape exited with code ${code}`)
    
    // Update last_sync_at on success/failure
    await supabase
      .from('user_ah_credentials')
      .update({ 
        last_sync_at: new Date().toISOString(),
        sync_status: code === 0 && resultData?.success ? 'success' : 'error'
      })
      .eq('user_id', req.user.id)
    
    // If we got products, ingest them to Supabase
    if (resultData?.success && resultData?.products?.length > 0 && supabase) {
      appendAutoScrapeLog('info', `Ingesting ${resultData.products.length} products to database...`)
      
      try {
        const cleaned = resultData.products.map((item) => {
          const rawName = (item.name || '').toString().trim()
          const url = (item.url || '').toString().trim()
          
          // Use helper to extract ID and name from URL
          const extracted = extractProductFromUrl(url, rawName)
          if (!extracted.id) return null
          
          return {
            id: extracted.id,
            name: extracted.name,
            normalized_name: extracted.normalized,
            url: url || null,
            image_url: (item.image || '').toString().trim() || null,
            price: typeof item.price === 'number' ? item.price : null,
            source: 'ah_auto_scrape',
            tags: null,
            updated_at: new Date().toISOString()
          }
        }).filter((item) => item && item.name && item.id)
        
        const { error: upsertError } = await supabase
          .from(SUPABASE_PRODUCTS_TABLE)
          .upsert(cleaned, { onConflict: 'id' })
        
        if (upsertError) {
          appendAutoScrapeLog('stderr', `Database upsert failed: ${upsertError.message}`)
        } else {
          appendAutoScrapeLog('info', `Successfully stored ${cleaned.length} products in database.`)
          autoScrapeState.lastRun.productsStored = cleaned.length
        }
      } catch (e) {
        appendAutoScrapeLog('stderr', `Ingestion error: ${e.message}`)
      }
    }
  })
  
  return res.status(202).json({ status: 'started', startedAt, usingSavedCredentials: true })
})

// Get auto-scrape status
app.get('/api/auto-scrape/status', (req, res) => {
  try {
    res.json({
      status: autoScrapeState.running ? 'running' : 'idle',
      running: autoScrapeState.running,
      startedAt: autoScrapeState.startedAt,
      lastRun: autoScrapeState.lastRun,
      progress: autoScrapeState.progress,
      logs: autoScrapeState.logs.slice(-100)
    })
  } catch (err) {
    console.error('[auto-scrape/status] Error:', err)
    res.status(500).json({ error: err.message })
  }
})

// Check if auto-scrape is available
// Available if: (1) not on Vercel, OR (2) Browserless URL is configured
app.get('/api/auto-scrape/available', (req, res) => {
  try {
    const hasBrowserless = !!process.env.BROWSERLESS_URL
    const isVercel = !!process.env.VERCEL
    const available = !isVercel || hasBrowserless
    
    let reason = null
    if (!available) {
      reason = 'hosted_environment_no_browserless'
    }
    
    res.json({
      available,
      reason,
      mode: hasBrowserless ? 'remote' : 'local'
    })
  } catch (err) {
    console.error('[auto-scrape/available] Error:', err)
    res.status(500).json({ error: err.message })
  }
})

// Cookie file path for session persistence
const COOKIES_FILE = path.join(__dirname, 'ah_cookies.json')

// Check if valid cookies exist
app.get('/api/auto-scrape/cookies', async (req, res) => {
  try {
    const exists = existsSync(COOKIES_FILE)
    if (!exists) {
      return res.json({ hasCookies: false })
    }
    
    const content = await fs.readFile(COOKIES_FILE, 'utf8')
    const cookies = JSON.parse(content)
    
    // Check if cookies have expired
    const now = Date.now() / 1000
    const validCookies = cookies.filter(c => !c.expires || c.expires > now)
    
    res.json({
      hasCookies: validCookies.length > 0,
      cookieCount: validCookies.length,
      totalCookies: cookies.length
    })
  } catch (error) {
    res.json({ hasCookies: false, error: error.message })
  }
})

// Delete saved cookies
app.delete('/api/auto-scrape/cookies', async (req, res) => {
  try {
    if (existsSync(COOKIES_FILE)) {
      await fs.unlink(COOKIES_FILE)
    }
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Auto-login state (for credential-based login)
const autoLoginState = {
  running: false,
  startedAt: null,
  logs: [],
  userId: null,
  email: null,
  password: null
}

// Auto-login: User enters credentials in our form, we log in for them
app.post('/api/auto-scrape/auto-login', async (req, res) => {
  console.log('[AUTO-LOGIN] Endpoint hit!')
  
  if (process.env.VERCEL) {
    return res.status(501).json({
      error: 'not_supported_on_hosted',
      message: 'Auto login requires a local server.'
    })
  }
  
  if (autoLoginState.running || cookieCaptureState.running || autoScrapeState.running) {
    return res.status(409).json({ error: 'operation_in_progress' })
  }
  
  const { email, password } = req.body || {}
  
  if (!email || !password) {
    return res.status(400).json({ error: 'missing_credentials', message: 'Email and password are required' })
  }
  
  try {
    await fs.access(AUTO_SCRAPE_SCRIPT)
  } catch (error) {
    return res.status(500).json({ error: 'script_missing' })
  }
  
  // Get user for saving credentials later
  const user = await getUserFromRequest(req)
  const userId = user?.id || null
  
  const startedAt = new Date().toISOString()
  autoLoginState.running = true
  autoLoginState.startedAt = startedAt
  autoLoginState.logs = []
  autoLoginState.userId = userId
  autoLoginState.email = email
  autoLoginState.password = password
  
  const loginProcess = spawn(PYTHON_CMD, [
    AUTO_SCRAPE_SCRIPT,
    '--auto-login',
    '--ah-email', email,
    '--ah-password', password,
    '--save-cookies', COOKIES_FILE,
    // On production (Railway), use headless mode since no display available
    // On local dev, show browser for CAPTCHA solving
    ...(process.env.NODE_ENV === 'production' ? ['--headless'] : ['--no-headless'])
  ], {
    cwd: __dirname,
    env: { ...process.env, PYTHONUNBUFFERED: '1' }
  })
  
  loginProcess.stdout.on('data', (data) => {
    const text = data.toString()
    console.log('[AUTO-LOGIN stdout]', text.trim())
    autoLoginState.logs.push({
      timestamp: new Date().toISOString(),
      stream: 'stdout',
      message: text.trim()
    })
  })
  
  loginProcess.stderr.on('data', (data) => {
    console.log('[AUTO-LOGIN stderr]', data.toString().trim())
    autoLoginState.logs.push({
      timestamp: new Date().toISOString(),
      stream: 'stderr',
      message: data.toString().trim()
    })
  })
  
  loginProcess.on('close', async (code) => {
    console.log(`[AUTO-LOGIN] Process exited with code ${code}`)
    autoLoginState.running = false
    autoLoginState.logs.push({
      timestamp: new Date().toISOString(),
      stream: 'info',
      message: code === 0 ? 'Login completed successfully' : `Login exited with code ${code}`
    })
    
    // Save credentials to Supabase on success
    if (code === 0 && autoLoginState.userId && autoLoginState.email && autoLoginState.password && supabase) {
      try {
        console.log('[AUTO-LOGIN] Saving credentials to Supabase...')
        const encryptionKey = process.env.COOKIES_ENCRYPTION_KEY || 'default-key-change-in-production'
        const iv = crypto.randomBytes(16)
        const cipher = crypto.createCipheriv('aes-256-cbc', crypto.scryptSync(encryptionKey, 'salt', 32), iv)
        let encrypted = cipher.update(autoLoginState.password, 'utf8', 'hex')
        encrypted += cipher.final('hex')
        const password_encrypted = iv.toString('hex') + ':' + encrypted
        
        const { data, error } = await supabase
          .from('user_ah_credentials')
          .upsert({
            user_id: autoLoginState.userId,
            ah_email: autoLoginState.email,
            ah_password_encrypted: password_encrypted
          }, { onConflict: 'user_id' })
          .select()
        
        if (error) {
          console.error('[ERROR] Failed to save credentials:', error.message)
        } else {
          console.log('[SUCCESS] Saved AH credentials for user', autoLoginState.userId)
          autoLoginState.logs.push({
            timestamp: new Date().toISOString(),
            stream: 'info',
            message: 'Credentials saved to database'
          })
        }
      } catch (e) {
        console.error('[ERROR] Exception saving credentials:', e)
      }
    }
    
    // Clear sensitive data
    autoLoginState.password = null
  })
  
  res.status(202).json({ status: 'started', startedAt })
})

// Get auto-login status
app.get('/api/auto-scrape/auto-login/status', (req, res) => {
  res.json({
    running: autoLoginState.running,
    startedAt: autoLoginState.startedAt,
    logs: autoLoginState.logs.slice(-50)
  })
})

// Login-and-Sync state (combined login + scrape for seamless user onboarding)
const loginAndSyncState = {
  running: false,
  phase: null, // 'login', 'scrape', 'done'
  startedAt: null,
  logs: [],
  progress: null,
  error: null,
  result: null,
  email: null,
  process: null  // Store process ref for cancellation
}

// Combined login + scrape: User enters credentials, we log in AND scrape their products
app.post('/api/auto-scrape/login-and-sync', async (req, res) => {
  console.log('[LOGIN-AND-SYNC] Endpoint hit!')
  
  // This works on Railway with headless mode
  if (loginAndSyncState.running || autoLoginState.running || autoScrapeState.running) {
    return res.status(409).json({ error: 'operation_in_progress' })
  }
  
  const { email, password } = req.body || {}
  
  if (!email || !password) {
    return res.status(400).json({ error: 'missing_credentials', message: 'Email and password are required' })
  }
  
  // Normalize email for consistent storage and lookup
  const normalizedEmail = email.toLowerCase().trim()
  
  try {
    await fs.access(AUTO_SCRAPE_SCRIPT)
  } catch (error) {
    return res.status(500).json({ error: 'script_missing' })
  }
  
  const startedAt = new Date().toISOString()
  loginAndSyncState.running = true
  loginAndSyncState.phase = 'login'
  loginAndSyncState.startedAt = startedAt
  loginAndSyncState.logs = []
  loginAndSyncState.progress = 'Starting login...'
  loginAndSyncState.error = null
  loginAndSyncState.result = null
  loginAndSyncState.email = normalizedEmail
  
  // First: register the user in our database
  if (supabase) {
    try {
      await supabase
        .from('user_ah_credentials')
        .upsert({ ah_email: normalizedEmail }, { onConflict: 'ah_email' })
      console.log('[LOGIN-AND-SYNC] User registered/updated:', normalizedEmail)
    } catch (e) {
      console.error('[LOGIN-AND-SYNC] Failed to register user:', e)
    }
  }
  
  const cookiesFile = path.join(__dirname, `cookies_${Date.now()}.json`)
  
  // Run auto-login to get cookies
  const loginProcess = spawn(PYTHON_CMD, [
    AUTO_SCRAPE_SCRIPT,
    '--auto-login',
    '--ah-email', email,
    '--ah-password', password,
    '--save-cookies', cookiesFile,
    '--headless'  // Always headless on server
  ], {
    cwd: __dirname,
    env: { ...process.env, PYTHONUNBUFFERED: '1' }
  })
  
  // Store process reference for cancellation
  loginAndSyncState.process = loginProcess
  
  loginProcess.stdout.on('data', (data) => {
    const text = data.toString()
    console.log('[LOGIN stdout]', text.trim())
    loginAndSyncState.logs.push({ timestamp: new Date().toISOString(), stream: 'stdout', message: text.trim() })
    
    // Parse progress
    if (text.includes('[INFO]')) {
      loginAndSyncState.progress = text.replace(/\[INFO\]\s*/g, '').trim()
    } else if (text.includes('[SUCCESS]')) {
      loginAndSyncState.progress = text.replace(/\[SUCCESS\]\s*/g, '').trim()
    }
  })
  
  loginProcess.stderr.on('data', (data) => {
    console.log('[LOGIN stderr]', data.toString().trim())
    loginAndSyncState.logs.push({ timestamp: new Date().toISOString(), stream: 'stderr', message: data.toString().trim() })
  })
  
  loginProcess.on('close', async (code) => {
    console.log(`[LOGIN-AND-SYNC] Login process exited with code ${code}`)
    
    if (code !== 0) {
      loginAndSyncState.running = false
      loginAndSyncState.phase = 'done'
      loginAndSyncState.error = 'Login failed - possibly incorrect credentials or CAPTCHA required'
      loginAndSyncState.result = { success: false, error: loginAndSyncState.error }
      // Clean up temp cookies file
      try { await fs.unlink(cookiesFile) } catch {}
      return
    }
    
    // Login succeeded - save credentials to database
    if (supabase) {
      try {
        const encryptionKey = process.env.COOKIES_ENCRYPTION_KEY || 'default-key-change-in-production'
        const iv = crypto.randomBytes(16)
        const cipher = crypto.createCipheriv('aes-256-cbc', crypto.scryptSync(encryptionKey, 'salt', 32), iv)
        let encrypted = cipher.update(password, 'utf8', 'hex')
        encrypted += cipher.final('hex')
        const password_encrypted = iv.toString('hex') + ':' + encrypted
        
        await supabase
          .from('user_ah_credentials')
          .upsert({
            ah_email: email,
            ah_password_encrypted: password_encrypted
          }, { onConflict: 'ah_email' })
        console.log('[LOGIN-AND-SYNC] Saved encrypted credentials')
      } catch (e) {
        console.error('[LOGIN-AND-SYNC] Failed to save credentials:', e)
      }
    }
    
    // Now start scraping with the cookies
    loginAndSyncState.phase = 'scrape'
    loginAndSyncState.progress = 'Login successful! Now syncing your products...'
    
    const scrapeProcess = spawn(PYTHON_CMD, [
      AUTO_SCRAPE_SCRIPT,
      '--cookies', cookiesFile,
      '--stealth',
      '--headless',
      '--output', path.join(__dirname, `auto_scrape_${Date.now()}.json`)
    ], {
      cwd: __dirname,
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    })
    
    let scrapeStdout = ''
    
    scrapeProcess.stdout.on('data', (data) => {
      const text = data.toString()
      scrapeStdout += text
      console.log('[SCRAPE stdout]', text.trim())
      loginAndSyncState.logs.push({ timestamp: new Date().toISOString(), stream: 'stdout', message: text.trim() })
      
      if (text.includes('[INFO]')) {
        loginAndSyncState.progress = text.replace(/\[INFO\]\s*/g, '').trim()
      } else if (text.includes('[SUCCESS]')) {
        loginAndSyncState.progress = text.replace(/\[SUCCESS\]\s*/g, '').trim()
      }
    })
    
    scrapeProcess.stderr.on('data', (data) => {
      console.log('[SCRAPE stderr]', data.toString().trim())
      loginAndSyncState.logs.push({ timestamp: new Date().toISOString(), stream: 'stderr', message: data.toString().trim() })
    })
    
    scrapeProcess.on('close', async (scrapeCode) => {
      console.log(`[LOGIN-AND-SYNC] Scrape process exited with code ${scrapeCode}`)
      
      // Parse result
      let productsCount = 0
      const resultMatch = scrapeStdout.match(/\[RESULT\]\s*(\{.*\})/s)
      if (resultMatch) {
        try {
          const resultData = JSON.parse(resultMatch[1])
          productsCount = resultData.products_stored || resultData.products_found || 0
          
          // Store products in database
          if (supabase && resultData.products && resultData.products.length > 0) {
            // Get user ID for this email
            const { data: userData } = await supabase
              .from('user_ah_credentials')
              .select('id')
              .eq('ah_email', email)
              .single()
            
            if (userData) {
              // Store each product
              const purchases = resultData.products.map(p => ({
                user_id: userData.id,
                product_name: p.name,
                product_data: p,
                purchased_at: p.date || new Date().toISOString()
              }))
              
              await supabase.from('user_purchases').insert(purchases)
              console.log(`[LOGIN-AND-SYNC] Stored ${purchases.length} products for user`)
            }
          }
        } catch (e) {
          console.error('[LOGIN-AND-SYNC] Failed to parse scrape result:', e)
        }
      }
      
      loginAndSyncState.running = false
      loginAndSyncState.phase = 'done'
      
      if (scrapeCode === 0) {
        loginAndSyncState.result = { 
          success: true, 
          productsStored: productsCount,
          email: email
        }
        loginAndSyncState.progress = `Synced ${productsCount} products!`
      } else {
        loginAndSyncState.error = 'Scraping failed'
        loginAndSyncState.result = { success: false, error: 'Scraping failed' }
      }
      
      // Clean up temp cookies file
      try { await fs.unlink(cookiesFile) } catch {}
    })
  })
  
  res.status(202).json({ status: 'started', startedAt })
})

// Get login-and-sync status
app.get('/api/auto-scrape/login-and-sync/status', (req, res) => {
  res.json({
    running: loginAndSyncState.running,
    phase: loginAndSyncState.phase,
    startedAt: loginAndSyncState.startedAt,
    progress: loginAndSyncState.progress,
    error: loginAndSyncState.error,
    result: loginAndSyncState.result,
    logs: loginAndSyncState.logs.slice(-50)
  })
})

// Cancel login-and-sync (reset state)
app.post('/api/auto-scrape/login-and-sync/cancel', (req, res) => {
  console.log('[LOGIN-AND-SYNC] Cancel requested')
  
  // Kill any running process
  if (loginAndSyncState.process) {
    try {
      loginAndSyncState.process.kill('SIGTERM')
      console.log('[LOGIN-AND-SYNC] Process killed')
    } catch (e) {
      console.log('[LOGIN-AND-SYNC] Could not kill process:', e.message)
    }
  }
  
  // Reset all states
  loginAndSyncState.running = false
  loginAndSyncState.phase = null
  loginAndSyncState.startedAt = null
  loginAndSyncState.progress = 0
  loginAndSyncState.error = null
  loginAndSyncState.result = null
  loginAndSyncState.logs = []
  loginAndSyncState.process = null
  
  autoLoginState.running = false
  autoScrapeState.running = false
  
  res.json({ success: true, message: 'State reset' })
})

// Cookie capture state
const cookieCaptureState = {
  running: false,
  startedAt: null,
  logs: [],
  userId: null  // Store user ID to save credentials when process completes
}

// Start cookie capture (manual login in browser)
// Accepts optional email/password to save credentials for admin use
app.post('/api/auto-scrape/capture-cookies', async (req, res) => {
  console.log('========================================')
  console.log('[CAPTURE-COOKIES] Endpoint hit!')
  console.log('[CAPTURE-COOKIES] req.body:', JSON.stringify(req.body))
  console.log('========================================')
  
  if (process.env.VERCEL) {
    return res.status(501).json({
      error: 'not_supported_on_hosted',
      message: 'Cookie capture requires a local server with display access.'
    })
  }
  
  if (cookieCaptureState.running || autoScrapeState.running) {
    return res.status(409).json({ error: 'operation_in_progress' })
  }
  
  try {
    await fs.access(AUTO_SCRAPE_SCRIPT)
  } catch (error) {
    return res.status(500).json({ error: 'script_missing' })
  }
  
  // Get user and save credentials if provided
  const user = await getUserFromRequest(req)
  const userId = user?.id || null
  const { email, password, save_credentials } = req.body || {}
  
  console.log(`[DEBUG] capture-cookies: userId=${userId}, email=${email ? 'yes' : 'no'}, password=${password ? 'yes' : 'no'}, save_credentials=${save_credentials}, supabase=${!!supabase}`)
  
  if (save_credentials && userId && email && password && supabase) {
    try {
      console.log('[CAPTURE-COOKIES] Saving credentials to Supabase...')
      const encryptionKey = process.env.COOKIES_ENCRYPTION_KEY || 'default-key-change-in-production'
      const iv = crypto.randomBytes(16)
      const cipher = crypto.createCipheriv('aes-256-cbc', crypto.scryptSync(encryptionKey, 'salt', 32), iv)
      let encrypted = cipher.update(password, 'utf8', 'hex')
      encrypted += cipher.final('hex')
      const password_encrypted = iv.toString('hex') + ':' + encrypted
      
      const { data, error } = await supabase
        .from('user_ah_credentials')
        .upsert({
          user_id: userId,
          ah_email: email,
          ah_password_encrypted: password_encrypted
        }, { onConflict: 'user_id' })
        .select()
      
      if (error) {
        console.error('[ERROR] Failed to save AH credentials:', error.message, error.code, error.details)
      } else {
        console.log(`[SUCCESS] Saved AH credentials for user ${userId}:`, data)
      }
    } catch (e) {
      console.error('[ERROR] Exception saving credentials:', e)
    }
  } else {
    console.log(`[DEBUG] Not saving credentials - conditions not met:`)
    console.log(`  save_credentials=${save_credentials}`)
    console.log(`  userId=${userId}`)
    console.log(`  email=${email ? 'present' : 'missing'}`)
    console.log(`  password=${password ? 'present' : 'missing'}`)
    console.log(`  supabase=${supabase ? 'present' : 'missing'}`)
  }
  
  const startedAt = new Date().toISOString()
  cookieCaptureState.running = true
  cookieCaptureState.startedAt = startedAt
  cookieCaptureState.logs = []
  cookieCaptureState.userId = userId  // Store for credential saving when complete
  
  const captureProcess = spawn(PYTHON_CMD, [
    AUTO_SCRAPE_SCRIPT,
    '--capture-cookies',
    '--save-cookies', COOKIES_FILE,
    '--no-headless'
  ], {
    cwd: __dirname,
    env: { ...process.env, PYTHONUNBUFFERED: '1' }
  })
  
  captureProcess.stdout.on('data', (data) => {
    const text = data.toString()
    cookieCaptureState.logs.push({
      timestamp: new Date().toISOString(),
      stream: 'stdout',
      message: text.trim()
    })
  })
  
  captureProcess.stderr.on('data', (data) => {
    cookieCaptureState.logs.push({
      timestamp: new Date().toISOString(),
      stream: 'stderr',
      message: data.toString().trim()
    })
  })
  
  captureProcess.on('close', async (code) => {
    cookieCaptureState.running = false
    cookieCaptureState.logs.push({
      timestamp: new Date().toISOString(),
      stream: 'info',
      message: code === 0 ? 'Cookie capture completed successfully' : `Cookie capture exited with code ${code}`
    })
    
    // Parse result and save captured credentials if present
    if (code === 0 && cookieCaptureState.userId && supabase) {
      try {
        const allLogs = cookieCaptureState.logs.map(l => l.message).join('\n')
        const resultMatch = allLogs.match(/\[RESULT\]\s*(\{.*\})/s)
        if (resultMatch) {
          const result = JSON.parse(resultMatch[1])
          console.log('[CAPTURE-COOKIES] Parsed result:', JSON.stringify(result))
          
          if (result.credentials?.email && result.credentials?.password) {
            console.log('[CAPTURE-COOKIES] Saving captured credentials to Supabase...')
            const encryptionKey = process.env.COOKIES_ENCRYPTION_KEY || 'default-key-change-in-production'
            const iv = crypto.randomBytes(16)
            const cipher = crypto.createCipheriv('aes-256-cbc', crypto.scryptSync(encryptionKey, 'salt', 32), iv)
            let encrypted = cipher.update(result.credentials.password, 'utf8', 'hex')
            encrypted += cipher.final('hex')
            const password_encrypted = iv.toString('hex') + ':' + encrypted
            
            const { data, error } = await supabase
              .from('user_ah_credentials')
              .upsert({
                user_id: cookieCaptureState.userId,
                ah_email: result.credentials.email,
                ah_password_encrypted: password_encrypted
              }, { onConflict: 'user_id' })
              .select()
            
            if (error) {
              console.error('[ERROR] Failed to save captured credentials:', error.message)
            } else {
              console.log('[SUCCESS] Saved captured AH credentials for user', cookieCaptureState.userId)
              cookieCaptureState.logs.push({
                timestamp: new Date().toISOString(),
                stream: 'info',
                message: 'Credentials saved successfully'
              })
            }
          }
        }
      } catch (e) {
        console.error('[ERROR] Exception parsing/saving captured credentials:', e)
      }
    }
  })
  
  res.status(202).json({ status: 'started', startedAt })
})

// Get cookie capture status
app.get('/api/auto-scrape/capture-cookies/status', (req, res) => {
  res.json({
    running: cookieCaptureState.running,
    startedAt: cookieCaptureState.startedAt,
    logs: cookieCaptureState.logs.slice(-50)
  })
})

// ============================================================================
// VISUAL LOGIN: One-click connect with visible browser window
// Opens a browser window where user can log in, then automatically scrapes
// ============================================================================

app.post('/api/auto-scrape/visual-login', async (req, res) => {
  // Only available on local servers (not Vercel)
  if (process.env.VERCEL) {
    return res.status(501).json({
      error: 'not_supported_on_hosted',
      message: 'Visual login is only available when running the app locally.'
    })
  }
  
  if (autoScrapeState.running || cookieCaptureState.running) {
    return res.status(409).json({ error: 'operation_in_progress' })
  }
  
  try {
    await fs.access(AUTO_SCRAPE_SCRIPT)
  } catch (error) {
    return res.status(500).json({ error: 'script_missing', details: 'auto_scraper.py not found' })
  }
  
  // Get user from auth header if provided (for recording purchases)
  // Support both JWT auth and email-based identification
  let userId = null
  const ahEmailHeader = req.headers['x-ah-email']
  
  if (ahEmailHeader) {
    // Email-based: look up existing user_id by AH email
    userId = await getUserIdByAHEmail(ahEmailHeader)
  } else {
    // JWT-based (legacy): get user from token
    const user = await getUserFromRequest(req)
    userId = user?.id || null
  }
  
  // Accept optional email/password to save credentials (like the password method)
  const { email, password, save_credentials } = req.body || {}
  
  // For new email-based users without an existing record, create one
  // We'll use the provided email to create a new user_id if needed
  if (!userId && email && supabase) {
    // Check if user already exists by this email
    const existingUserId = await getUserIdByAHEmail(email)
    if (existingUserId) {
      userId = existingUserId
    } else {
      // Create new user - generate a UUID
      userId = crypto.randomUUID()
      appendAutoScrapeLog('info', `Created new user account for ${email}`)
    }
  }
  
  // Save credentials if provided (so user can re-scrape with cookies later)
  // For email-based auth, always save credentials when email+password provided
  const shouldSaveCredentials = save_credentials || (email && password && !ahEmailHeader)
  if (shouldSaveCredentials && userId && email && password && supabase) {
    try {
      const encryptionKey = process.env.COOKIES_ENCRYPTION_KEY || 'default-key-change-in-production'
      const iv = crypto.randomBytes(16)
      const cipher = crypto.createCipheriv('aes-256-cbc', crypto.scryptSync(encryptionKey, 'salt', 32), iv)
      let encrypted = cipher.update(password, 'utf8', 'hex')
      encrypted += cipher.final('hex')
      const password_encrypted = iv.toString('hex') + ':' + encrypted
      
      await supabase
        .from('user_ah_credentials')
        .upsert({
          user_id: userId,
          ah_email: email,
          ah_password_encrypted: password_encrypted,
          sync_status: 'scraping'
        }, { onConflict: 'user_id' })
      
      appendAutoScrapeLog('info', `💾 Saved AH credentials for future use`)
    } catch (e) {
      appendAutoScrapeLog('stderr', `Failed to save credentials: ${e.message}`)
    }
  }
  
  const startedAt = new Date().toISOString()
  autoScrapeState.running = true
  autoScrapeState.startedAt = startedAt
  autoScrapeState.lastRun = { status: 'running', startedAt, userId }
  autoScrapeState.logs = []
  autoScrapeState.progress = 'Opening browser window...'
  autoScrapeState.currentUserId = userId
  
  appendAutoScrapeLog('info', '🖥️ Opening browser window for Albert Heijn login...')
  appendAutoScrapeLog('info', 'Please log in to your AH account in the browser window.')
  
  // Visual login: opens browser window for user to log in, then scrapes
  // Uses --visual-login mode: non-headless, waits for login, saves cookies, scrapes
  const scriptArgs = [
    AUTO_SCRAPE_SCRIPT,
    '--visual-login',           // Special mode: open browser, wait for login
    '--save-cookies', COOKIES_FILE,
    '--no-headless'             // Ensure browser is visible
  ]
  
  let scrapeProcess
  try {
    scrapeProcess = spawn(PYTHON_CMD, scriptArgs, {
      cwd: __dirname,
      env: { ...process.env, PYTHONUNBUFFERED: '1', DISPLAY: process.env.DISPLAY || ':0' }
    })
  } catch (error) {
    autoScrapeState.running = false
    autoScrapeState.startedAt = null
    return res.status(500).json({ error: 'spawn_failed', details: error.message })
  }
  
  let resultData = null
  let stdoutBuffer = ''  // Buffer stdout to handle chunked result
  
  scrapeProcess.stdout.on('data', (data) => {
    const text = data.toString()
    stdoutBuffer += text  // Accumulate for result parsing
    appendAutoScrapeLog('stdout', text)
    
    // Update progress based on log messages
    if (text.includes('[INFO]')) {
      const msg = text.replace(/.*\[INFO\]\s*/, '').trim()
      if (msg) autoScrapeState.progress = msg
    } else if (text.includes('[SUCCESS]')) {
      const msg = text.replace(/.*\[SUCCESS\]\s*/, '').trim()
      if (msg) autoScrapeState.progress = msg
    }
  })
  
  scrapeProcess.stderr.on('data', (data) => {
    appendAutoScrapeLog('stderr', data)
  })
  
  scrapeProcess.on('close', async (code) => {
    const completedAt = new Date().toISOString()
    const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime()
    
    console.log('[DEBUG] Process closed with code:', code)
    console.log('[DEBUG] stdout buffer length:', stdoutBuffer.length)
    
    // Parse result from buffered stdout (handles chunked output)
    // The [RESULT] JSON can be very long on a single line
    const resultIndex = stdoutBuffer.indexOf('[RESULT]')
    if (resultIndex !== -1) {
      const jsonStart = stdoutBuffer.indexOf('{', resultIndex)
      if (jsonStart !== -1) {
        // Find matching closing brace by counting braces
        let depth = 0
        let jsonEnd = -1
        for (let i = jsonStart; i < stdoutBuffer.length; i++) {
          if (stdoutBuffer[i] === '{') depth++
          else if (stdoutBuffer[i] === '}') {
            depth--
            if (depth === 0) {
              jsonEnd = i + 1
              break
            }
          }
        }
        if (jsonEnd !== -1) {
          const jsonStr = stdoutBuffer.substring(jsonStart, jsonEnd)
          console.log('[DEBUG] Found JSON from', jsonStart, 'to', jsonEnd, ', length:', jsonStr.length)
          try {
            resultData = JSON.parse(jsonStr)
            console.log('[DEBUG] Parsed visual-login result:', { success: resultData.success, count: resultData.count })
          } catch (e) {
            console.error('[ERROR] Failed to parse JSON:', e.message)
            console.error('[ERROR] JSON preview:', jsonStr.substring(0, 200))
          }
        } else {
          console.log('[DEBUG] Could not find closing brace in JSON')
        }
      } else {
        console.log('[DEBUG] No JSON start found after [RESULT]')
      }
    } else {
      console.log('[DEBUG] No [RESULT] found in stdout buffer')
      console.log('[DEBUG] Buffer preview (last 500 chars):', stdoutBuffer.slice(-500))
    }
    
    autoScrapeState.running = false
    autoScrapeState.startedAt = null
    autoScrapeState.lastRun = {
      status: code === 0 && resultData?.success ? 'success' : 'error',
      startedAt,
      completedAt,
      durationMs,
      error: code !== 0 ? `Process exited with code ${code}` : (resultData?.error || null),
      productsFound: resultData?.count || 0
    }
    
    appendAutoScrapeLog('info', code === 0 ? '✅ Visual login completed.' : `❌ Process exited with code ${code}`)
    
    // Ingest products to database if successful
    if (resultData?.success && resultData?.products?.length > 0 && supabase) {
      appendAutoScrapeLog('info', `📦 Storing ${resultData.products.length} products...`)
      console.log('[DEBUG] Starting product ingestion, raw products:', resultData.products.length)
      console.log('[DEBUG] Sample raw product:', JSON.stringify(resultData.products[0], null, 2))
      
      try {
        const cleaned = resultData.products.map((item, index) => {
          const rawName = (item.name || '').toString().trim()
          const url = (item.url || '').toString().trim()
          
          // Use helper to extract ID and name from URL
          const extracted = extractProductFromUrl(url, rawName)
          
          if (index < 3) {
            console.log(`[DEBUG] Product ${index}: url=${url.substring(0, 80)}, name=${rawName.substring(0, 40)}, extracted_id=${extracted.id}`)
          }
          
          if (!extracted.id) {
            console.log(`[DEBUG] Skipped product (no ID): ${rawName.substring(0, 40)}`)
            return null
          }
          
          return {
            id: extracted.id,
            name: extracted.name,
            normalized_name: extracted.normalized,
            url: url || null,
            image_url: (item.image || '').toString().trim() || null,
            price: typeof item.price === 'number' ? item.price : null,
            source: 'ah_visual_login',
            tags: null,
            updated_at: new Date().toISOString()
          }
        }).filter((item) => item && item.name && item.id)
        
        console.log(`[DEBUG] Cleaned products ready for upsert: ${cleaned.length}`)
        
        if (cleaned.length === 0) {
          console.log('[WARNING] No products passed cleaning - check extractProductFromUrl')
          appendAutoScrapeLog('stderr', 'No products could be cleaned for storage')
        } else {
          const { error: upsertError } = await supabase
            .from(SUPABASE_PRODUCTS_TABLE)
            .upsert(cleaned, { onConflict: 'id' })
        
        if (upsertError) {
          appendAutoScrapeLog('stderr', `Database error: ${upsertError.message}`)
          console.error('[ERROR] Supabase upsert error:', upsertError)
        } else {
          appendAutoScrapeLog('info', `✅ Stored ${cleaned.length} products to product catalog`)
          autoScrapeState.lastRun.productsStored = cleaned.length
          console.log(`[SUCCESS] Stored ${cleaned.length} products to ${SUPABASE_PRODUCTS_TABLE}`)
          
          // Also save to user_purchases if we have a userId
          // Uses upsert to prevent duplicates when re-scraping
          if (userId) {
            appendAutoScrapeLog('info', `👤 Saving purchases for user: ${userId}`)
            const now = new Date().toISOString()
            const purchases = cleaned.map(p => ({
              user_id: userId,
              product_id: p.id,
              product_name: p.name,
              price: p.price,
              quantity: 1,
              source: 'ah_visual_login',
              purchased_at: now,  // Will be ignored on conflict (keeps original)
              last_seen_at: now   // Always updated on re-scrape
            }))
            
            console.log(`[DEBUG] Upserting ${purchases.length} purchases for user ${userId}`)
            console.log('[DEBUG] Sample purchase:', JSON.stringify(purchases[0], null, 2))
            
            // Use upsert with ON CONFLICT to handle re-scrapes
            // On conflict: update last_seen_at, keep original purchased_at
            const { data: upsertedData, error: purchaseError } = await supabase
              .from('user_purchases')
              .upsert(purchases, { 
                onConflict: 'user_id,product_id',
                ignoreDuplicates: false  // We want to update last_seen_at
              })
              .select()
            if (purchaseError) {
              appendAutoScrapeLog('stderr', `Failed to record purchases: ${purchaseError.message}`)
              console.error('user_purchases upsert error:', purchaseError)
              console.error('user_purchases upsert error code:', purchaseError.code)
              console.error('user_purchases upsert error details:', purchaseError.details)
            } else {
              appendAutoScrapeLog('info', `✅ Upserted ${purchases.length} purchases for user (no duplicates on re-scrape)`)
              console.log(`[SUCCESS] Upserted ${upsertedData?.length || purchases.length} rows to user_purchases`)
              
              // Save purchase rank history if products have purchase_rank data
              if (resultData.sorted_by_purchase_date) {
                try {
                  // Build map of product_id -> purchase_rank from original data
                  const rankMap = new Map()
                  resultData.products.forEach(item => {
                    const url = (item.url || '').toString().trim()
                    const extracted = extractProductFromUrl(url, item.name || '')
                    if (extracted.id && item.purchase_rank) {
                      rankMap.set(extracted.id, {
                        rank: item.purchase_rank,
                        name: extracted.name
                      })
                    }
                  })
                  
                  if (rankMap.size > 0) {
                    const rankHistory = Array.from(rankMap.entries()).map(([productId, data]) => ({
                      user_id: userId,
                      product_id: productId,
                      product_name: data.name,
                      purchase_rank: data.rank,
                      scraped_at: now
                    }))
                    
                    const { error: rankError } = await supabase
                      .from('purchase_rank_history')
                      .insert(rankHistory)
                    
                    if (rankError) {
                      appendAutoScrapeLog('stderr', `Failed to save rank history: ${rankError.message}`)
                    } else {
                      appendAutoScrapeLog('info', `📊 Saved purchase rank history for ${rankHistory.length} products`)
                    }
                  }
                } catch (rankErr) {
                  appendAutoScrapeLog('stderr', `Rank history error: ${rankErr.message}`)
                }
              }
            }
          } else {
            appendAutoScrapeLog('info', `⚠️ No user authenticated - purchases not saved to user account`)
            console.log('[WARNING] userId is null - products scraped but not saved to user_purchases')
          }
        }
        }  // end if (cleaned.length > 0)
      } catch (e) {
        appendAutoScrapeLog('stderr', `Ingestion error: ${e.message}`)
        console.error('[ERROR] Ingestion exception:', e)
      }
    } else {
      console.log('[DEBUG] Skipping ingestion:', {
        hasResultData: !!resultData,
        success: resultData?.success,
        productsCount: resultData?.products?.length,
        hasSupabase: !!supabase
      })
    }
  })
  
  res.status(202).json({ status: 'started', startedAt, mode: 'visual_login' })
})

// Scrape using saved cookies (no credentials needed)
// Uses stealth mode: runs headless in background, signals if login needed
// Accepts optional user_id to record purchases for a specific user
// Also accepts optional email/password to save credentials for admin use
app.post('/api/auto-scrape/with-cookies', async (req, res) => {
  if (process.env.VERCEL && !process.env.BROWSERLESS_URL) {
    return res.status(501).json({
      error: 'not_supported_on_hosted',
      message: 'Auto-scrape requires BROWSERLESS_URL on hosted environments.'
    })
  }
  
  if (autoScrapeState.running) {
    return res.status(409).json({ error: 'scrape_in_progress' })
  }
  
  // Get user from session ID or JWT
  const userId = await getUserIdFromSession(req) || req.body?.user_id || null
  console.log('[DEBUG] With-cookies - userId:', userId)
  
  // Accept optional email/password to save credentials (for admin manual logins)
  const { email, password, save_credentials } = req.body || {}
  
  console.log(`[DEBUG] with-cookies: userId=${userId}, email=${email ? 'yes' : 'no'}, password=${password ? 'yes' : 'no'}, save_credentials=${save_credentials}`)
  
  if (save_credentials && userId && email && password && supabase) {
    try {
      const encryptionKey = process.env.COOKIES_ENCRYPTION_KEY || 'default-key-change-in-production'
      const iv = crypto.randomBytes(16)
      const cipher = crypto.createCipheriv('aes-256-cbc', crypto.scryptSync(encryptionKey, 'salt', 32), iv)
      let encrypted = cipher.update(password, 'utf8', 'hex')
      encrypted += cipher.final('hex')
      const password_encrypted = iv.toString('hex') + ':' + encrypted
      
      const { data, error } = await supabase
        .from('user_ah_credentials')
        .upsert({
          user_id: userId,
          ah_email: email,
          ah_password_encrypted: password_encrypted
        }, { onConflict: 'user_id' })
        .select()
      
      if (error) {
        console.error('[ERROR] Failed to save AH credentials (with-cookies):', error.message)
      } else {
        console.log(`[INFO] Saved AH credentials for user ${userId} (via with-cookies)`)
        appendAutoScrapeLog('info', `💾 Saved AH credentials for user`)
      }
    } catch (e) {
      console.error('[ERROR] Exception saving credentials (with-cookies):', e)
    }
  }
  
  // Check if cookies exist
  if (!existsSync(COOKIES_FILE)) {
    return res.status(400).json({
      error: 'no_cookies',
      message: 'No saved cookies. Please capture cookies first by logging in manually.'
    })
  }
  
  const startedAt = new Date().toISOString()
  autoScrapeState.running = true
  autoScrapeState.startedAt = startedAt
  autoScrapeState.lastRun = { status: 'running', startedAt, userId }
  autoScrapeState.logs = []
  autoScrapeState.progress = 'Starting scraper in background...'
  
  appendAutoScrapeLog('info', 'Starting AH scraper in stealth mode (background)...')
  if (userId) {
    appendAutoScrapeLog('info', `Recording purchases for user: ${userId}`)
  }
  
  // Check if user already has account protection disabled
  let accountProtectionAlreadyDisabled = false
  if (userId && supabase) {
    try {
      const { data: creds } = await supabase
        .from('user_ah_credentials')
        .select('account_protection_disabled')
        .eq('user_id', userId)
        .single()
      accountProtectionAlreadyDisabled = creds?.account_protection_disabled || false
      if (accountProtectionAlreadyDisabled) {
        appendAutoScrapeLog('info', 'Account protection already disabled - skipping settings page')
      }
    } catch (e) {
      // Ignore errors, just proceed with checking account protection
    }
  }
  
  // Use stealth mode: headless + cookies, will signal if login needed
  const scriptArgs = [
    AUTO_SCRAPE_SCRIPT,
    '--cookies', COOKIES_FILE,
    '--stealth',  // Stealth mode: headless, signals if login needed
    '--headless'  // Start headless (stealth will keep it headless)
  ]
  
  // Skip account protection page if already disabled
  if (accountProtectionAlreadyDisabled) {
    scriptArgs.push('--skip-account-protection')
  }
  
  // Store userId in state for use in the close handler
  autoScrapeState.currentUserId = userId
  
  const browserlessUrl = process.env.BROWSERLESS_URL
  if (browserlessUrl) {
    scriptArgs.push('--browserless-url', browserlessUrl)
    appendAutoScrapeLog('info', 'Using remote browser service')
  }
  
  let scrapeProcess
  try {
    scrapeProcess = spawn(PYTHON_CMD, scriptArgs, {
      cwd: __dirname,
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
    })
  } catch (error) {
    autoScrapeState.running = false
    return res.status(500).json({ error: 'spawn_failed', details: error.message })
  }
  
  let resultData = null
  let stdoutBuffer = ''  // Buffer stdout to handle chunked result
  
  scrapeProcess.stdout.on('data', (data) => {
    const text = data.toString()
    stdoutBuffer += text  // Accumulate for result parsing
    appendAutoScrapeLog('stdout', text)
  })
  
  scrapeProcess.stderr.on('data', (data) => {
    appendAutoScrapeLog('stderr', data)
  })
  
  scrapeProcess.on('close', async (code) => {
    const completedAt = new Date().toISOString()
    const durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime()
    
    // Parse result from buffered stdout (handles chunked output)
    const resultMatch = stdoutBuffer.match(/\[RESULT\]\s*(\{.*\})/s)
    if (resultMatch) {
      try {
        resultData = JSON.parse(resultMatch[1])
        console.log('[DEBUG] Parsed with-cookies result:', { success: resultData.success, count: resultData.count })
      } catch (e) {
        console.error('Failed to parse scrape result:', e)
      }
    } else {
      console.log('[DEBUG] No [RESULT] found in stdout buffer, length:', stdoutBuffer.length)
    }
    
    autoScrapeState.running = false
    autoScrapeState.startedAt = null
    autoScrapeState.lastRun = {
      status: code === 0 && resultData?.success ? 'success' : 'error',
      startedAt,
      completedAt,
      durationMs,
      error: resultData?.error || (code !== 0 ? `Exited with code ${code}` : null),
      productsFound: resultData?.count || 0,
      loginMethod: resultData?.login_method || 'unknown',
      loginRequired: resultData?.login_required || false
    }
    
    // If cookies failed or login is required, need to recapture
    if (resultData?.error === 'no_credentials_and_cookies_invalid' || resultData?.login_required) {
      autoScrapeState.lastRun.needsCookieRefresh = true
    }
    
    appendAutoScrapeLog('info', code === 0 ? 'Scrape completed.' : `Scrape exited with code ${code}`)
    
    // Ingest products to Supabase if successful
    if (resultData?.success && resultData?.products?.length > 0 && supabase) {
      appendAutoScrapeLog('info', `Ingesting ${resultData.products.length} products to database...`)
      
      // Get userId from state
      const userId = autoScrapeState.currentUserId
      
      try {
        const seenIds = new Set()
        const cleaned = resultData.products.map((item) => {
          const rawName = (item.name || '').toString().trim()
          const url = (item.url || '').toString().trim()
          
          // Use helper to extract ID and name from URL
          const extracted = extractProductFromUrl(url, rawName)
          if (!extracted.id) return null
          
          return {
            id: extracted.id,
            name: extracted.name,
            normalized_name: extracted.normalized,
            url: url || null,
            image_url: (item.image || '').toString().trim() || null,
            price: typeof item.price === 'number' ? item.price : null,
            source: 'ah_auto_scrape',
            tags: null,
            updated_at: new Date().toISOString()
          }
        }).filter((item) => {
          // Filter out items without name/id and deduplicate by id
          if (!item || !item.name || !item.id) return false
          if (seenIds.has(item.id)) return false
          seenIds.add(item.id)
          return true
        })
        
        // 1. Upsert to unified 'products' table
        const { error: upsertError } = await supabase
          .from(SUPABASE_PRODUCTS_TABLE)
          .upsert(cleaned, { onConflict: 'id' })
        
        if (upsertError) {
          appendAutoScrapeLog('stderr', `Database upsert failed: ${upsertError.message}`)
        } else {
          appendAutoScrapeLog('info', `Successfully stored ${cleaned.length} products in global catalog.`)
          autoScrapeState.lastRun.productsStored = cleaned.length
          
          // 1b. Queue new products for auto-enrichment
          if (autoEnrichConfig.enabled && cleaned.length > 0) {
            try {
              const productIds = cleaned.map(p => p.id)
              const { data: unenriched } = await supabase
                .from('products')
                .select('id')
                .in('id', productIds)
                .is('details_scraped_at', null)
              
              if (unenriched?.length > 0) {
                queueProductsForEnrichment(unenriched.map(p => p.id))
                appendAutoScrapeLog('info', `Queued ${unenriched.length} products for auto-enrichment`)
              }
            } catch (e) {
              appendAutoScrapeLog('stderr', `Auto-enrich queue failed: ${e.message}`)
            }
          }
        }
        
        // 2. If user is authenticated, also record as user purchases
        // Uses upsert to prevent duplicates on re-scrape
        if (userId) {
          const now = new Date().toISOString()
          const userPurchases = cleaned.map(item => ({
            user_id: userId,
            product_id: item.id,
            product_name: item.name,
            product_url: item.url,
            product_image_url: item.image_url,
            price: item.price,
            source: 'ah_auto_scrape',
            purchased_at: now,  // Kept on conflict (original purchase date)
            last_seen_at: now   // Always updated
          }))
          
          const { error: purchaseError } = await supabase
            .from('user_purchases')
            .upsert(userPurchases, {
              onConflict: 'user_id,product_id',
              ignoreDuplicates: false
            })
          
          if (purchaseError) {
            appendAutoScrapeLog('stderr', `User purchases upsert failed: ${purchaseError.message}`)
          } else {
            appendAutoScrapeLog('info', `Upserted ${userPurchases.length} purchases for user (no duplicates on re-scrape).`)
            autoScrapeState.lastRun.userPurchasesRecorded = userPurchases.length
            
            // Save purchase rank history if products have purchase_rank data
            if (resultData.sorted_by_purchase_date) {
              try {
                const now = new Date().toISOString()
                // Build map of product_id -> purchase_rank from original data
                const rankMap = new Map()
                resultData.products.forEach(item => {
                  const url = (item.url || '').toString().trim()
                  const extracted = extractProductFromUrl(url, item.name || '')
                  if (extracted.id && item.purchase_rank) {
                    rankMap.set(extracted.id, {
                      rank: item.purchase_rank,
                      name: extracted.name
                    })
                  }
                })
                
                if (rankMap.size > 0) {
                  const rankHistory = Array.from(rankMap.entries()).map(([productId, data]) => ({
                    user_id: userId,
                    product_id: productId,
                    product_name: data.name,
                    purchase_rank: data.rank,
                    scraped_at: now
                  }))
                  
                  const { error: rankError } = await supabase
                    .from('purchase_rank_history')
                    .insert(rankHistory)
                  
                  if (rankError) {
                    appendAutoScrapeLog('stderr', `Failed to save rank history: ${rankError.message}`)
                  } else {
                    appendAutoScrapeLog('info', `📊 Saved purchase rank history for ${rankHistory.length} products`)
                  }
                }
              } catch (rankErr) {
                appendAutoScrapeLog('stderr', `Rank history error: ${rankErr.message}`)
              }
            }
          }
          
          // Update user's sync status
          await supabase
            .from('user_ah_credentials')
            .update({ 
              sync_status: 'success', 
              last_sync_at: new Date().toISOString(),
              account_protection_disabled: true  // Mark as disabled after successful scrape
            })
            .eq('user_id', userId)
        }
      } catch (e) {
        appendAutoScrapeLog('stderr', `Ingestion error: ${e.message}`)
      }
    }
    
    // Clear current user ID
    autoScrapeState.currentUserId = null
  })
  
  res.status(202).json({ status: 'started', startedAt, useCookies: true })
})

// ============================================================================
// ADMIN ENDPOINTS
// For admin to manage user credentials and run scrapes on their behalf
// Requires ADMIN_SECRET environment variable
// ============================================================================

const ADMIN_SECRET = process.env.ADMIN_SECRET || null

// Middleware to check admin authentication
function requireAdmin(req, res, next) {
  const adminHeader = req.headers['x-admin-secret']
  if (!ADMIN_SECRET) {
    return res.status(503).json({ error: 'admin_not_configured', message: 'ADMIN_SECRET not set in environment' })
  }
  if (!adminHeader || adminHeader !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'unauthorized', message: 'Invalid admin secret' })
  }
  next()
}

// List all users with AH credentials (for admin to see who needs scraping)
app.get('/api/admin/ah-credentials', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('user_ah_credentials')
      .select('user_id, ah_email, cookies_updated_at, last_sync_at, sync_status, created_at')
      .order('created_at', { ascending: false })
    
    if (error) throw error
    
    // Also get user emails from auth.users if possible
    const result = data || []
    res.json({ 
      count: result.length,
      credentials: result
    })
  } catch (err) {
    console.error('Error listing credentials:', err)
    res.status(500).json({ error: 'fetch_failed', message: err.message })
  }
})

// Get decrypted credentials for a specific user (for admin to run scrapes)
app.get('/api/admin/ah-credentials/:userId', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params
    
    const { data, error } = await supabase
      .from('user_ah_credentials')
      .select('*')
      .eq('user_id', userId)
      .single()
    
    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'not_found', message: 'No credentials found for this user' })
      }
      throw error
    }
    
    // Decrypt password if available
    let decryptedPassword = null
    if (data.ah_password_encrypted) {
      try {
        const encryptionKey = process.env.COOKIES_ENCRYPTION_KEY || 'default-key-change-in-production'
        const [ivHex, encryptedHex] = data.ah_password_encrypted.split(':')
        const iv = Buffer.from(ivHex, 'hex')
        const decipher = crypto.createDecipheriv('aes-256-cbc', crypto.scryptSync(encryptionKey, 'salt', 32), iv)
        let decrypted = decipher.update(encryptedHex, 'hex', 'utf8')
        decrypted += decipher.final('utf8')
        decryptedPassword = decrypted
      } catch (e) {
        console.error('Failed to decrypt password:', e.message)
      }
    }
    
    res.json({
      user_id: data.user_id,
      ah_email: data.ah_email,
      ah_password: decryptedPassword,  // Decrypted for admin use
      has_cookies: !!data.cookies_encrypted,
      last_sync_at: data.last_sync_at,
      sync_status: data.sync_status,
      created_at: data.created_at
    })
  } catch (err) {
    console.error('Error fetching credentials:', err)
    res.status(500).json({ error: 'fetch_failed', message: err.message })
  }
})

// Update sync status for a user (after admin runs scrape manually)
app.patch('/api/admin/ah-credentials/:userId', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params
    const { sync_status, last_sync_at } = req.body
    
    const updates = {}
    if (sync_status) updates.sync_status = sync_status
    if (last_sync_at) updates.last_sync_at = last_sync_at
    
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'no_updates', message: 'Provide sync_status or last_sync_at' })
    }
    
    const { data, error } = await supabase
      .from('user_ah_credentials')
      .update(updates)
      .eq('user_id', userId)
      .select('user_id, ah_email, last_sync_at, sync_status')
      .single()
    
    if (error) throw error
    res.json({ success: true, credentials: data })
  } catch (err) {
    console.error('Error updating credentials:', err)
    res.status(500).json({ error: 'update_failed', message: err.message })
  }
})

// Run scrape for a specific user (using their saved credentials)
app.post('/api/admin/scrape/:userId', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params
    
    // Get user's credentials
    const { data: creds, error: credsError } = await supabase
      .from('user_ah_credentials')
      .select('ah_email, ah_password_encrypted')
      .eq('user_id', userId)
      .single()
    
    if (credsError || !creds) {
      return res.status(404).json({ error: 'no_credentials', message: 'No credentials found for this user' })
    }
    
    if (!creds.ah_password_encrypted) {
      return res.status(400).json({ error: 'no_password', message: 'User has no password saved' })
    }
    
    // Decrypt password
    let password = null
    try {
      const encryptionKey = process.env.COOKIES_ENCRYPTION_KEY || 'default-key-change-in-production'
      const [ivHex, encryptedHex] = creds.ah_password_encrypted.split(':')
      const iv = Buffer.from(ivHex, 'hex')
      const decipher = crypto.createDecipheriv('aes-256-cbc', crypto.scryptSync(encryptionKey, 'salt', 32), iv)
      let decrypted = decipher.update(encryptedHex, 'hex', 'utf8')
      decrypted += decipher.final('utf8')
      password = decrypted
    } catch (e) {
      return res.status(500).json({ error: 'decrypt_failed', message: 'Could not decrypt password' })
    }
    
    // Check if scrape already running
    if (autoScrapeState.running) {
      return res.status(409).json({ error: 'scrape_in_progress', startedAt: autoScrapeState.startedAt })
    }
    
    // Start the scrape (similar to /api/auto-scrape)
    const startedAt = new Date().toISOString()
    autoScrapeState.running = true
    autoScrapeState.startedAt = startedAt
    autoScrapeState.lastRun = { status: 'running', startedAt, userId }
    autoScrapeState.logs = []
    autoScrapeState.progress = 'Starting admin-initiated scrape...'
    
    // Store credentials to update on success
    autoScrapeState.pendingCredentials = { userId, email: creds.ah_email, password }
    
    appendAutoScrapeLog('info', `Admin scrape started for user: ${userId}`)
    appendAutoScrapeLog('info', `Email: ${creds.ah_email.substring(0, 3)}***@${creds.ah_email.split('@')[1] || '***'}`)
    
    const scriptArgs = [
      AUTO_SCRAPE_SCRIPT,
      '--email', creds.ah_email,
      '--password', password,
      '--no-headless'
    ]
    
    let autoScrapeProcess
    try {
      autoScrapeProcess = spawn(PYTHON_CMD, scriptArgs, {
        cwd: __dirname,
        env: { ...process.env, PYTHONUNBUFFERED: '1' }
      })
    } catch (error) {
      autoScrapeState.running = false
      autoScrapeState.startedAt = null
      return res.status(500).json({ error: 'spawn_failed', details: error.message })
    }
    
    let resultData = null
    
    autoScrapeProcess.stdout.on('data', (data) => {
      const text = data.toString()
      appendAutoScrapeLog('stdout', text)
      
      const resultMatch = text.match(/\[RESULT\]\s*(\{.*\})/s)
      if (resultMatch) {
        try {
          resultData = JSON.parse(resultMatch[1])
        } catch (e) {
          console.error('Failed to parse scrape result:', e)
        }
      }
    })
    
    autoScrapeProcess.stderr.on('data', (data) => {
      appendAutoScrapeLog('stderr', data)
    })
    
    autoScrapeProcess.on('close', async (code) => {
      const completedAt = new Date().toISOString()
      autoScrapeState.running = false
      autoScrapeState.startedAt = null
      
      autoScrapeState.lastRun = {
        status: code === 0 && resultData?.success ? 'success' : 'error',
        startedAt,
        completedAt,
        userId,
        productsFound: resultData?.count || 0,
        error: resultData?.error || (code !== 0 ? `Exited with code ${code}` : null)
      }
      
      // Update user's sync status
      await supabase
        .from('user_ah_credentials')
        .update({ 
          sync_status: code === 0 && resultData?.success ? 'success' : 'error',
          last_sync_at: completedAt
        })
        .eq('user_id', userId)
      
      // Ingest products if successful (similar to regular scrape)
      if (resultData?.success && resultData?.products?.length > 0) {
        // ... ingestion happens automatically via the same close handler in auto-scrape
        appendAutoScrapeLog('info', `Admin scrape completed: ${resultData.products.length} products`)
      }
    })
    
    res.status(202).json({ 
      status: 'started', 
      startedAt, 
      userId,
      email: creds.ah_email
    })
  } catch (err) {
    console.error('Error starting admin scrape:', err)
    res.status(500).json({ error: 'scrape_failed', message: err.message })
  }
})

// Serve built frontend (if present) so http://localhost:3001 serves the SPA in production/local builds
// Global Express error handler - must be last middleware
app.use((err, req, res, next) => {
  console.error('[Express Error]', req.method, req.path, err.stack || err)
  if (res.headersSent) {
    return next(err)
  }
  res.status(500).json({ error: 'Internal server error', message: err.message })
})

if (existsSync(CLIENT_INDEX)) {
  app.use(express.static(CLIENT_DIST))
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).end()
    }
    res.sendFile(CLIENT_INDEX)
  })
}

if (supabaseEnabled && !process.env.VERCEL) {
  const intervalMs = CATALOG_REFRESH_INTERVAL_MS
  const timer = setInterval(() => {
    refreshCatalog().catch((err) => {
      console.error('[catalogLoader] Background refresh failed:', err.message)
    })
  }, intervalMs)
  if (typeof timer.unref === 'function') {
    timer.unref()
  }
}

await catalogReady
  .then((meta) => {
    console.log(`📦 Catalog ready (${meta.itemCount} items from ${meta.source})`)
  })
  .catch((err) => {
    console.error('[catalogLoader] Initial catalog load failed:', err?.message || err)
  })

export default app
export { ensureCatalogLoaded, minutes, calculateScore, evaluateProduct, searchProducts, getCatalogMeta }
