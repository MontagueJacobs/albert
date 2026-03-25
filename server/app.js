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
// Note: user_ah_credentials table removed - email-based auth disabled
// Users should use bonus card identification instead
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
    
    // Check users table only (user_ah_credentials removed)
    const { data: userData } = await supabase
      .from('users')
      .select('id, email')
      .eq('email', normalizedEmail)
      .single()
    
    if (userData) {
      // Get purchase count
      const { count } = await supabase
        .from('user_purchases')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userData.id)
      
      return res.json({
        exists: true,
        email: userData.email,
        lastSync: null,
        syncStatus: 'not_connected',
        purchaseCount: count || 0
      })
    }
    
    // User not found - recommend bonus card login
    return res.json({ 
      exists: false, 
      message: 'Use the bookmarklet to sync your AH purchases with your bonus card.' 
    })
  } catch (err) {
    console.error('Error checking AH user:', err)
    res.status(500).json({ error: 'check_failed', message: err.message })
  }
})

// ============================================================================
// AH USER REGISTER ENDPOINT (Deprecated - use bonus card instead)
// ============================================================================
app.post('/api/ah-user/register', async (req, res) => {
  // Email-based registration disabled - recommend bonus card
  res.json({ 
    success: false, 
    message: 'Email-based registration is no longer supported. Use the bookmarklet to sync your AH purchases with your bonus card.' 
  })
})

// ============================================================================
// PASSWORD-BASED AUTHENTICATION ENDPOINTS (Deprecated)
// user_ah_credentials table removed - use bonus card instead
// ============================================================================

// Register new user with email and password (disabled)
app.post('/api/auth/register', async (req, res) => {
  res.status(501).json({ 
    error: 'not_supported', 
    message: 'Email-based registration is no longer supported. Use the bookmarklet to sync your AH purchases with your bonus card.' 
  })
})

// Login with email and password (disabled)
app.post('/api/auth/login', async (req, res) => {
  res.status(501).json({ 
    error: 'not_supported', 
    message: 'Email-based login is no longer supported. Use the bookmarklet to sync your AH purchases with your bonus card.' 
  })
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

// Get user ID from session (deprecated - user_ah_credentials table removed)
// Now we rely on bonus card identification via URL params and /api/bonus/:cardNumber/* endpoints
async function getUserIdFromSession(req) {
  // First check for JWT auth
  const jwtUser = await getUserFromRequest(req)
  if (jwtUser) {
    return jwtUser.id
  }
  
  // Session-based auth via user_ah_credentials is no longer available
  // Users should use bonus card identification instead
  return null
}

// Get ALL user IDs and bonus card associated with this request
// Returns { userIds: string[], bonusCardNumber: string|null }
// This helps find purchases that were stored by user_id OR bonus_card_number
async function getAllUserIds(req) {
  const userIds = []
  let bonusCardNumber = null
  
  // Get JWT user ID
  const jwtUser = await getUserFromRequest(req)
  if (jwtUser) {
    userIds.push(jwtUser.id)
  }
  
  // Check for bonus card in request body or query
  // (Session-based user_ah_credentials lookup removed)
  bonusCardNumber = req.body?.bonus_card?.toString().trim() || 
                    req.query?.card?.toString().trim() || 
                    null
  
  return { userIds, bonusCardNumber }
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
 * With user_ah_credentials removed, only checks users table.
 * Returns the user_id if found, null otherwise.
 */
async function getUserIdByAHEmail(ahEmail) {
  if (!supabase || !ahEmail) return null
  
  const normalizedEmail = ahEmail.toLowerCase().trim()
  
  try {
    // Check users table (main account email)
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
  const rawName = (originalName || '').toString().trim()
  
  // Clean up name - remove common noise patterns from AH product cards
  let name = rawName
    .replace(/,\s*(?:Nutri-Score|per stuk|per kg|€|\d+\s*voor|vandaag|morgen).*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  
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

// LEGACY: This database is no longer used for scoring
// Kept only for search results display (icons)
// Actual scoring comes from enriched data (kenmerken + herkomst)
const SUSTAINABILITY_DB = {
  categories: {
    organic: { icon: '🌱' },
    local: { icon: '🏡' },
    plant_based: { icon: '🥬' },
    fair_trade: { icon: '🤝' },
    fruit: { icon: '🍎' },
    vegetable: { icon: '🥕' },
    dairy: { icon: '🥛' },
    grain: { icon: '🌾' },
    legume: { icon: '🫘' },
    beverage: { icon: '🥤' }
  },
  products: {}  // No longer used - products come from database
}

// NOTE: All keyword-based matching has been removed
// Scoring and attributes now only come from scraped enriched data (kenmerken + herkomst sections)

// ============================================================================
// ENRICHED FIELD SCORING RULES
// Scoring ONLY comes from scraped product detail data (kenmerken + herkomst)
// Base score starts at 0
// ============================================================================

const ENRICHED_SCORING = {
  // Dietary preferences
  is_vegan: { delta: 3, icon: '🌱', label: 'Vegan' },
  is_vegetarian: { delta: 1, icon: '🥗', label: 'Vegetarian' },  // Only if not vegan
  is_organic: { delta: 4, icon: '🌿', label: 'Organic/Bio' },
  
  // Ethical certifications (only applies to non-EU products)
  is_fairtrade: { delta: 2, icon: '🤝', label: 'Fairtrade' },
  
  // NOTE: Nutri-Score is scraped and stored but NOT used for sustainability scoring
  // Reason: Nutri-Score measures nutritional health, not environmental sustainability
  
  // Origin scoring based on transport distance:
  // NL: +3 (local)
  // EU countries: +2
  // Outside EU (nearby): -1
  // Far from EU: -2
  origin_country: {
    // Netherlands (local, best)
    'Netherlands': { delta: 3, region: 'local' },
    // EU countries (+2)
    'Belgium': { delta: 2, region: 'europe' },
    'Germany': { delta: 2, region: 'europe' },
    'France': { delta: 2, region: 'europe' },
    'Spain': { delta: 2, region: 'europe' },
    'Italy': { delta: 2, region: 'europe' },
    'Poland': { delta: 2, region: 'europe' },
    'Greece': { delta: 2, region: 'europe' },
    'Portugal': { delta: 2, region: 'europe' },
    'Austria': { delta: 2, region: 'europe' },
    'Ireland': { delta: 2, region: 'europe' },
    'Denmark': { delta: 2, region: 'europe' },
    'Sweden': { delta: 2, region: 'europe' },
    'Hungary': { delta: 2, region: 'europe' },
    'Czech Republic': { delta: 2, region: 'europe' },
    'Romania': { delta: 2, region: 'europe' },
    'Bulgaria': { delta: 2, region: 'europe' },
    'Croatia': { delta: 2, region: 'europe' },
    'Slovenia': { delta: 2, region: 'europe' },
    'Slovakia': { delta: 2, region: 'europe' },
    'Lithuania': { delta: 2, region: 'europe' },
    'Latvia': { delta: 2, region: 'europe' },
    'Estonia': { delta: 2, region: 'europe' },
    'Finland': { delta: 2, region: 'europe' },
    'Luxembourg': { delta: 2, region: 'europe' },
    'Cyprus': { delta: 2, region: 'europe' },
    'Malta': { delta: 2, region: 'europe' },
    // Outside EU (nearby) - moderate transport (-1)
    'Morocco': { delta: -1, region: 'outside_eu' },
    'Turkey': { delta: -1, region: 'outside_eu' },
    'Egypt': { delta: -1, region: 'outside_eu' },
    'South Africa': { delta: -1, region: 'outside_eu' },
    'Kenya': { delta: -1, region: 'outside_eu' },
    'Israel': { delta: -1, region: 'outside_eu' },
    'Tunisia': { delta: -1, region: 'outside_eu' },
    'UK': { delta: -1, region: 'outside_eu' },
    'United Kingdom': { delta: -1, region: 'outside_eu' },
    'Norway': { delta: -1, region: 'outside_eu' },
    'Switzerland': { delta: -1, region: 'outside_eu' },
    // Far from EU (-2)
    'United States': { delta: -2, region: 'far' },
    'Brazil': { delta: -2, region: 'far' },
    'Argentina': { delta: -2, region: 'far' },
    'Chile': { delta: -2, region: 'far' },
    'Costa Rica': { delta: -2, region: 'far' },
    'Ecuador': { delta: -2, region: 'far' },
    'Colombia': { delta: -2, region: 'far' },
    'Peru': { delta: -2, region: 'far' },
    'Mexico': { delta: -2, region: 'far' },
    'China': { delta: -2, region: 'far' },
    'India': { delta: -2, region: 'far' },
    'Thailand': { delta: -2, region: 'far' },
    'Vietnam': { delta: -2, region: 'far' },
    'Indonesia': { delta: -2, region: 'far' },
    'Philippines': { delta: -2, region: 'far' },
    'Malaysia': { delta: -2, region: 'far' },
    'Sri Lanka': { delta: -2, region: 'far' },
    'Pakistan': { delta: -2, region: 'far' },
    'Bangladesh': { delta: -2, region: 'far' },
    'Australia': { delta: -2, region: 'far' },
    'New Zealand': { delta: -2, region: 'far' }
  }
}

// Month abbreviations for origin_by_month lookups
const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

// Dutch to English country name translations (AH uses Dutch names in origin data)
const DUTCH_TO_ENGLISH_COUNTRY = {
  'nederland': 'Netherlands',
  'belgië': 'Belgium',
  'belgie': 'Belgium',
  'duitsland': 'Germany',
  'frankrijk': 'France',
  'spanje': 'Spain',
  'italië': 'Italy',
  'italie': 'Italy',
  'polen': 'Poland',
  'griekenland': 'Greece',
  'portugal': 'Portugal',
  'oostenrijk': 'Austria',
  'ierland': 'Ireland',
  'denemarken': 'Denmark',
  'zweden': 'Sweden',
  'hongarije': 'Hungary',
  'tsjechië': 'Czech Republic',
  'tsjechie': 'Czech Republic',
  'roemenië': 'Romania',
  'roemenie': 'Romania',
  'bulgarije': 'Bulgaria',
  'kroatië': 'Croatia',
  'kroatie': 'Croatia',
  'slovenië': 'Slovenia',
  'slovenie': 'Slovenia',
  'slowakije': 'Slovakia',
  'litouwen': 'Lithuania',
  'letland': 'Latvia',
  'estland': 'Estonia',
  'finland': 'Finland',
  'luxemburg': 'Luxembourg',
  'cyprus': 'Cyprus',
  'malta': 'Malta',
  'marokko': 'Morocco',
  'turkije': 'Turkey',
  'egypte': 'Egypt',
  'zuid-afrika': 'South Africa',
  'kenia': 'Kenya',
  'israël': 'Israel',
  'israel': 'Israel',
  'tunesië': 'Tunisia',
  'tunesie': 'Tunisia',
  'verenigd koninkrijk': 'UK',
  'noorwegen': 'Norway',
  'zwitserland': 'Switzerland',
  'china': 'China',
  'india': 'India',
  'thailand': 'Thailand',
  'vietnam': 'Vietnam',
  'brazilië': 'Brazil',
  'brazilie': 'Brazil',
  'argentinië': 'Argentina',
  'argentinie': 'Argentina',
  'chili': 'Chile',
  'colombia': 'Colombia',
  'peru': 'Peru',
  'ecuador': 'Ecuador',
  'costa rica': 'Costa Rica',
  'mexico': 'Mexico',
  'indonesië': 'Indonesia',
  'indonesie': 'Indonesia',
  'filipijnen': 'Philippines',
  'maleisië': 'Malaysia',
  'maleisie': 'Malaysia',
  'sri lanka': 'Sri Lanka',
  'pakistan': 'Pakistan',
  'bangladesh': 'Bangladesh',
  'australië': 'Australia',
  'australie': 'Australia',
  'nieuw-zeeland': 'New Zealand'
}

/**
 * Translate a country name from Dutch to English
 * @param {string} countryName - Country name (potentially in Dutch)
 * @returns {string} - English country name
 */
function translateCountryName(countryName) {
  if (!countryName || typeof countryName !== 'string') return countryName
  const normalized = countryName.trim().toLowerCase()
  return DUTCH_TO_ENGLISH_COUNTRY[normalized] || countryName
}

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
 * @returns {string[]|null} - Array of country names for current month, or null if not available
 */
function getOriginsForCurrentMonth(originByMonth) {
  if (!originByMonth || typeof originByMonth !== 'object') return null
  const monthKey = getCurrentMonthKey()
  const monthOrigin = originByMonth[monthKey]
  if (!monthOrigin) return null
  
  // Parse origin value(s) and translate from Dutch to English
  let origins = []
  if (Array.isArray(monthOrigin)) {
    origins = monthOrigin
  } else if (typeof monthOrigin === 'string') {
    // Handle both single country and "Country1 / Country2" format
    origins = monthOrigin.split(/\s*\/\s*/).map(s => s.trim()).filter(Boolean)
  }
  
  // Translate all country names from Dutch to English
  return origins.length > 0 ? origins.map(translateCountryName) : null
}

// ============================================================================
// USER PROFILING SYSTEM
// Analyzes purchase patterns using enriched data (no keyword matching)
// ============================================================================

const USER_PROFILE_TYPES = {
  'eco_champion': {
    label: '🏆 Eco Champion',
    description: 'Amazing! You\'re already making excellent sustainable choices.',
    tips: ['Share your habits with friends', 'Try reducing packaging waste next']
  },
  'plant_forward': { 
    label: '🌱 Plant-Forward Shopper', 
    description: 'You prioritize plant-based and organic foods. Great for sustainability!',
    tips: ['Keep exploring new plant proteins', 'Try seasonal local vegetables']
  },
  'local_supporter': {
    label: '🏡 Local Supporter',
    description: 'You favor locally-sourced products. Great for reducing transport emissions!',
    tips: ['Check for seasonal Dutch produce', 'Try organic versions of local favorites']
  },
  'balanced': { 
    label: '⚖️ Balanced Shopper', 
    description: 'You have a varied diet with room for sustainable swaps.',
    tips: ['Look for local Dutch products', 'Try organic versions of your favorites']
  }
}

/**
 * Analyze user's purchase history to build a profile
 * Uses enriched data fields only (no keyword matching)
 */
function analyzeUserProfile(purchases) {
  const profile = {
    totalProducts: purchases.length,
    enrichedBreakdown: { vegan: 0, vegetarian: 0, organic: 0, fairtrade: 0, local: 0, eu: 0, imported: 0 },
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
  const lowScoreProducts = []
  const highScoreProducts = []

  for (const purchase of purchases) {
    // Get enriched data from purchase record
    const enriched = getEnrichedData(purchase)
    const evaluation = evaluateProduct(purchase.product_name, enriched)
    const score = evaluation.score
    totalScore += score

    // Score distribution (based on new 0-10 scale)
    if (score <= 2) {
      profile.scoreDistribution.low++
      lowScoreProducts.push({ name: purchase.product_name, score, evaluation, enriched })
    } else if (score <= 5) {
      profile.scoreDistribution.medium++
    } else {
      profile.scoreDistribution.high++
      highScoreProducts.push({ name: purchase.product_name, score, enriched })
    }

    // Count enriched attributes
    if (enriched) {
      if (enriched.is_vegan) profile.enrichedBreakdown.vegan++
      else if (enriched.is_vegetarian) profile.enrichedBreakdown.vegetarian++
      if (enriched.is_organic) profile.enrichedBreakdown.organic++
      if (enriched.is_fairtrade) profile.enrichedBreakdown.fairtrade++
      
      // Origin breakdown
      const origins = enriched.origin_by_month ? 
        getOriginsForCurrentMonth(enriched.origin_by_month) : 
        (enriched.origin_country ? [translateCountryName(enriched.origin_country)] : null)
      
      if (origins && origins.length > 0) {
        const originScoring = ENRICHED_SCORING.origin_country
        if (origins.some(c => c === 'Netherlands')) {
          profile.enrichedBreakdown.local++
        } else if (origins.every(c => originScoring[c]?.region === 'europe')) {
          profile.enrichedBreakdown.eu++
        } else {
          profile.enrichedBreakdown.imported++
        }
      }
    }
  }

  profile.avgScore = totalScore / purchases.length

  // Determine profile type based on enriched data counts
  const total = purchases.length
  const veganRatio = profile.enrichedBreakdown.vegan / total
  const organicRatio = profile.enrichedBreakdown.organic / total
  const localRatio = profile.enrichedBreakdown.local / total

  if (profile.avgScore >= 6) {
    profile.profileType = 'eco_champion'
  } else if (veganRatio > 0.15 || organicRatio > 0.2) {
    profile.profileType = 'plant_forward'
  } else if (localRatio > 0.3) {
    profile.profileType = 'local_supporter'
  } else {
    profile.profileType = 'balanced'
  }

  profile.improvements = lowScoreProducts.sort((a, b) => a.score - b.score).slice(0, 5)
  profile.strengths = highScoreProducts.sort((a, b) => b.score - a.score).slice(0, 3)

  return profile
}

/**
 * Find sustainable replacement suggestions based on enriched data
 */
function findReplacementSuggestions(lowScoreProducts, catalogProducts) {
  const suggestions = []

  // Score all catalog products with enriched data
  const scoredCatalog = catalogProducts.map(p => {
    const enriched = getEnrichedData(p)
    const evaluation = evaluateProduct(p.name, enriched)
    return { ...p, score: evaluation.score, enriched, evaluation }
  }).filter(p => p.score >= 5) // Only suggest products with decent scores

  for (const product of lowScoreProducts) {
    // Find higher-scoring alternatives
    const alternatives = scoredCatalog
      .filter(alt => alt.score > product.score + 1) // At least 2 points improvement
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)

    if (alternatives.length > 0) {
      const bestAlt = alternatives[0]
      const improvement = bestAlt.score - product.score

      suggestions.push({
        original: { name: product.name, score: product.score },
        replacement: {
          name: bestAlt.name,
          score: bestAlt.score,
          url: makeAbsoluteAhUrl(bestAlt.url),
          image_url: bestAlt.image_url,
          price: bestAlt.price
        },
        improvement,
        reason: getReplacementReason(product.enriched, bestAlt.enriched)
      })
    }
  }

  return suggestions.sort((a, b) => b.improvement - a.improvement).slice(0, 6)
}

/**
 * Generate a human-readable reason for a replacement suggestion
 * Based on enriched data differences
 */
function getReplacementReason(originalEnriched, replacementEnriched) {
  if (!originalEnriched && replacementEnriched?.is_organic) {
    return '🌱 Organic product - better for soil & biodiversity'
  }
  if (!originalEnriched?.is_vegan && replacementEnriched?.is_vegan) {
    return '🌱 Vegan option - significantly lower environmental impact'
  }
  if (replacementEnriched?.is_organic && !originalEnriched?.is_organic) {
    return '🌱 Organic version - better for soil & biodiversity'
  }
  
  // Check if replacement is more local
  const origOrigin = originalEnriched?.origin_country
  const replOrigin = replacementEnriched?.origin_country
  if (replOrigin === 'Netherlands' && origOrigin !== 'Netherlands') {
    return '📍 Local Dutch product - reduced transport emissions'
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
        const tokens = normalized.split(' ')
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
  // Base score starts at 0 - all scoring comes from enriched data only
  let workingScore = 0
  const adjustments = []
  const matchedEnriched = []  // Track enriched field matches
  let suggestions = getSuggestions(input, lang)

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

  // Helper to check if product origin is within EU
  const isOriginInEU = (origins) => {
    if (!origins || origins.length === 0) return false
    const euCountries = new Set(['Netherlands', 'Belgium', 'Germany', 'France', 'Spain', 'Italy', 
      'Poland', 'Greece', 'Portugal', 'Austria', 'Ireland', 'Denmark', 'Sweden', 'Hungary',
      'Czech Republic', 'Romania', 'Bulgaria', 'Croatia', 'Slovenia', 'Slovakia', 'Lithuania',
      'Latvia', 'Estonia', 'Finland', 'Luxembourg', 'Cyprus', 'Malta'])
    return origins.every(country => euCountries.has(country))
  }

  // Scoring ONLY comes from enriched data (kenmerken and herkomst sections)
  if (enrichedData && typeof enrichedData === 'object') {
    // Organic/Bio scoring (+4)
    if (enrichedData.is_organic === true) {
      const scoring = ENRICHED_SCORING.is_organic
      applyDelta('enriched', 'enriched_organic', scoring.delta)
      matchedEnriched.push({ code: 'organic', icon: scoring.icon, label: scoring.label, delta: scoring.delta })
    }

    // Vegan scoring (+3)
    if (enrichedData.is_vegan === true) {
      const scoring = ENRICHED_SCORING.is_vegan
      applyDelta('enriched', 'enriched_vegan', scoring.delta)
      matchedEnriched.push({ code: 'vegan', icon: scoring.icon, label: scoring.label, delta: scoring.delta })
    } 
    // Vegetarian scoring (+1, only if not vegan)
    else if (enrichedData.is_vegetarian === true) {
      const scoring = ENRICHED_SCORING.is_vegetarian
      applyDelta('enriched', 'enriched_vegetarian', scoring.delta)
      matchedEnriched.push({ code: 'vegetarian', icon: scoring.icon, label: scoring.label, delta: scoring.delta })
    }

    // Origin country scoring (from herkomst section)
    // Check monthly origin first (origin_by_month), then fall back to static origin_country
    // When multiple countries are listed, use AVERAGE of deltas
    let effectiveOrigins = null
    let isSeasonalOrigin = false
    
    if (enrichedData.origin_by_month) {
      effectiveOrigins = getOriginsForCurrentMonth(enrichedData.origin_by_month)
      isSeasonalOrigin = effectiveOrigins !== null
    }
    
    // Fall back to static origin if no monthly origin available
    if (!effectiveOrigins && enrichedData.origin_country) {
      // Translate Dutch country name to English for scoring lookup
      effectiveOrigins = [translateCountryName(enrichedData.origin_country)]
    }
    
    if (effectiveOrigins && effectiveOrigins.length > 0) {
      const monthLabel = isSeasonalOrigin ? ` (${getCurrentMonthKey().toUpperCase()})` : ''
      
      // Calculate AVERAGE delta for all origin countries
      let totalDelta = 0
      const countryDetails = []
      
      for (const country of effectiveOrigins) {
        const originScoring = ENRICHED_SCORING.origin_country[country]
        if (originScoring) {
          totalDelta += originScoring.delta
          countryDetails.push({ country, delta: originScoring.delta, region: originScoring.region })
        } else {
          // Unknown country - treat as outside_eu
          totalDelta += -1
          countryDetails.push({ country, delta: -1, region: 'unknown' })
        }
      }
      
      // Calculate average (rounded to 1 decimal)
      const avgDelta = Math.round((totalDelta / effectiveOrigins.length) * 10) / 10
      
      // Apply the averaged delta
      if (avgDelta !== 0) {
        applyDelta('enriched', 'enriched_origin_avg', avgDelta)
      }
      
      // Build the label showing all countries
      const countriesLabel = effectiveOrigins.join(', ')
      const icon = avgDelta > 0 ? '📍' : (avgDelta < 0 ? '✈️' : '🌍')
      
      matchedEnriched.push({ 
        code: 'origin', 
        icon, 
        label: `Origin: ${countriesLabel}${monthLabel}`, 
        delta: avgDelta,
        countries: countryDetails,
        isSeasonal: isSeasonalOrigin,
        originByMonth: enrichedData.origin_by_month
      })

      // Fairtrade scoring (+2, only applies to non-EU products)
      if (enrichedData.is_fairtrade === true && !isOriginInEU(effectiveOrigins)) {
        const scoring = ENRICHED_SCORING.is_fairtrade
        applyDelta('enriched', 'enriched_fairtrade', scoring.delta)
        matchedEnriched.push({ code: 'fairtrade', icon: scoring.icon, label: scoring.label, delta: scoring.delta })
      }
    } else {
      // Fairtrade without origin data - still apply (assume non-EU since we don't know)
      if (enrichedData.is_fairtrade === true) {
        const scoring = ENRICHED_SCORING.is_fairtrade
        applyDelta('enriched', 'enriched_fairtrade', scoring.delta)
        matchedEnriched.push({ code: 'fairtrade', icon: scoring.icon, label: scoring.label, delta: scoring.delta })
      }
    }
  }

  const rawScore = clamp(workingScore)
  const finalScore = roundClamp(workingScore)

  return {
    product: input,
    normalized,
    baseScore: 0,
    rawScore,
    score: finalScore,
    adjustments,
    enriched: matchedEnriched,
    suggestions,
    rating: getRating(finalScore),
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
  // Scale: 0-10 (base 0, max practical ~12 clamped to 10)
  // 8+: organic + vegan + local origin
  // 5-7: good sustainability attributes
  // 2-4: some attributes or neutral
  // 0-1: no enriched data or negative attributes
  if (avgScore >= 8) return "🌟 Excellent! You're making great sustainable choices!"
  if (avgScore >= 5) return '👍 Good! Room for improvement though.'
  if (avgScore >= 2) return '😐 Average. Consider more sustainable alternatives.'
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

// Get user's AH credentials status (deprecated - table removed)
app.get('/api/user/ah-credentials', requireAuth, async (req, res) => {
  res.json({ configured: false, message: 'AH credentials storage removed. Use bonus card instead.' })
})

// Save user's AH credentials (deprecated - table removed)
app.post('/api/user/ah-credentials', requireAuth, async (req, res) => {
  res.status(501).json({ error: 'not_supported', message: 'AH credentials storage removed. Use the bookmarklet with your bonus card.' })
})

// Save user's AH email and password for scraping (deprecated - table removed)
app.post('/api/user/ah-credentials/password', requireAuth, async (req, res) => {
  res.status(501).json({ error: 'not_supported', message: 'AH credentials storage removed. Use the bookmarklet with your bonus card.' })
})

// Link bonus card number (deprecated - user_ah_credentials table removed)
// Bonus card is now only stored in localStorage on frontend
// and passed via URL params or request body
app.post('/api/user/link-bonus-card', async (req, res) => {
  const { bonusCardNumber } = req.body
  if (!bonusCardNumber) {
    return res.status(400).json({ error: 'missing_bonus_card', message: 'Bonus card number is required' })
  }
  // Just acknowledge - no server-side storage needed
  // Bonus card is stored in localStorage and passed with each request
  res.json({ success: true, message: 'Bonus card acknowledged (stored client-side)', bonusCard: bonusCardNumber.slice(-4).padStart(13, '•') })
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
    // Get all user IDs (JWT + session-based) and bonus card to merge purchases
    const { userIds, bonusCardNumber } = await getAllUserIds(req)
    console.log('[Insights] Fetching for user IDs:', userIds, 'bonus card:', bonusCardNumber ? '****' + bonusCardNumber.slice(-4) : 'none')
    
    if (userIds.length === 0 && !bonusCardNumber) {
      return res.json({ message: 'No purchases yet!' })
    }
    
    // Build query to fetch by user_id OR bonus_card_number
    // Join with products table to get enriched data for scoring
    let query = supabase
      .from('user_purchases')
      .select('product_id, product_name, quantity, price')
    
    if (userIds.length > 0 && bonusCardNumber) {
      // Query by both user_id and bonus_card_number using OR
      query = query.or(`user_id.in.(${userIds.join(',')}),bonus_card_number.eq.${bonusCardNumber}`)
    } else if (userIds.length > 0) {
      query = query.in('user_id', userIds)
    } else if (bonusCardNumber) {
      query = query.eq('bonus_card_number', bonusCardNumber)
    }
    
    const { data: purchases, error } = await query
    
    if (error) throw error
    
    if (!purchases || purchases.length === 0) {
      return res.json({ message: 'No purchases yet!' })
    }

    // Get enriched data for all purchased products
    const productIds = purchases.map(p => p.product_id).filter(Boolean)
    let productsMap = new Map()
    if (productIds.length > 0) {
      const { data: products } = await supabase
        .from('products')
        .select('id, is_vegan, is_vegetarian, is_organic, is_fairtrade, origin_country, origin_by_month, nutri_score')
        .in('id', productIds)
      if (products) {
        productsMap = new Map(products.map(p => [p.id, p]))
      }
    }
    
    // Calculate sustainability scores on the fly using enriched data
    const purchasesWithScores = purchases.map(p => {
      const product = productsMap.get(p.product_id)
      const enrichedData = product ? getEnrichedData(product) : null
      return {
        ...p,
        sustainability_score: evaluateProduct(p.product_name, enrichedData).score
      }
    })
    
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
    
    // Get all user IDs (JWT + session-based) and bonus card to merge purchases
    const { userIds, bonusCardNumber } = await getAllUserIds(req)
    console.log('[History] Fetching for user IDs:', userIds, 'bonus card:', bonusCardNumber ? '****' + bonusCardNumber.slice(-4) : 'none')
    
    if (userIds.length === 0 && !bonusCardNumber) {
      return res.json({ 
        purchases: [], 
        total: 0,
        page,
        limit,
        totalPages: 0
      })
    }
    
    // Build query to fetch by user_id OR bonus_card_number
    let query = supabase
      .from('user_purchases')
      .select('*', { count: 'exact' })
    
    if (userIds.length > 0 && bonusCardNumber) {
      // Query by both user_id and bonus_card_number using OR
      query = query.or(`user_id.in.(${userIds.join(',')}),bonus_card_number.eq.${bonusCardNumber}`)
    } else if (userIds.length > 0) {
      query = query.in('user_id', userIds)
    } else if (bonusCardNumber) {
      query = query.eq('bonus_card_number', bonusCardNumber)
    }
    
    const { data: purchases, error, count } = await query
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
      // Pass enriched data to evaluateProduct for accurate scoring
      const evaluation = evaluateProduct(purchase.product_name, enriched)
      
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
      .select('product_name, quantity, price, product_id')
      .eq('bonus_card_number', cardNumber)
    
    if (error) {
      console.error('Supabase query error:', error)
      throw error
    }
    
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
    
    // Get product IDs to fetch enriched data (separate query, more reliable)
    const productIds = [...new Set(purchases.map(p => p.product_id).filter(Boolean))]
    
    // Fetch enriched product data (including price fallback)
    let productsMap = new Map()
    if (productIds.length > 0) {
      const { data: products, error: prodError } = await supabase
        .from('products')
        .select('id, is_vegan, is_vegetarian, is_organic, is_fairtrade, nutri_score, origin_country, origin_by_month, price')
        .in('id', productIds)
      
      if (prodError) {
        console.warn('Products fetch warning:', prodError.message)
      } else if (products) {
        productsMap = new Map(products.map(p => [p.id, p]))
      }
    }
    
    // Calculate sustainability scores using enriched data from products table
    const purchasesWithScores = purchases.map(p => {
      const product = productsMap.get(p.product_id)
      const enrichedData = product ? {
        is_vegan: product.is_vegan,
        is_vegetarian: product.is_vegetarian,
        is_organic: product.is_organic,
        is_fairtrade: product.is_fairtrade,
        nutri_score: product.nutri_score,
        origin_country: product.origin_country,
        origin_by_month: product.origin_by_month
      } : null
      return {
        ...p,
        // Use purchase price, fall back to product price if null
        price: p.price ?? product?.price ?? null,
        sustainability_score: evaluateProduct(p.product_name, enrichedData).score
      }
    })
    
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
    // Get all user IDs (JWT + session-based) and bonus card to merge purchases
    const { userIds, bonusCardNumber } = await getAllUserIds(req)
    console.log('[Suggestions] Fetching for user IDs:', userIds, 'bonus card:', bonusCardNumber ? '****' + bonusCardNumber.slice(-4) : 'none')
    
    if (userIds.length === 0 && !bonusCardNumber) {
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
    
    // Build query to fetch by user_id OR bonus_card_number
    let query = supabase
      .from('user_purchases')
      .select('product_name, quantity, price')
    
    if (userIds.length > 0 && bonusCardNumber) {
      query = query.or(`user_id.in.(${userIds.join(',')}),bonus_card_number.eq.${bonusCardNumber}`)
    } else if (userIds.length > 0) {
      query = query.in('user_id', userIds)
    } else if (bonusCardNumber) {
      query = query.eq('bonus_card_number', bonusCardNumber)
    }
    
    const { data: purchases, error: purchasesError } = await query
    
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
    
    // Base score (starts at 0, all scoring comes from enriched data)
    breakdown.push({
      label: 'Base Score',
      value: '0',
      positive: false,
      negative: false
    })
    
    // Add adjustment explanations (only enriched type exists now)
    for (const adj of evaluation.adjustments) {
      let label = ''
      let positive = adj.delta > 0
      let negative = adj.delta < 0
      
      // All adjustments are now from enriched data (kenmerken/herkomst sections)
      const enrichedMap = {
        'enriched_vegan': 'Vegan',
        'enriched_vegetarian': 'Vegetarian',
        'enriched_organic': 'Organic Certified',
        'enriched_fairtrade': 'Fairtrade Certified',
        'enriched_origin_avg': adj.delta > 0 ? 'Origin (Local/EU)' : 'Origin (Distant)',
        'enriched_nutriscore_A': 'Nutri-Score A',
        'enriched_nutriscore_B': 'Nutri-Score B',
        'enriched_nutriscore_C': 'Nutri-Score C',
        'enriched_nutriscore_D': 'Nutri-Score D',
        'enriched_nutriscore_E': 'Nutri-Score E'
      }
      label = enrichedMap[adj.code] || adj.code.replace('enriched_', '').replace(/_/g, ' ')
      
      breakdown.push({
        label,
        value: (adj.delta > 0 ? '+' : '') + adj.delta.toFixed(1),
        positive,
        negative
      })
    }
    
    // NOTE: Final Score removed from breakdown - it's already shown above the breakdown section
    
    // Create improvement reasons from enriched data
    const improvements = []
    
    // Positive factors from enriched data
    for (const adj of evaluation.adjustments.filter(a => a.delta > 0)) {
      const codeMap = {
        'enriched_organic': '🌱 Organic/Bio certified',
        'enriched_vegan': '🌿 Vegan product',
        'enriched_vegetarian': '🥬 Vegetarian product',
        'enriched_fairtrade': '🤝 Fairtrade certified',
        'enriched_origin_avg': '📍 Origin bonus'
      }
      improvements.push({
        reason: codeMap[adj.code] || `✅ ${adj.code.replace('enriched_', '').replace(/_/g, ' ')} bonus`,
        positive: true
      })
    }
    
    // Negative factors from enriched data
    for (const adj of evaluation.adjustments.filter(a => a.delta < 0)) {
      const codeMap = {
        'enriched_origin_avg': '✈️ Distant origin penalty'
      }
      improvements.push({
        reason: codeMap[adj.code] || `⚠️ ${adj.code.replace('enriched_', '').replace(/_/g, ' ')} penalty`,
        positive: false
      })
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
      enrichedFactors: evaluation.enriched || [],
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

// Debug endpoint to check user_purchases table state
app.get('/api/debug/purchases', async (req, res) => {
  const bonusCard = req.query.card
  try {
    // Check table structure
    const { data: columns, error: colError } = await supabase
      .from('user_purchases')
      .select('*')
      .limit(1)
    
    // Count total rows
    const { count: totalCount } = await supabase
      .from('user_purchases')
      .select('*', { count: 'exact', head: true })
    
    // Count rows for this bonus card
    let bonusCount = 0
    let samplePurchases = []
    if (bonusCard) {
      const { count, data: purchases } = await supabase
        .from('user_purchases')
        .select('product_name, bonus_card_number, scraped_at', { count: 'exact' })
        .eq('bonus_card_number', bonusCard)
        .limit(5)
      bonusCount = count
      samplePurchases = purchases || []
    }
    
    // Get all unique bonus cards (masked for privacy)
    const { data: allCards } = await supabase
      .from('user_purchases')
      .select('bonus_card_number')
      .not('bonus_card_number', 'is', null)
    
    const uniqueCards = [...new Set(allCards?.map(r => r.bonus_card_number) || [])]
    const maskedCards = uniqueCards.map(card => ({
      masked: card ? '•••••••••' + card.slice(-4) : 'null',
      length: card?.length || 0,
      matches_query: bonusCard ? (card === bonusCard) : null,
      count: allCards?.filter(r => r.bonus_card_number === card).length || 0
    }))
    
    // Check products table
    const { count: productCount } = await supabase
      .from('products')
      .select('*', { count: 'exact', head: true })
    
    res.json({
      query_card: bonusCard ? {
        provided: '•••••••••' + bonusCard.slice(-4),
        length: bonusCard.length,
        is_valid_format: /^\d{13}$/.test(bonusCard)
      } : null,
      user_purchases: {
        total_rows: totalCount,
        bonus_card_rows: bonusCount,
        sample_purchases: samplePurchases.map(p => ({ name: p.product_name, scraped_at: p.scraped_at })),
        sample_columns: columns?.[0] ? Object.keys(columns[0]) : [],
        error: colError?.message
      },
      all_bonus_cards: maskedCards,
      products: {
        total_rows: productCount
      },
      supabase_connected: !!supabase
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ==== QUESTIONNAIRE ENDPOINTS ====
// Submit questionnaire responses (pre/post exposure surveys)
app.post('/api/questionnaire/submit', async (req, res) => {
  try {
    const { bonus_card, questionnaire_type, responses } = req.body
    
    if (!bonus_card) {
      return res.status(400).json({ error: 'bonus_card is required' })
    }
    
    if (!questionnaire_type || !['pre', 'post'].includes(questionnaire_type)) {
      return res.status(400).json({ error: 'questionnaire_type must be "pre" or "post"' })
    }
    
    if (!responses || typeof responses !== 'object') {
      return res.status(400).json({ error: 'responses object is required' })
    }
    
    // Upsert the questionnaire response (update if exists, insert if not)
    const { data, error } = await supabase
      .from('questionnaire_responses')
      .upsert({
        bonus_card,
        questionnaire_type,
        responses,
        created_at: new Date().toISOString()
      }, {
        onConflict: 'bonus_card,questionnaire_type'
      })
      .select()
    
    if (error) {
      console.error('[questionnaire/submit] Error:', error)
      return res.status(500).json({ error: error.message })
    }
    
    res.json({ 
      success: true, 
      message: `${questionnaire_type} questionnaire saved`,
      data 
    })
  } catch (e) {
    console.error('[questionnaire/submit] Exception:', e)
    res.status(500).json({ error: e.message })
  }
})

// Get questionnaire responses for a bonus card
app.get('/api/questionnaire/:bonusCard', async (req, res) => {
  try {
    const { bonusCard } = req.params
    const { type } = req.query
    
    let query = supabase
      .from('questionnaire_responses')
      .select('*')
      .eq('bonus_card', bonusCard)
    
    if (type && ['pre', 'post'].includes(type)) {
      query = query.eq('questionnaire_type', type)
    }
    
    const { data, error } = await query
    
    if (error) {
      return res.status(500).json({ error: error.message })
    }
    
    res.json({ responses: data })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Check if user has completed questionnaires
app.get('/api/questionnaire/:bonusCard/status', async (req, res) => {
  try {
    const { bonusCard } = req.params
    
    const { data, error } = await supabase
      .from('questionnaire_responses')
      .select('questionnaire_type')
      .eq('bonus_card', bonusCard)
    
    if (error) {
      return res.status(500).json({ error: error.message })
    }
    
    const completed = data.map(r => r.questionnaire_type)
    
    res.json({ 
      pre_completed: completed.includes('pre'),
      post_completed: completed.includes('post')
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Debug endpoint to test inserting into user_purchases
app.post('/api/debug/test-insert', async (req, res) => {
  const bonusCard = req.body.bonus_card || '4463986084997'
  const now = new Date().toISOString()
  
  const testRecord = {
    bonus_card_number: bonusCard,
    product_id: 'test-product-' + Date.now(),
    product_name: 'Test Product',
    product_url: null,
    price: 1.99,
    quantity: 1,
    source: 'debug_test',
    purchased_at: now,
    scraped_at: now,
    last_seen_at: now
  }
  
  try {
    const { data, error } = await supabase
      .from('user_purchases')
      .insert([testRecord])
      .select()
    
    if (error) {
      return res.json({
        success: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          hint: error.hint
        },
        attempted_record: testRecord
      })
    }
    
    res.json({
      success: true,
      inserted: data,
      record: testRecord
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
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
    // Check both JWT auth AND session-based auth
    let user = await getUserFromRequest(req)
    let userId = user?.id || null
    
    // If no JWT user, try session-based auth
    if (!userId) {
      userId = await getUserIdFromSession(req)
    }
    
    const bonusCard = req.body?.bonus_card?.toString().trim() || null
    const sessionId = req.headers['x-session-id']
    
    console.log(`[Ingest] Received ${items.length} items, userId: ${userId ? 'yes' : 'no'}, bonusCard: ${bonusCard ? bonusCard.slice(-4) : 'none'}, sessionId: ${sessionId ? 'yes' : 'no'}`)

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

      // NOTE: is_vegan, is_organic, etc. are NOT set from product names
      // These fields are populated ONLY by the enrichment scraper (kenmerken section)

      // Parse price - handle both number and string formats (e.g., "€2.99", "2,99")
      // Price should come from scraper (eerder-gekocht page) or batch enrichment
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

      // Parse image URL
      const imageUrl = (raw?.image_url || raw?.image || '').toString().trim() || null

      const productRecord = {
        id: extracted.id,
        name: extracted.name,
        normalized_name: extracted.normalized,
        url: url || null,
        price: parsedPrice,
        source,
        // NOTE: Enriched fields (is_vegan, is_organic, origin, etc.) are set by the scraper
        // not auto-detected from product names
        updated_at: new Date().toISOString()
      }
      
      // Only include image_url if we have one (preserve existing on re-sync)
      if (imageUrl) {
        productRecord.image_url = imageUrl
      }

      cleaned.push(productRecord)
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
      if (userId || bonusCard) {
        const now = new Date().toISOString()
        const purchaseRecords = cleaned.map(p => ({
          ...(userId ? { user_id: userId } : {}),
          ...(bonusCard ? { bonus_card_number: bonusCard } : {}),
          product_id: p.id,
          product_name: p.name,
          product_url: p.url,  // Include URL for scraper to use
          price: p.price,
          quantity: 1,
          source: req.body?.source || 'bookmarklet',
          purchased_at: now,
          scraped_at: now,      // Required NOT NULL column
          last_seen_at: now
        }))

        console.log(`[Ingest] Recording ${purchaseRecords.length} purchases for ${userId ? 'user ' + userId : 'bonus card ****' + bonusCard?.slice(-4)}`)
        console.log(`[Ingest] Sample purchase record:`, JSON.stringify(purchaseRecords[0], null, 2))

        // Try simple INSERT first (most reliable)
        // If duplicates exist, they'll fail with 23505 which is OK
        const { data, error: insertError } = await supabase
          .from('user_purchases')
          .insert(purchaseRecords)
          .select()
        
        if (insertError) {
          // Duplicate key error is OK - means products already exist
          if (insertError.code === '23505') {
            console.log('[Ingest] Some purchases already exist (duplicate key) - that is OK')
            purchasesRecorded = purchaseRecords.length
          } else {
            purchaseError = insertError
            console.error('[Ingest] Purchase insert FAILED:', JSON.stringify({
              code: insertError.code,
              message: insertError.message,
              details: insertError.details,
              hint: insertError.hint
            }, null, 2))
          }
        } else {
          purchasesRecorded = data?.length || purchaseRecords.length
          console.log(`[Ingest] SUCCESS: Inserted ${purchasesRecorded} purchase records`)
        }
      } else {
        console.log('[Ingest] No userId or bonusCard - skipping user_purchases insert')
      }
    }

    // Build redirect URL for bookmarklet
    // Use custom APP_URL env var, or default to production domain
    // Query params must come BEFORE hash fragment
    // Redirect to pre-exposure questionnaire first, then user will see dashboard
    const appBase = process.env.APP_URL || 'https://www.bubblebrainz.com'
    const redirectUrl = bonusCard ? `${appBase}/?card=${bonusCard}#questionnaire?type=pre` : null

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

// ============================================================================
// CREDENTIAL-BASED SCRAPING REMOVED FOR PRIVACY/LEGAL REASONS
// Use the bookmarklet method instead which doesn't require storing credentials
// ============================================================================

// POST /api/auto-scrape - REMOVED (was: credential-based scraping)
app.post('/api/auto-scrape', async (req, res) => {
  return res.status(410).json({ 
    error: 'endpoint_removed',
    message: 'Credential-based scraping has been removed. Use the bookmarklet method instead which does not require storing credentials.'
  })
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
  
  // Get user ID for tracking (no credential storage)
  const user = await getUserFromRequest(req)
  const userId = user?.id || null
  
  const startedAt = new Date().toISOString()
  cookieCaptureState.running = true
  cookieCaptureState.startedAt = startedAt
  cookieCaptureState.logs = []
  cookieCaptureState.userId = userId
  
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
  
  // For email-based users, look up or create user_id from email header
  const { email } = req.body || {}
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
              product_url: p.url,
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
  
  // Get user from session ID or JWT (for recording purchases, no credential storage)
  const userId = await getUserIdFromSession(req) || req.body?.user_id || null
  console.log('[DEBUG] With-cookies - userId:', userId)
  
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
  
  // Account protection check removed - user_ah_credentials table no longer used
  const accountProtectionAlreadyDisabled = false
  
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
          
          // Sync status update removed - user_ah_credentials table no longer used
          appendAutoScrapeLog('info', '✅ Scrape completed successfully')
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
// ADMIN ENDPOINTS (CREDENTIAL MANAGEMENT REMOVED)
// Credential-based admin scraping has been removed for privacy/legal reasons
// ============================================================================

// NOTE: The following admin endpoints have been removed because they handled user credentials:
// - GET /api/admin/ah-credentials - listed users with stored credentials
// - GET /api/admin/ah-credentials/:userId - retrieved decrypted credentials
// - PATCH /api/admin/ah-credentials/:userId - updated sync status
// - POST /api/admin/scrape/:userId - ran scrapes using stored credentials
//
// Use the bookmarklet method instead which doesn't require storing credentials.

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
