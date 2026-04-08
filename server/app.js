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

import {
  getCO2Emissions,
  co2ToScore,
  getCO2Rating,
  getCategoryLabel,
  evaluateProductCO2,
  isNonFood,
  compareToBaseline,
  DIETARY_BASELINES,
  getProductWeight
} from './co2Emissions.js'

import { findSmartAlternatives, getSmartSuggestions, CATEGORY_SWAPS } from './suggestionEngine.js'

import {
  getGenericQuiz1Items,
  getGenericQuiz3Items,
  getAHQuiz5Items,
  getAHQuiz6Items,
  calculateRankingScore,
  assignABVariant,
  getProductCO2,
  SELF_PERCEPTION_QUESTIONS,
  REFLECTION_QUESTIONS,
  PRE_QUESTIONNAIRE_QUESTIONS,
  POST_QUESTIONNAIRE_QUESTIONS,
  EXPERIMENT_STEPS,
  getNextStep
} from './co2Experiment.js'

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

// Background origin scraper state (runs after product ingestion)
const originScraperState = {
  running: false,
  lastRun: null,
  productsScraped: 0
}

/**
 * Trigger the batch origin scraper in the background after products are ingested.
 * This populates origin_country, price, and other details for new products.
 * Non-blocking - runs asynchronously without waiting for completion.
 */
function triggerBackgroundOriginScraper() {
  // Skip if already running or no Python available
  if (originScraperState.running) {
    console.log('[OriginScraper] Already running, skipping trigger')
    return
  }
  
  // Check if script exists
  const scriptPath = path.resolve(__dirname, 'batch_origin_scraper.py')
  if (!existsSync(scriptPath)) {
    console.log('[OriginScraper] Script not found:', scriptPath)
    return
  }
  
  // Check if running on Vercel (no Python available)
  if (process.env.VERCEL) {
    console.log('[OriginScraper] Skipping on Vercel - no Python runtime')
    return
  }
  
  originScraperState.running = true
  console.log('[OriginScraper] Starting background scrape for new products...')
  
  try {
    const scraperProcess = spawn(PYTHON_CMD, [
      scriptPath,
      '--mode', 'purchases',
      '--limit', '20',  // Limit to 20 products per run to avoid overload
      '--delay', '2'
    ], {
      cwd: __dirname,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    
    let productsScraped = 0
    
    scraperProcess.stdout.on('data', (data) => {
      const text = data.toString()
      console.log('[OriginScraper]', text.trim())
      // Parse "Updated: X" from output
      const match = text.match(/Updated:\s*(\d+)/i)
      if (match) {
        productsScraped = parseInt(match[1], 10)
      }
    })
    
    scraperProcess.stderr.on('data', (data) => {
      console.error('[OriginScraper ERROR]', data.toString().trim())
    })
    
    scraperProcess.on('close', (code) => {
      originScraperState.running = false
      originScraperState.lastRun = new Date().toISOString()
      originScraperState.productsScraped = productsScraped
      console.log(`[OriginScraper] Completed with exit code ${code}, scraped ${productsScraped} products`)
    })
    
    scraperProcess.on('error', (err) => {
      originScraperState.running = false
      console.error('[OriginScraper] Process error:', err.message)
    })
    
  } catch (err) {
    originScraperState.running = false
    console.error('[OriginScraper] Failed to spawn:', err.message)
  }
}

app.use(cors())
app.use(bodyParser.json({ limit: '2mb' }))

// ============================================================================
// HEALTH CHECK ENDPOINT (for deployment monitoring)
// ============================================================================
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development'
  })
})

// AH user check/register removed — users table dropped, bonus card is the only auth method

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

// Get bonus card from request (query param or body)
function getBonusCard(req) {
  return req.body?.bonus_card?.toString().trim() ||
         req.query?.card?.toString().trim() ||
         req.user?.bonusCard ||
         null
}

// requireAuth now just delegates to requireAHEmail (bonus card is the only auth)
const requireAuth = (req, res, next) => requireAHEmail(req, res, next)

/**
 * Middleware: authenticate via bonus card (query/body) or JWT fallback.
 * Sets req.user = { id, bonusCard } or returns 401.
 */
function requireAHEmail(req, res, next) {
  // Primary: bonus card from query or body
  const bonusCard = req.query?.card?.toString().trim() || req.body?.bonus_card?.toString().trim() || null
  if (bonusCard) {
    req.user = { id: bonusCard, bonusCard }
    return next()
  }
  
  // Fallback: JWT auth
  getUserFromRequest(req).then(user => {
    if (!user) {
      return res.status(401).json({ error: 'unauthorized', message: 'Please provide your bonus card number or log in' })
    }
    req.user = user
    next()
  }).catch(err => {
    res.status(500).json({ error: 'auth_error', message: err.message })
  })
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
function extractProductFromUrl(url, originalName, store = 'ah') {
  const rawName = (originalName || '').toString().trim()
  
  // Clean up name - remove common noise patterns from product cards
  let name = rawName
    .replace(/,\s*(?:Nutri-Score|per stuk|per kg|€|\d+\s*voor|vandaag|morgen).*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  // NFC-normalize: compose decomposed Unicode (e + combining accent → é)
  if (name) name = name.normalize('NFC')
  
  const normalized = normalizeProductName(name)
  const storePrefix = store === 'jumbo' ? 'jumbo' : 'ah'
  
  if (!url) {
    // No URL - use name as fallback
    if (normalized && normalized.length > 2) {
      return {
        id: `${storePrefix}-${normalized.replace(/\s+/g, '-').toLowerCase()}`,
        name,
        normalized
      }
    }
    return { id: null, name, normalized }
  }
  
  try {
    const u = new URL(url)
    
    // JUMBO-specific URL patterns
    if (store === 'jumbo' || url.includes('jumbo.com')) {
      // Pattern: /producten/product-name-123456
      const jumboMatch1 = u.pathname.match(/\/producten?\/([^/?#]+?)(?:-(\d{5,}))?$/i)
      if (jumboMatch1) {
        const slug = jumboMatch1[1].toLowerCase()
        const productId = jumboMatch1[2]
        const cleanSlug = slug.replace(/-\d+$/, '') // Remove trailing ID from slug
        let displayName = cleanSlug.replace(/-/g, ' ')
        displayName = displayName.replace(/\b[a-z]/g, c => c.toUpperCase())
        return {
          id: productId ? `jumbo-${productId}` : `jumbo-${cleanSlug}`.substring(0, 100),
          name: name || displayName,
          normalized: normalizeProductName(cleanSlug.replace(/-/g, ' '))
        }
      }
      
      // Pattern: /product/123456 or URLs with numeric product IDs
      const jumboMatch2 = u.pathname.match(/\/(?:product|artikel)\/(\d{5,})/i)
      if (jumboMatch2) {
        return {
          id: `jumbo-${jumboMatch2[1]}`,
          name: name || `Jumbo Product ${jumboMatch2[1]}`,
          normalized
        }
      }
      
      // Pattern: Jumbo bonnetje JSON receipt items (may have SKU in URL params)
      const skuParam = u.searchParams.get('sku') || u.searchParams.get('productId')
      if (skuParam) {
        return {
          id: `jumbo-${skuParam}`,
          name,
          normalized
        }
      }
      
      // Fallback for Jumbo: use slug from path
      const pathParts = u.pathname.split('/').filter(p => p.length > 2)
      if (pathParts.length > 0) {
        const lastPart = pathParts[pathParts.length - 1]
        const cleanSlug = lastPart.toLowerCase().replace(/[^a-z0-9-]/g, '')
        if (cleanSlug.length > 3) {
          let displayName = cleanSlug.replace(/-/g, ' ')
          displayName = displayName.replace(/\b[a-z]/g, c => c.toUpperCase())
          return {
            id: `jumbo-${cleanSlug}`.substring(0, 100),
            name: name || displayName,
            normalized: normalizeProductName(cleanSlug.replace(/-/g, ' '))
          }
        }
      }
    }
    
    // AH-specific URL patterns (default)
    // Strategy 1: /producten/product/<wi...>/<slug> format
    const match1 = u.pathname.match(/\/producten\/product\/[^/]+\/([^/?#]+)/)
    if (match1 && match1[1]) {
      let slug
      try { slug = decodeURIComponent(match1[1]).toLowerCase() } catch (_) { slug = match1[1].toLowerCase() }
      if (slug.length > 2) {
        // Build ID from ASCII-only version of slug
        const asciiSlug = slug.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9-]/g, '')
        let displayName = slug.normalize('NFC').replace(/-/g, ' ')
        displayName = displayName.replace(/\b[a-z]/g, c => c.toUpperCase())
        return {
          id: asciiSlug.length > 2 ? asciiSlug : `ah-${asciiSlug}`.substring(0, 100),
          name: name || displayName,
          normalized: normalizeProductName(slug.replace(/-/g, ' '))
        }
      }
    }
    
    // Strategy 2: /wi/<id>/<slug> format
    const match2 = u.pathname.match(/\/wi\/([^/]+)\/([^/?#]+)/)
    if (match2) {
      const wiId = match2[1]
      let slug
      try { slug = decodeURIComponent(match2[2]).toLowerCase() } catch (_) { slug = match2[2].toLowerCase() }
      if (slug.length > 2) {
        const asciiSlug = slug.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9-]/g, '')
        let displayName = slug.normalize('NFC').replace(/-/g, ' ')
        displayName = displayName.replace(/\b[a-z]/g, c => c.toUpperCase())
        return {
          id: `wi-${wiId}-${asciiSlug}`.substring(0, 100),
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
      let lastPart
      try { lastPart = decodeURIComponent(pathParts[pathParts.length - 1]) } catch (_) { lastPart = pathParts[pathParts.length - 1] }
      const cleanSlug = lastPart.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9-]/g, '')
      if (cleanSlug.length > 3) {
        let displayName = lastPart.normalize('NFC').replace(/-/g, ' ')
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
 * Find sustainable replacement suggestions based on CO₂ category swaps.
 * Uses the category swap map to suggest genuinely relevant alternatives
 * (e.g. beef → tofu, milk → oat milk) rather than random high-scoring items.
 */
function findReplacementSuggestions(lowScoreProducts, catalogProducts) {
  const suggestions = []

  // Pre-score all catalog products
  const scoredCatalog = catalogProducts.map(p => {
    const enriched = getEnrichedData(p)
    const evaluation = evaluateProduct(p.name, enriched)
    return { ...p, score: evaluation.score, co2Category: evaluation.co2Category, enriched, evaluation }
  }).filter(p => p.score != null && p.score >= 5)

  for (const product of lowScoreProducts) {
    // Get the CO₂ category of the original product
    const origEvaluation = evaluateProduct(product.name)
    const origCategory = origEvaluation.co2Category
    const swapInfo = CATEGORY_SWAPS[origCategory]
    const swapCategories = new Set(swapInfo?.swaps || [])

    // Prefer alternatives from swap categories, then any better product
    const alternatives = scoredCatalog
      .filter(alt => alt.score > product.score + 1)
      .sort((a, b) => {
        // Swap-category products first
        const aSwap = swapCategories.has(a.co2Category) ? 1 : 0
        const bSwap = swapCategories.has(b.co2Category) ? 1 : 0
        if (bSwap !== aSwap) return bSwap - aSwap
        return b.score - a.score
      })
      .slice(0, 3)

    if (alternatives.length > 0) {
      const bestAlt = alternatives[0]
      const improvement = bestAlt.score - product.score
      const co2Reduction = origEvaluation.co2PerKg && bestAlt.evaluation.co2PerKg
        ? Math.round((1 - bestAlt.evaluation.co2PerKg / origEvaluation.co2PerKg) * 100)
        : null

      suggestions.push({
        original: { name: product.name, score: product.score, co2Category: origCategory },
        replacement: {
          name: bestAlt.name,
          score: bestAlt.score,
          url: makeAbsoluteAhUrl(bestAlt.url),
          image_url: bestAlt.image_url,
          price: bestAlt.price,
          co2Category: bestAlt.co2Category
        },
        improvement,
        co2Reduction,
        reason: co2Reduction
          ? `🌱 ${co2Reduction}% less CO₂ emissions`
          : getReplacementReason(product.enriched, bestAlt.enriched)
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
  
  // =========================================================================
  // CO2-BASED SCORING
  // Score is determined ONLY by CO2 emissions per kg of food
  // Enriched data (organic, vegan, origin) is kept as supplementary info
  // Priority: ingredients list (most accurate) → product name (fallback)
  // =========================================================================
  
  const ingredientText = enrichedData?.ingredients || null
  const nutritionText = enrichedData?.nutrition_text || null
  const nutritionJson = enrichedData?.nutrition_json || null
  const co2Data = getCO2Emissions(input, ingredientText, nutritionText, nutritionJson)
  
  // Handle non-food items
  if (co2Data.isNonFood) {
    return {
      product: input,
      normalized,
      rawScore: null,
      score: null,
      adjustments: [],
      enriched: [],
      suggestions: [],
      rating: 'Geen voedingsmiddel',
      ratingEmoji: '🚫',
      ratingColor: '#6b7280',
      co2PerKg: null,
      co2Category: '__non_food__',
      co2CategoryLabel: 'Geen Voedingsmiddel',
      co2Matched: false,
      isNonFood: true,
      hasEnrichedData: false
    }
  }
  
  const co2Score = co2ToScore(co2Data.co2PerKg)
  const co2Rating = getCO2Rating(co2Score)
  
  // Build the reasons/enriched array
  const matchedEnriched = []
  const adjustments = []
  
  // Primary: CO2 category (this determines the score)
  if (co2Data.matched) {
    matchedEnriched.push({
      code: 'co2_category',
      icon: co2Rating.emoji,
      label: getCategoryLabel(co2Data.category),
      co2PerKg: co2Data.co2PerKg,
      isPrimary: true
    })
  }
  
  // Supplementary info from enriched data (doesn't affect score)
  if (enrichedData && typeof enrichedData === 'object') {
    // Organic/Bio
    if (enrichedData.is_organic === true) {
      matchedEnriched.push({ 
        code: 'organic', 
        icon: '🌿', 
        label: 'Biologisch',
        supplementary: true 
      })
    }

    // Vegan
    if (enrichedData.is_vegan === true) {
      matchedEnriched.push({ 
        code: 'vegan', 
        icon: '🌱', 
        label: 'Vegan',
        supplementary: true 
      })
    } else if (enrichedData.is_vegetarian === true) {
      matchedEnriched.push({ 
        code: 'vegetarian', 
        icon: '🥗', 
        label: 'Vegetarisch',
        supplementary: true 
      })
    }
    
    // Fairtrade
    if (enrichedData.is_fairtrade === true) {
      matchedEnriched.push({ 
        code: 'fairtrade', 
        icon: '🤝', 
        label: 'Fairtrade',
        supplementary: true 
      })
    }

    // Origin country (supplementary - CO2 data already includes transport)
    let effectiveOrigins = null
    let isSeasonalOrigin = false
    
    if (enrichedData.origin_by_month) {
      effectiveOrigins = getOriginsForCurrentMonth(enrichedData.origin_by_month)
      isSeasonalOrigin = effectiveOrigins !== null
    }
    
    if (!effectiveOrigins && enrichedData.origin_country) {
      // Don't show inferred "EU" origin when it's likely wrong:
      // - Fairtrade products come from developing countries, not EU
      // - Tropical products (coconut, coffee, cocoa, etc.) aren't grown in EU
      const TROPICAL_KEYWORDS = ['kokos','coconut','cacao','cocoa','chocola','koffie','coffee','banaan','banana','mango','ananas','avocado','cashew','quinoa','chia','acai','matcha','vanille','soja','soy','pinda','rijst','rice','dadel','gember','kurkuma']
      const nameLower = input.toLowerCase()
      const isTropical = TROPICAL_KEYWORDS.some(kw => nameLower.includes(kw))
      const skipInferredEU = enrichedData.origin_country === 'EU' && (enrichedData.is_fairtrade === true || isTropical)
      if (!skipInferredEU) {
        effectiveOrigins = [translateCountryName(enrichedData.origin_country)]
      }
    }
    
    if (effectiveOrigins && effectiveOrigins.length > 0) {
      const monthLabel = isSeasonalOrigin ? ` (${getCurrentMonthKey().toUpperCase()})` : ''
      const countriesLabel = effectiveOrigins.join(', ')
      
      matchedEnriched.push({ 
        code: 'origin', 
        icon: '📍', 
        label: `Herkomst: ${countriesLabel}${monthLabel}`,
        supplementary: true,
        isSeasonal: isSeasonalOrigin,
        countries: effectiveOrigins
      })
    }
  }

  // Final score is based on CO2 (null if unknown / non-food)
  const finalScore = co2Score  // null for unmatched → shown as N/A in UI
  
  // Generate smart suggestions based on CO2 category
  const suggestions = getSmartSuggestions(input, co2Data.category, finalScore, lang)
  
  return {
    product: input,
    normalized,
    rawScore: finalScore,
    score: finalScore,
    adjustments,
    enriched: matchedEnriched,
    suggestions,
    rating: co2Rating.label,
    ratingEmoji: co2Rating.emoji,
    ratingColor: co2Rating.color,
    // CO2 specific fields
    co2PerKg: co2Data.co2PerKg,
    co2Min: co2Data.co2Min || null,
    co2Max: co2Data.co2Max || null,
    co2Valid: co2Data.co2Valid != null ? co2Data.co2Valid : null,
    co2Category: co2Data.category,
    co2CategoryLabel: getCategoryLabel(co2Data.category),
    co2Matched: co2Data.matched,
    co2Method: co2Data.method || 'name',  // 'ingredients' or 'name'
    ingredientBreakdown: co2Data.ingredientBreakdown || null,
    hasEnrichedData: enrichedData !== null && matchedEnriched.some(m => m.supplementary)
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
    product.origin_by_month != null ||
    product.ingredients != null
  
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
    ingredients: product.ingredients,
    nutrition_text: product.nutrition_text,
    nutrition_json: product.nutrition_json,
    image_url: product.image_url,
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

function getRating(avgScore) {
  // CO2-based scale: 0-10 where higher = more sustainable (lower CO2)
  // 9-10: < 2 kg CO2/kg (vegetables, fruits, legumes)
  // 7-8: 2-6 kg CO2/kg (milk, eggs, grains)
  // 5-6: 6-15 kg CO2/kg (chicken, fish, pork)
  // 3-4: 15-40 kg CO2/kg (cheese, chocolate, coffee)
  // 0-2: > 40 kg CO2/kg (beef, lamb)
  if (avgScore >= 9) return "🌿 Excellent! Very low carbon footprint!"
  if (avgScore >= 7) return "🌱 Good! Low environmental impact."
  if (avgScore >= 5) return "🌍 Average. Consider lower-emission alternatives."
  if (avgScore >= 3) return "⚠️ High emissions. Try plant-based options."
  return "🔴 Very high carbon footprint."
}

function minutes(ms) {
  return Math.round(ms / 60000)
}

// User profile, credentials, and link-bonus-card routes removed — users table dropped
// Bonus card is the sole identification method (stored client-side, passed per request)

// Legacy stub: /api/user/link-bonus-card
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
    const bonusCard = getBonusCard(req)
    if (!bonusCard) return res.status(400).json({ error: 'no_bonus_card' })
    const limit = Math.min(parseInt(req.query.limit) || 100, 500)
    const offset = parseInt(req.query.offset) || 0
    
    const { data, error, count } = await supabase
      .from('user_purchases')
      .select('*', { count: 'exact' })
      .eq('bonus_card_number', bonusCard)
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
    const bonusCard = getBonusCard(req)
    if (!bonusCard) return res.status(400).json({ error: 'no_bonus_card' })
    // Query directly instead of using the view (which still references user_id)
    const { data, error } = await supabase
      .from('user_purchases')
      .select('product_id, quantity, price')
      .eq('bonus_card_number', bonusCard)
    
    if (error) throw error
    const purchases = data || []
    res.json({
      total_purchases: purchases.length,
      unique_products: new Set(purchases.map(p => p.product_id)).size,
      total_spent: purchases.reduce((sum, p) => sum + (p.price || 0), 0)
    })
  } catch (err) {
    res.status(500).json({ error: 'fetch_failed', message: err.message })
  }
})

// Delete a specific purchase
app.delete('/api/user/purchases/:id', requireAuth, async (req, res) => {
  try {
    const bonusCard = getBonusCard(req)
    if (!bonusCard) return res.status(400).json({ error: 'no_bonus_card' })
    const { error } = await supabase
      .from('user_purchases')
      .delete()
      .eq('id', req.params.id)
      .eq('bonus_card_number', bonusCard)
    
    if (error) throw error
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: 'delete_failed', message: err.message })
  }
})

// Add a manual purchase for authenticated user
app.post('/api/user/purchases', requireAuth, async (req, res) => {
  try {
    const bonusCard = getBonusCard(req)
    if (!bonusCard) return res.status(400).json({ error: 'no_bonus_card' })
    const { product, quantity, price } = req.body
    
    if (!product || typeof product !== 'string' || product.trim().length === 0) {
      return res.status(400).json({ error: 'missing_product', message: 'Product name is required' })
    }
    
    const evaluation = evaluateProduct(product)
    
    const purchase = {
      bonus_card_number: bonusCard,
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
    const bonusCard = getBonusCard(req)
    if (!bonusCard) return res.json({ message: 'No purchases yet!' })
    console.log('[Insights] Fetching for bonus card:', '****' + bonusCard.slice(-4))
    
    let query = supabase
      .from('user_purchases')
      .select('product_id, product_name, quantity, price')
      .eq('bonus_card_number', bonusCard)
    
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
        .select('id, is_vegan, is_vegetarian, is_organic, is_fairtrade, origin_country, origin_by_month, nutri_score, unit_size, ingredients, nutrition_text, nutrition_json')
        .in('id', productIds)
      if (products) {
        productsMap = new Map(products.map(p => [p.id, p]))
      }
    }
    
    // Calculate sustainability scores on the fly using enriched data
    const purchasesWithScores = purchases.map(p => {
      const product = productsMap.get(p.product_id)
      const enrichedData = product ? getEnrichedData(product) : null
      const evaluation = evaluateProduct(p.product_name, enrichedData)
      const weight = getProductWeight(product?.unit_size, evaluation.co2Category, p.product_name)
      return {
        ...p,
        sustainability_score: evaluation.score,
        co2PerKg: evaluation.co2PerKg,
        co2Category: evaluation.co2Category,
        isNonFood: evaluation.isNonFood || false,
        weightGrams: weight.weightGrams,
        weightSource: weight.source
      }
    })
    
    // Only include scored food items in score averages (exclude non-food & unmatched)
    const scoredItems = purchasesWithScores.filter(p => p.sustainability_score != null)
    const totalScore = scoredItems.reduce((sum, p) => sum + p.sustainability_score, 0)
    const avgScore = scoredItems.length > 0 ? totalScore / scoredItems.length : null
    
    // Calculate WEIGHT-WEIGHTED average CO2/kg (only for food items with matched CO2 data)
    // Formula: sum(co2PerKg_i * weight_i) / sum(weight_i)
    const foodItems = purchasesWithScores.filter(p => !p.isNonFood && p.co2PerKg != null)
    let avgCO2PerKg = null
    let totalWeightKg = null
    let totalCO2 = null
    if (foodItems.length > 0) {
      const sumWeightedCO2 = foodItems.reduce((sum, p) => sum + (p.co2PerKg * (p.weightGrams || 400)), 0)
      const sumWeight = foodItems.reduce((sum, p) => sum + (p.weightGrams || 400), 0)
      avgCO2PerKg = sumWeightedCO2 / sumWeight
      totalWeightKg = sumWeight / 1000
      totalCO2 = sumWeightedCO2 / 1000  // total kg CO2 for all items
    }
    
    // Best/worst only from scored food items
    const best = scoredItems.length > 0
      ? scoredItems.reduce((max, p) => (p.sustainability_score > max.sustainability_score ? p : max), scoredItems[0])
      : purchasesWithScores[0]
    const worst = scoredItems.length > 0
      ? scoredItems.reduce((min, p) => (p.sustainability_score < min.sustainability_score ? p : min), scoredItems[0])
      : purchasesWithScores[0]
    
    // Compare user's avg CO2/kg against NL dietary baseline
    const baselineComparison = avgCO2PerKg ? compareToBaseline(avgCO2PerKg, 'netherlands') : null
    
    res.json({
      total_purchases: purchasesWithScores.length,
      average_score: avgScore,
      rating: avgScore != null ? getRating(avgScore) : 'No scored items',
      best_purchase: best?.product_name || null,
      best_purchase_obj: best ? { product_id: best.product_id, product_name: best.product_name, sustainability_score: best.sustainability_score, image_url: best.image_url || null } : null,
      worst_purchase: worst?.product_name || null,
      worst_purchase_obj: worst ? { product_id: worst.product_id, product_name: worst.product_name, sustainability_score: worst.sustainability_score, image_url: worst.image_url || null } : null,
      total_spent: purchasesWithScores.reduce((sum, p) => sum + (p.price || 0), 0),
      avg_co2_per_kg: avgCO2PerKg ? Math.round(avgCO2PerKg * 100) / 100 : null,
      total_co2_kg: totalCO2 ? Math.round(totalCO2 * 100) / 100 : null,
      total_weight_kg: totalWeightKg ? Math.round(totalWeightKg * 100) / 100 : null,
      food_items_matched: foodItems.length,
      baseline_comparison: baselineComparison
    })
  } catch (err) {
    console.error('Error fetching user insights:', err)
    res.status(500).json({ error: 'fetch_failed', message: err.message })
  }
})

// Rank history routes removed — purchase_rank_history table used user_id (JWT auth)
// which is no longer used. These routes had no frontend consumers.

// Get user's full purchase history with enriched product data
app.get('/api/user/purchases/history', requireAHEmail, async (req, res) => {
  try {
    const bonusCard = getBonusCard(req)
    const page = parseInt(req.query.page) || 1
    const limit = Math.min(parseInt(req.query.limit) || 50, 100)
    const offset = (page - 1) * limit
    const sortBy = req.query.sortBy || 'scraped_at'
    const sortOrder = req.query.sortOrder === 'asc' ? true : false
    
    if (!bonusCard) {
      return res.json({ purchases: [], total: 0, page, limit, totalPages: 0 })
    }
    console.log('[History] Fetching for bonus card:', '****' + bonusCard.slice(-4))
    
    let query = supabase
      .from('user_purchases')
      .select('*', { count: 'exact' })
      .eq('bonus_card_number', bonusCard)
    
    const { data: purchases, error, count } = await query
      .order(sortBy, { ascending: sortOrder })
      .range(offset, offset + limit - 1)
    
    if (error) {
      console.error('Purchase history fetch error:', error)
      throw error
    }
    
    console.log(`[History] Fetched ${purchases?.length || 0} purchases for bonus card`)
    
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
        .select('id, price, is_vegan, is_vegetarian, is_organic, is_fairtrade, nutri_score, origin_country, origin_by_month, brand, image_url, url, unit_size, ingredients, nutrition_text, nutrition_json')
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
    
    // If enriched columns not available, at least get basic product info (image_url, url, price)
    if (productIds.length > 0 && !hasEnrichedData) {
      const { data: products } = await supabase
        .from('products')
        .select('id, price, image_url, url')
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
        price: purchase.price ?? enriched?.price ?? null,
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
        unit_size: enriched?.unit_size ?? null,
        // Sustainability scoring
        sustainability_score: evaluation.score,
        sustainability_rating: evaluation.rating,
        isNonFood: evaluation.isNonFood || false,
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
      // Assign website_variant if not yet set
      if (!user.website_variant) {
        const variant = Math.random() < 0.5 ? 'A' : 'B'
        const { data: updated } = await supabase
          .from('ah_bonus_users')
          .update({ website_variant: variant })
          .eq('bonus_card_number', cardNumber)
          .select()
          .single()
        if (updated) return res.json(updated)
        // Fallback: return with variant attached
        return res.json({ ...user, website_variant: variant })
      }
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
      // User has purchases but no ah_bonus_users record - create one with variant
      const variant = Math.random() < 0.5 ? 'A' : 'B'
      const { data: newUser, error: createError } = await supabase
        .from('ah_bonus_users')
        .upsert({
          bonus_card_number: cardNumber,
          website_variant: variant,
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
        website_variant: variant,
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
        .select('id, price, is_vegan, is_vegetarian, is_organic, is_fairtrade, nutri_score, origin_country, origin_by_month, brand, image_url, url, unit_size, ingredients, nutrition_text, nutrition_json')
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
        price: purchase.price ?? enriched.price ?? null,
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
        unit_size: enriched.unit_size ?? null,
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
        .select('id, is_vegan, is_vegetarian, is_organic, is_fairtrade, nutri_score, origin_country, origin_by_month, price, unit_size, ingredients, nutrition_text, nutrition_json')
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
      const enrichedData = product ? getEnrichedData(product) : null
      const evaluation = evaluateProduct(p.product_name, enrichedData)
      const weight = getProductWeight(product?.unit_size, evaluation.co2Category, p.product_name)
      return {
        ...p,
        // Use purchase price, fall back to product price if null
        price: p.price ?? product?.price ?? null,
        sustainability_score: evaluation.score,
        co2PerKg: evaluation.co2PerKg,
        co2Category: evaluation.co2Category,
        isNonFood: evaluation.isNonFood || false,
        weightGrams: weight.weightGrams,
        weightSource: weight.source
      }
    })
    
    // Only include scored food items in score averages (exclude non-food & unmatched)
    const scoredItems = purchasesWithScores.filter(p => p.sustainability_score != null)
    const totalScore = scoredItems.reduce((sum, p) => sum + p.sustainability_score, 0)
    const avgScore = scoredItems.length > 0 ? totalScore / scoredItems.length : null
    
    // Calculate WEIGHT-WEIGHTED average CO2/kg (only for food items with matched CO2 data)
    // Formula: sum(co2PerKg_i * weight_i) / sum(weight_i)
    const foodItems = purchasesWithScores.filter(p => !p.isNonFood && p.co2PerKg != null)
    let avgCO2PerKg = null
    let totalWeightKg = null
    let totalCO2 = null
    if (foodItems.length > 0) {
      const sumWeightedCO2 = foodItems.reduce((sum, p) => sum + (p.co2PerKg * (p.weightGrams || 400)), 0)
      const sumWeight = foodItems.reduce((sum, p) => sum + (p.weightGrams || 400), 0)
      avgCO2PerKg = sumWeightedCO2 / sumWeight
      totalWeightKg = sumWeight / 1000
      totalCO2 = sumWeightedCO2 / 1000  // total kg CO2 for all items
    }
    
    // Best/worst only from scored food items
    const best = scoredItems.length > 0
      ? scoredItems.reduce((max, p) => (p.sustainability_score > max.sustainability_score ? p : max), scoredItems[0])
      : purchasesWithScores[0]
    const worst = scoredItems.length > 0
      ? scoredItems.reduce((min, p) => (p.sustainability_score < min.sustainability_score ? p : min), scoredItems[0])
      : purchasesWithScores[0]
    
    // Compare user's avg CO2/kg against NL dietary baseline
    const baselineComparison = avgCO2PerKg ? compareToBaseline(avgCO2PerKg, 'netherlands') : null
    
    // Return same format as /api/user/insights for Dashboard compatibility
    res.json({
      total_purchases: purchasesWithScores.length,
      average_score: avgScore,
      rating: avgScore != null ? getRating(avgScore) : 'No scored items',
      best_purchase: best?.product_name || null,
      best_purchase_obj: best ? { product_id: best.product_id, product_name: best.product_name, sustainability_score: best.sustainability_score, image_url: best.image_url || null } : null,
      worst_purchase: worst?.product_name || null,
      worst_purchase_obj: worst ? { product_id: worst.product_id, product_name: worst.product_name, sustainability_score: worst.sustainability_score, image_url: worst.image_url || null } : null,
      total_spent: purchasesWithScores.reduce((sum, p) => sum + (p.price || 0), 0),
      avg_co2_per_kg: avgCO2PerKg ? Math.round(avgCO2PerKg * 100) / 100 : null,
      total_co2_kg: totalCO2 ? Math.round(totalCO2 * 100) / 100 : null,
      total_weight_kg: totalWeightKg ? Math.round(totalWeightKg * 100) / 100 : null,
      food_items_matched: foodItems.length,
      baseline_comparison: baselineComparison
    })
  } catch (err) {
    console.error('Error fetching bonus suggestions:', err)
    res.status(500).json({ error: 'fetch_failed', message: err.message })
  }
})

// Get personalized suggestions based on user's purchase history
app.get('/api/user/suggestions', requireAHEmail, async (req, res) => {
  try {
    const bonusCard = getBonusCard(req)
    console.log('[Suggestions] Fetching for bonus card:', bonusCard ? '****' + bonusCard.slice(-4) : 'none')
    
    if (!bonusCard) {
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
    
    let query = supabase
      .from('user_purchases')
      .select('product_name, quantity, price')
      .eq('bonus_card_number', bonusCard)
    
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
        .select('id, name, url, image_url, price, is_vegan, is_vegetarian, is_organic, is_fairtrade, nutri_score, origin_country, origin_by_month, brand, ingredients, nutrition_text, nutrition_json')
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
        .select('id, name, normalized_name, url, image_url, price, seen_count, created_at, last_seen_at, is_vegan, is_vegetarian, is_organic, is_fairtrade, nutri_score, origin_country, origin_by_month, brand, details_scraped_at, ingredients, nutrition_text, nutrition_json')
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
        .select('id, name, normalized_name, url, image_url, price, is_vegan, is_vegetarian, is_organic, is_fairtrade, nutri_score, origin_country, origin_by_month, brand, ingredients, nutrition_text, nutrition_json')
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
// FULL CATALOG BROWSE ENDPOINT
// ============================================================================

/**
 * GET /api/catalog/browse
 *
 * Paginated, filterable product catalog.
 * Query params:
 *   q        — text search (ilike on normalized_name)
 *   page     — 1-based page number (default 1)
 *   limit    — items per page (default 24, max 100)
 *   sort     — "name" | "score_asc" | "score_desc" | "price_asc" | "price_desc" (default "name")
 *   score_min — minimum sustainability score (0-10)
 *   score_max — maximum sustainability score (0-10)
 *   has_image — "true" to only return products with images
 *   category  — filter by AH product category substring
 */
app.get('/api/catalog/browse', async (req, res) => {
  try {
    if (!supabase) {
      return res.status(503).json({ error: 'database_unavailable' })
    }

    const page = Math.max(1, parseInt(req.query.page) || 1)
    const limit = Math.min(Math.max(1, parseInt(req.query.limit) || 24), 100)
    const offset = (page - 1) * limit
    const searchQuery = req.query.q?.trim() || ''
    const sort = req.query.sort || 'name'
    const scoreMin = req.query.score_min != null ? parseInt(req.query.score_min) : null
    const scoreMax = req.query.score_max != null ? parseInt(req.query.score_max) : null
    const hasImage = req.query.has_image === 'true'

    // Build the query
    const selectFields = enrichedColumnsAvailable
      ? 'id, name, normalized_name, url, image_url, price, is_vegan, is_vegetarian, is_organic, is_fairtrade, nutri_score, origin_country, brand, ingredients, nutrition_text, nutrition_json, categories'
      : 'id, name, normalized_name, url, image_url, price, categories'

    let query = supabase.from('products').select(selectFields, { count: 'exact' })

    // Text search
    if (searchQuery) {
      query = query.ilike('normalized_name', `%${searchQuery.toLowerCase()}%`)
    }

    // Only products with images (for a nicer catalog)
    if (hasImage) {
      query = query.not('image_url', 'is', null)
    }

    // Sort by name for the DB query (scoring sort happens in JS)
    if (sort === 'price_asc') {
      query = query.order('price', { ascending: true, nullsFirst: false })
    } else if (sort === 'price_desc') {
      query = query.order('price', { ascending: false, nullsFirst: false })
    } else {
      query = query.order('name', { ascending: true })
    }

    // We need to fetch more than `limit` when score-filtering or score-sorting
    // because scores are computed in JS. For score filters we fetch a bigger batch.
    const needsScoreProcessing = scoreMin != null || scoreMax != null || sort === 'score_asc' || sort === 'score_desc'
    if (needsScoreProcessing) {
      // Fetch a larger batch and filter/sort in JS
      query = query.range(0, 999)
    } else {
      query = query.range(offset, offset + limit - 1)
    }

    const { data, error, count } = await query

    if (error) throw error

    // Add sustainability scores
    const withScores = (data || []).map(p => {
      const evalResult = enrichedColumnsAvailable
        ? evaluateProductWithRecord(p.name, p)
        : evaluateProduct(p.name)
      const score = evalResult.score != null ? evalResult.score : null
      return {
        id: p.id,
        name: p.name,
        image_url: p.image_url || null,
        url: p.url || null,
        price: p.price || null,
        brand: p.brand || null,
        is_organic: p.is_organic || false,
        is_vegan: p.is_vegan || false,
        is_vegetarian: p.is_vegetarian || false,
        is_fairtrade: p.is_fairtrade || false,
        nutri_score: p.nutri_score || null,
        origin_country: p.origin_country || null,
        categories: p.categories || [],
        sustainability_score: score,
        co2_category: evalResult.co2Category || null,
        rating: evalResult.rating || null
      }
    })

    // Apply score filters in JS
    let filtered = withScores
    if (scoreMin != null) {
      filtered = filtered.filter(p => p.sustainability_score >= scoreMin)
    }
    if (scoreMax != null) {
      filtered = filtered.filter(p => p.sustainability_score <= scoreMax)
    }

    // Apply score sort in JS
    if (sort === 'score_desc') {
      filtered.sort((a, b) => b.sustainability_score - a.sustainability_score)
    } else if (sort === 'score_asc') {
      filtered.sort((a, b) => a.sustainability_score - b.sustainability_score)
    }

    // Paginate in JS if we fetched a bigger batch
    let results, totalCount
    if (needsScoreProcessing) {
      totalCount = filtered.length
      results = filtered.slice(offset, offset + limit)
    } else {
      totalCount = count
      results = filtered
    }

    res.json({
      products: results,
      page,
      limit,
      total: totalCount,
      totalPages: Math.ceil(totalCount / limit)
    })
  } catch (err) {
    console.error('[Catalog Browse] Error:', err.message)
    res.status(500).json({ error: 'fetch_failed', message: err.message })
  }
})

/**
 * GET /api/catalog/categories
 *
 * Returns distinct category values found in the products table.
 */
app.get('/api/catalog/categories', async (req, res) => {
  try {
    if (!supabase) {
      return res.status(503).json({ error: 'database_unavailable' })
    }

    // Get a sample of products to extract categories
    const { data, error } = await supabase
      .from('products')
      .select('categories')
      .not('categories', 'eq', '{}')
      .limit(2000)

    if (error) throw error

    // Flatten and deduplicate
    const categorySet = new Set()
    for (const row of data || []) {
      if (Array.isArray(row.categories)) {
        row.categories.forEach(c => categorySet.add(c))
      }
    }

    const sorted = [...categorySet].sort((a, b) => a.localeCompare(b, 'nl'))
    res.json({ categories: sorted })
  } catch (err) {
    console.error('[Catalog Categories] Error:', err.message)
    res.status(500).json({ error: 'fetch_failed', message: err.message })
  }
})

// ============================================================================
// BULK DATA FIX ENDPOINTS
// ============================================================================

/**
 * POST /api/products/fix-vegan-labels
 * 
 * Bulk fix false vegan labels: clear is_vegan for products whose ingredients
 * contain known non-vegan items (eggs, milk, cheese, meat, fish, etc.)
 * Also resets is_vegetarian for products with meat/fish ingredients.
 */
app.post('/api/products/fix-vegan-labels', async (req, res) => {
  try {
    if (!supabase) {
      return res.status(503).json({ error: 'Database not configured' })
    }
    
    // Fetch all products that are marked as vegan or vegetarian AND have ingredients
    const { data: products, error } = await supabase
      .from('products')
      .select('id, name, is_vegan, is_vegetarian, ingredients')
      .or('is_vegan.eq.true,is_vegetarian.eq.true')
      .not('ingredients', 'is', null)
    
    if (error) {
      return res.status(500).json({ error: error.message })
    }
    
    if (!products || products.length === 0) {
      return res.json({ message: 'No products to fix', fixed_vegan: 0, fixed_vegetarian: 0 })
    }
    
    // Non-vegan ingredient keywords (Dutch + English)
    const nonVeganKeywords = [
      'melk', 'milk', 'room', 'cream', 'boter', 'butter', 'kaas', 'cheese',
      'wei', 'whey', 'lactose', 'caseïne', 'caseine', 'yoghurt', 'kwark',
      'ei', 'eieren', 'egg', 'eggs', 'eigeel', 'eiwit',
      'scharrelei', 'uitloopei', 'vrije-uitloopei',
      'honing', 'honey', 'gelatine', 'gelatin',
      'ansjovis', 'anchov', 'schaaldier', 'garnaal', 'garnalen',
      'kip', 'chicken', 'rund', 'beef', 'varken', 'pork',
      'vis', 'fish', 'zalm', 'salmon', 'tonijn', 'tuna',
      'geitenkaas', 'geitenmelk', 'schapenmelk', 'schapenkaas',
      'ricotta', 'mozzarella', 'parmezaan', 'parmesan', 'mascarpone',
      'crème fraîche', 'creme fraiche', 'slagroom', 'karnemelk',
      'magere melk', 'volle melk', 'halfvolle melk',
      'MELKEIWIT', 'WEIPOEDER', 'MELKPOEDER',
      'kipfilet', 'rundvlees', 'varkensvlees', 'spek', 'bacon',
      'ham', 'salami', 'worst',
    ]
    
    // Non-vegetarian keywords (meat/fish only) 
    const nonVegetarianKeywords = [
      'kip', 'chicken', 'kipfilet', 'kippenfilet',
      'rund', 'rundvlees', 'beef', 'biefstuk',
      'varken', 'varkensvlees', 'pork', 'spek', 'bacon',
      'ham', 'salami', 'worst', 'rookworst', 'gehakt',
      'vis', 'fish', 'zalm', 'salmon', 'tonijn', 'tuna', 'kabeljauw',
      'garnaal', 'garnalen', 'shrimp', 'schaaldier',
      'ansjovis', 'anchov', 'haring', 'makreel',
      'gelatine', 'gelatin',
      'lam', 'lamsvlees', 'lamb',
    ]
    
    let fixedVegan = 0
    let fixedVegetarian = 0
    const fixedProducts = []
    
    for (const product of products) {
      const ingredientsLower = product.ingredients.toLowerCase()
      const updateData = {}
      
      // Check vegan
      if (product.is_vegan === true) {
        const hasNonVegan = nonVeganKeywords.some(kw => {
          // For short keywords (≤3 chars), require word boundaries
          if (kw.length <= 3) {
            return new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(ingredientsLower)
          }
          return ingredientsLower.includes(kw.toLowerCase())
        })
        if (hasNonVegan) {
          updateData.is_vegan = null
          fixedVegan++
        }
      }
      
      // Check vegetarian
      if (product.is_vegetarian === true) {
        const hasNonVegetarian = nonVegetarianKeywords.some(kw => {
          if (kw.length <= 3) {
            return new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(ingredientsLower)
          }
          return ingredientsLower.includes(kw.toLowerCase())
        })
        if (hasNonVegetarian) {
          updateData.is_vegetarian = null
          fixedVegetarian++
        }
      }
      
      if (Object.keys(updateData).length > 0) {
        await supabase
          .from('products')
          .update(updateData)
          .eq('id', product.id)
        
        fixedProducts.push({
          id: product.id,
          name: product.name,
          cleared: Object.keys(updateData)
        })
      }
    }
    
    console.log(`[Bulk Fix] Fixed ${fixedVegan} false vegan labels, ${fixedVegetarian} false vegetarian labels`)
    
    res.json({
      message: `Fixed ${fixedVegan} vegan and ${fixedVegetarian} vegetarian false labels`,
      fixed_vegan: fixedVegan,
      fixed_vegetarian: fixedVegetarian,
      total_checked: products.length,
      fixed_products: fixedProducts
    })
  } catch (err) {
    console.error('[Bulk Fix] Error:', err)
    res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/products/mark-non-food
 * 
 * Bulk mark non-food products so they're excluded from CO2 scoring.
 * Sets details_scrape_status = 'non_food' for products matching NON_FOOD_KEYWORDS.
 */
app.post('/api/products/mark-non-food', async (req, res) => {
  try {
    if (!supabase) {
      return res.status(503).json({ error: 'Database not configured' })
    }
    
    // Fetch all products
    const { data: products, error } = await supabase
      .from('products')
      .select('id, name')
    
    if (error) {
      return res.status(500).json({ error: error.message })
    }
    
    let marked = 0
    for (const product of (products || [])) {
      if (isNonFood(product.name)) {
        marked++
      }
    }
    
    res.json({
      message: `Found ${marked} non-food products out of ${(products || []).length} total`,
      non_food_count: marked,
      total_products: (products || []).length
    })
  } catch (err) {
    console.error('[Mark Non-Food] Error:', err)
    res.status(500).json({ error: err.message })
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
      .or('details_scrape_status.eq.pending,details_scrape_status.eq.incomplete,details_scraped_at.is.null')
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
        
        // Determine scrape completeness: mark as 'incomplete' if key fields are missing
        const hasKeyFields = details.price != null && details.image_url && details.ingredients
        const scrapeStatus = hasKeyFields ? 'success' : 'incomplete'
        if (!hasKeyFields) {
          console.log(`[Enrich] Incomplete scrape for ${productId}: price=${details.price != null}, image=${!!details.image_url}, ingredients=${!!details.ingredients}`)
        }
        
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
            nutrition_text: details.nutrition_text ?? null,
            nutrition_json: details.nutrition_json ?? null,
            details_scraped_at: new Date().toISOString(),
            details_scrape_status: scrapeStatus,
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
      .or('details_scrape_status.eq.pending,details_scrape_status.eq.incomplete,details_scraped_at.is.null')
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
            
            // Mark as 'incomplete' if key fields are missing so it gets re-scraped
            const hasKeyFields = details.price != null && details.image_url && details.ingredients
            const scrapeStatus = hasKeyFields ? 'success' : 'incomplete'
            
            await supabase
              .from('products')
              .update({
                is_vegan: details.is_vegan ?? null,
                is_vegetarian: details.is_vegetarian ?? null,
                is_organic: details.is_organic ?? null,
                is_fairtrade: details.is_fairtrade ?? null,
                nutri_score: details.nutri_score ?? null,
                origin_country: details.origin_country ?? null,
                brand: details.brand ?? null,
                unit_size: details.unit_size ?? null,
                allergens: details.allergens || [],
                ingredients: details.ingredients ?? null,
                nutrition_text: details.nutrition_text ?? null,
                nutrition_json: details.nutrition_json ?? null,
                details_scraped_at: new Date().toISOString(),
                details_scrape_status: scrapeStatus,
                updated_at: new Date().toISOString()
              })
              .eq('id', product.id)
            
            const statusIcon = hasKeyFields ? '✅' : '⚠️'
            productEnrichState.logs.push({
              timestamp: new Date().toISOString(),
              message: `${statusIcon} ${product.name}: vegan=${details.is_vegan}, organic=${details.is_organic}, nutri=${details.nutri_score}${!hasKeyFields ? ' [INCOMPLETE - missing: ' + [!details.price && 'price', !details.image_url && 'image', !details.ingredients && 'ingredients'].filter(Boolean).join(', ') + ']' : ''}`
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
    
    // CO2 emissions as primary scoring factor
    if (evaluation.co2Matched && evaluation.co2PerKg !== null) {
      breakdown.push({
        label: `CO₂: ${evaluation.co2CategoryLabel || evaluation.co2Category}`,
        value: `${evaluation.co2PerKg.toFixed(1)} kg CO₂/kg`,
        positive: evaluation.co2PerKg < 5,
        negative: evaluation.co2PerKg > 20
      })
    } else {
      breakdown.push({
        label: 'CO₂ Category',
        value: 'Unknown',
        positive: false,
        negative: false
      })
    }
    
    // Add supplementary info to breakdown (from enriched data)
    if (evaluation.enriched && Array.isArray(evaluation.enriched)) {
      for (const item of evaluation.enriched) {
        if (!item.supplementary) continue
        
        const labelMap = {
          'organic': 'Organic/Bio',
          'vegan': 'Vegan',
          'vegetarian': 'Vegetarian',
          'fairtrade': 'Fairtrade',
          'origin': item.countries ? `Origin: ${item.countries.join(', ')}` : 'Origin'
        }
        
        breakdown.push({
          label: labelMap[item.code] || item.label || item.code,
          value: '✓',
          positive: true,
          negative: false
        })
      }
    }
    
    // NOTE: Final Score removed from breakdown - it's already shown above the breakdown section
    
    // Create improvement reasons - CO2 as primary factor
    const improvements = []
    
    // Add CO2-based reason first (primary scoring factor)
    if (evaluation.co2Matched && evaluation.co2PerKg !== null) {
      const co2 = evaluation.co2PerKg
      const categoryLabel = evaluation.co2CategoryLabel || evaluation.co2Category
      
      if (co2 < 2) {
        improvements.push({
          reason: `🌿 Very low carbon footprint (${categoryLabel}: ${co2.toFixed(1)} kg CO₂/kg)`,
          positive: true
        })
      } else if (co2 < 6) {
        improvements.push({
          reason: `🌱 Low carbon footprint (${categoryLabel}: ${co2.toFixed(1)} kg CO₂/kg)`,
          positive: true
        })
      } else if (co2 < 15) {
        improvements.push({
          reason: `🌍 Moderate carbon footprint (${categoryLabel}: ${co2.toFixed(1)} kg CO₂/kg)`,
          positive: false
        })
      } else if (co2 < 40) {
        improvements.push({
          reason: `⚠️ High carbon footprint (${categoryLabel}: ${co2.toFixed(1)} kg CO₂/kg)`,
          positive: false
        })
      } else {
        improvements.push({
          reason: `🔴 Very high carbon footprint (${categoryLabel}: ${co2.toFixed(1)} kg CO₂/kg)`,
          positive: false
        })
      }
    } else {
      improvements.push({
        reason: evaluation.isNonFood ? '🚫 Dit is geen voedingsmiddel' : '❓ CO₂ categorie onbekend',
        positive: false
      })
    }
    
    // Additional factors from enriched data (supplementary info)
    // These are now in the 'enriched' array, not 'adjustments'
    if (evaluation.enriched && Array.isArray(evaluation.enriched)) {
      for (const item of evaluation.enriched) {
        if (!item.supplementary) continue
        
        const codeMap = {
          'organic': '🌱 Organic/Bio certified',
          'vegan': '🌿 Vegan product',
          'vegetarian': '🥬 Vegetarian product',
          'fairtrade': '🤝 Fairtrade certified',
          'origin': item.countries ? `📍 Origin: ${item.countries.join(', ')}` : null
        }
        const reason = codeMap[item.code]
        if (reason) {
          improvements.push({
            reason,
            positive: true
          })
        }
      }
    }
    
    // Find better alternatives from catalog (category-aware)
    let alternatives = []
    let suggestionTip = null
    if (supabase && evaluation.score != null) {
      const smartResult = await findSmartAlternatives({
        supabase,
        productId,
        productName,
        co2Category: evaluation.co2Category,
        currentScore: evaluation.score,
        evaluateProduct,
        getEnrichedData,
        lang: 'nl',
        maxResults: 5
      })
      alternatives = smartResult.alternatives
      suggestionTip = smartResult.tip
    }
    
    res.json({
      productId,
      productName,
      score: evaluation.score,
      rating: evaluation.rating,
      breakdown,
      improvements,
      alternatives,
      suggestionTip,
      enrichedFactors: evaluation.enriched || [],
      suggestions: evaluation.suggestions,
      hasEnrichedData: evaluation.hasEnrichedData,
      isNonFood: evaluation.isNonFood || false,
      // CO2 data
      co2PerKg: evaluation.co2PerKg,
      co2Min: evaluation.co2Min || null,
      co2Max: evaluation.co2Max || null,
      co2Valid: evaluation.co2Valid != null ? evaluation.co2Valid : null,
      co2Category: evaluation.co2Category,
      co2CategoryLabel: evaluation.co2CategoryLabel,
      co2Matched: evaluation.co2Matched,
      co2Method: evaluation.co2Method,
      ingredientBreakdown: evaluation.ingredientBreakdown || null,
      unitSize: product?.unit_size || null,
      ...(() => {
        const w = getProductWeight(product?.unit_size, evaluation.co2Category, product?.name || productName)
        return { weightGrams: w.weightGrams, weightSource: w.source }
      })()
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
  const { product, lang } = req.query
  const language = lang === 'en' ? 'en' : 'nl'
  const evaluation = evaluateProduct(product || '', null, language)
  res.json({ suggestions: evaluation.suggestions })
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
// Submit questionnaire responses (pre/post exposure surveys or carbon ranking game)
app.post('/api/questionnaire/submit', async (req, res) => {
  try {
    const { bonus_card, questionnaire_type, responses } = req.body
    
    if (!bonus_card) {
      return res.status(400).json({ error: 'bonus_card is required' })
    }
    
    if (!questionnaire_type || !['pre', 'post', 'carbon_ranking'].includes(questionnaire_type)) {
      return res.status(400).json({ error: 'questionnaire_type must be "pre", "post", or "carbon_ranking"' })
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
    
    if (type && ['pre', 'post', 'carbon_ranking'].includes(type)) {
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
      post_completed: completed.includes('post'),
      carbon_ranking_completed: completed.includes('carbon_ranking')
    })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Non-food keywords to filter out for carbon ranking game
const NON_FOOD_KEYWORDS = [
  // Dutch non-food items
  'toiletpapier', 'wc-papier', 'wcpapier', 'keukenpapier', 'keukenrol',
  'zeep', 'handzeep', 'douchegel', 'shampoo', 'conditioner', 'bodylotion',
  'tandpasta', 'tandenborstel', 'mondwater', 'deodorant', 'scheermesjes',
  'schoonmaak', 'allesreiniger', 'afwasmiddel', 'wasmiddel', 'wasverzachter',
  'bleek', 'ontkalker', 'wc-blok', 'luchtverfriser', 'geurkaars',
  'luiers', 'billendoekjes', 'maandverband', 'tampons', 'tissues',
  'vuilniszak', 'prullenbak', 'bakpapier', 'aluminiumfolie', 'huishoudfolie',
  'vaatdoekjes', 'sponzen', 'schuurspons', 'dweil', 'bezem',
  'batterij', 'lamp', 'kaars', 'aansteker', 'lucifers',
  'huisdier', 'hondenbrokken', 'kattenbrokken', 'kattenbakvulling', 'hondenvoer', 'kattenvoer',
  // English non-food items (some products have English names)
  'toilet paper', 'kitchen roll', 'soap', 'shampoo', 'toothpaste', 'deodorant',
  'detergent', 'cleaner', 'dishwashing', 'laundry', 'bleach', 'diapers', 'tissues',
  'garbage bag', 'trash bag', 'batteries', 'candle', 'pet food', 'cat litter'
]

// Check if product name is likely food
function isLikelyFood(productName) {
  const nameLower = (productName || '').toLowerCase()
  return !NON_FOOD_KEYWORDS.some(keyword => nameLower.includes(keyword))
}

// Get 10 products for carbon ranking game: 5 from user's purchases, 5 from products table
app.get('/api/questionnaire/:bonusCard/ranking-products', async (req, res) => {
  try {
    const { bonusCard } = req.params
    
    if (!bonusCard) {
      return res.status(400).json({ error: 'Bonus card number required' })
    }

    // Get user's purchased product IDs (to exclude from "other" products)
    const { data: userPurchases, error: purchasesError } = await supabase
      .from('user_purchases')
      .select('product_id, product_name')
      .eq('bonus_card_number', bonusCard)
    
    if (purchasesError) {
      console.error('[ranking-products] Error fetching purchases:', purchasesError)
      return res.status(500).json({ error: purchasesError.message })
    }

    console.log(`[ranking-products] Card ${bonusCard}: found ${userPurchases?.length || 0} total purchases`)

    // Filter for food items only from purchases
    const foodPurchases = (userPurchases || []).filter(p => isLikelyFood(p.product_name))
    
    // Get unique purchased product IDs
    const purchasedIds = new Set(foodPurchases.map(p => p.product_id).filter(Boolean))
    
    // Randomly select up to 5 unique products from user's food purchases
    const shuffledPurchases = foodPurchases
      .filter((p, i, arr) => arr.findIndex(x => x.product_id === p.product_id) === i) // unique by product_id
      .sort(() => Math.random() - 0.5)
      .slice(0, 5)
    
    // Get products from products table that user hasn't purchased
    // Build query - only add exclusion filter if there are purchased IDs
    let productsQuery = supabase
      .from('products')
      .select('id, name, image_url, is_vegan, is_vegetarian, is_organic, is_fairtrade, origin_country, origin_by_month, ingredients, nutrition_text, nutrition_json')
    
    // Only exclude purchased IDs if there are any
    const purchasedIdArray = [...purchasedIds].filter(id => id)
    if (purchasedIdArray.length > 0) {
      productsQuery = productsQuery.not('id', 'in', `(${purchasedIdArray.join(',')})`)
    }
    
    const { data: allProducts, error: productsError } = await productsQuery.limit(300)
    
    console.log(`[ranking-products] Catalog query returned ${allProducts?.length || 0} products, error: ${productsError?.message || 'none'}`)
    
    if (productsError) {
      console.error('[ranking-products] Error fetching products:', productsError)
      return res.status(500).json({ error: productsError.message })
    }

    // Filter for food items only
    const allFoodProducts = (allProducts || []).filter(p => isLikelyFood(p.name))
    
    // Prefer products with enriched data for more meaningful scoring
    const enrichedProducts = allFoodProducts.filter(p => 
      p.is_vegan || p.is_vegetarian || p.is_organic || p.is_fairtrade || p.origin_country || p.origin_by_month
    )
    
    // Use enriched products first, then fill with any food products
    const candidateOtherProducts = enrichedProducts.length >= 5 
      ? enrichedProducts 
      : [...enrichedProducts, ...allFoodProducts.filter(p => !enrichedProducts.includes(p))]
    
    // Randomly select 5 products from candidates
    const otherProducts = candidateOtherProducts
      .sort(() => Math.random() - 0.5)
      .slice(0, 5)
    
    // Calculate actual sustainability scores for all products
    const fromPurchases = await Promise.all(shuffledPurchases.map(async (p) => {
      // Get enriched data from products table
      let enrichedData = null
      let productImage = null
      if (p.product_id) {
        const { data: product } = await supabase
          .from('products')
          .select('is_vegan, is_vegetarian, is_organic, is_fairtrade, origin_country, origin_by_month, image_url, ingredients, nutrition_text, nutrition_json')
          .eq('id', p.product_id)
          .single()
        if (product) {
          enrichedData = getEnrichedData(product)
          productImage = product.image_url
        }
      }
      const evaluation = evaluateProduct(p.product_name, enrichedData)
      return {
        id: p.product_id,
        name: p.product_name,
        image_url: enrichedData?.image_url || productImage || null,
        source: 'purchased',
        actual_score: evaluation.score,
        co2PerKg: evaluation.co2PerKg,
        enriched: evaluation.enriched
      }
    }))
    
    const fromOther = otherProducts.map(p => {
      const enrichedData = getEnrichedData(p)
      const evaluation = evaluateProduct(p.name, enrichedData)
      return {
        id: p.id,
        name: p.name,
        image_url: p.image_url,
        source: 'catalog',
        actual_score: evaluation.score,
        co2PerKg: evaluation.co2PerKg,
        enriched: evaluation.enriched
      }
    })
    
    // Combine, filter out products without CO2 data, and shuffle
    const allRankingProducts = [...fromPurchases, ...fromOther]
      .filter(p => p.co2PerKg != null && p.co2PerKg > 0)
      .sort(() => Math.random() - 0.5)
    
    console.log(`[ranking-products] Card ${bonusCard}: purchases=${fromPurchases.length}, catalog=${fromOther.length}, total=${allRankingProducts.length}`)
    
    // Check if we have enough products (minimum 4 for a meaningful game)
    if (allRankingProducts.length < 4) {
      console.log(`[ranking-products] Not enough products. Purchases found: ${userPurchases?.length || 0}, food purchases: ${foodPurchases.length}, catalog products: ${allProducts?.length || 0}`)
      return res.status(400).json({ 
        error: 'not_enough_products',
        message: 'Not enough food products available for ranking game. Please import more purchases first.',
        available: allRankingProducts.length,
        debug: {
          total_purchases: userPurchases?.length || 0,
          food_purchases: foodPurchases.length,
          catalog_products: allProducts?.length || 0,
          food_catalog: allFoodProducts?.length || 0
        }
      })
    }
    
    res.json({
      products: allRankingProducts,
      total: allRankingProducts.length,
      from_purchases: fromPurchases.length,
      from_catalog: fromOther.length
    })
  } catch (e) {
    console.error('[ranking-products] Exception:', e)
    res.status(500).json({ error: e.message })
  }
})

// ==== ORIGIN SCRAPER ENDPOINTS ====
// Get origin scraper status
app.get('/api/origin-scraper/status', (req, res) => {
  res.json({
    running: originScraperState.running,
    lastRun: originScraperState.lastRun,
    productsScraped: originScraperState.productsScraped
  })
})

// Manually trigger the origin scraper
app.post('/api/origin-scraper/trigger', (req, res) => {
  if (originScraperState.running) {
    return res.status(409).json({ error: 'already_running' })
  }
  
  triggerBackgroundOriginScraper()
  res.json({ ok: true, message: 'Origin scraper triggered' })
})

// ===========================================================================
// EXPERIMENT API ENDPOINTS
// Multi-step CO2 awareness experiment with A/B testing
// ===========================================================================

// Start or resume an experiment session
app.post('/api/experiment/start', async (req, res) => {
  try {
    const { bonus_card, anonymous_id } = req.body
    const identifier = bonus_card || anonymous_id
    if (!identifier) {
      return res.status(400).json({ error: 'bonus_card or anonymous_id is required' })
    }

    // Check for existing active (non-complete) session by bonus_card or anonymous_id
    let existing = null
    if (bonus_card) {
      const { data } = await supabase
        .from('experiment_sessions')
        .select('*')
        .eq('bonus_card', bonus_card)
        .neq('current_step', 'complete')
        .order('started_at', { ascending: false })
        .limit(1)
      if (data?.length) existing = data[0]
    }
    if (!existing && anonymous_id) {
      const { data } = await supabase
        .from('experiment_sessions')
        .select('*')
        .eq('anonymous_id', anonymous_id)
        .neq('current_step', 'complete')
        .order('started_at', { ascending: false })
        .limit(1)
      if (data?.length) existing = data[0]
    }

    if (existing) {
      // If we now have a bonus card and the session didn't, link it
      if (bonus_card && !existing.bonus_card) {
        await supabase
          .from('experiment_sessions')
          .update({ bonus_card, updated_at: new Date().toISOString() })
          .eq('id', existing.id)
        existing.bonus_card = bonus_card
      }
      return res.json({ session: existing, resumed: true })
    }

    // Create new session with A/B assignment
    const ab_variant = assignABVariant(bonus_card || anonymous_id)
    
    const insertData = {
      ab_variant,
      current_step: 'consent',
      consent_given: false
    }
    if (bonus_card) insertData.bonus_card = bonus_card
    if (anonymous_id) insertData.anonymous_id = anonymous_id

    const { data, error } = await supabase
      .from('experiment_sessions')
      .insert(insertData)
      .select()
      .single()

    if (error) {
      console.error('[experiment/start] Error:', error)
      return res.status(500).json({ error: error.message })
    }

    res.json({ session: data, resumed: false })
  } catch (e) {
    console.error('[experiment/start] Exception:', e)
    res.status(500).json({ error: e.message })
  }
})

// Get experiment session status
app.get('/api/experiment/:bonusCard/session', async (req, res) => {
  try {
    const { bonusCard } = req.params

    const { data, error } = await supabase
      .from('experiment_sessions')
      .select('*')
      .eq('bonus_card', bonusCard)
      .order('started_at', { ascending: false })
      .limit(1)

    if (error) {
      return res.status(500).json({ error: error.message })
    }

    if (!data || data.length === 0) {
      return res.json({ session: null })
    }

    res.json({ session: data[0] })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Update consent and advance to quiz1
app.post('/api/experiment/:sessionId/consent', async (req, res) => {
  try {
    const { sessionId } = req.params
    const { consent_given } = req.body

    if (!consent_given) {
      return res.status(400).json({ error: 'Consent must be given to proceed' })
    }

    const { data, error } = await supabase
      .from('experiment_sessions')
      .update({ 
        consent_given: true, 
        current_step: 'scrape',
        updated_at: new Date().toISOString()
      })
      .eq('id', sessionId)
      .select()
      .single()

    if (error) {
      return res.status(500).json({ error: error.message })
    }

    res.json({ session: data })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Mark scrape step complete and advance to first pre-quiz
app.post('/api/experiment/:sessionId/scrape-complete', async (req, res) => {
  try {
    const { sessionId } = req.params
    const { bonus_card } = req.body || {}

    const updateData = { 
      current_step: 'pre_quiz_general',
      updated_at: new Date().toISOString()
    }
    // Link bonus card to session if provided and not yet set
    if (bonus_card) {
      updateData.bonus_card = bonus_card
    }

    const { data, error } = await supabase
      .from('experiment_sessions')
      .update(updateData)
      .eq('id', sessionId)
      .select()
      .single()

    if (error) {
      return res.status(500).json({ error: error.message })
    }

    res.json({ session: data })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Get quiz items for a specific quiz (1-4)
app.get('/api/experiment/:sessionId/quiz/:quizNumber/items', async (req, res) => {
  try {
    const { sessionId, quizNumber } = req.params
    const quizNum = parseInt(quizNumber)
    
    if (![1, 2, 3, 4, 5, 6].includes(quizNum)) {
      return res.status(400).json({ error: 'Quiz number must be 1-6' })
    }

    // Get session to check state and used items
    const { data: session, error: sessionError } = await supabase
      .from('experiment_sessions')
      .select('*')
      .eq('id', sessionId)
      .single()

    if (sessionError || !session) {
      return res.status(404).json({ error: 'Session not found' })
    }

    // Check if quiz already has items assigned
    const quizDataKey = `quiz${quizNum}_data`
    if (session[quizDataKey] && session[quizDataKey].items) {
      // Return existing items (for page refresh / resume)
      return res.json({ items: session[quizDataKey].items })
    }

    // Collect already-used item IDs to prevent overlap
    const usedIds = new Set()
    for (const qn of [1, 2, 3, 4, 5, 6]) {
      const ids = session[`quiz${qn}_item_ids`]
      if (ids) ids.forEach(id => usedIds.add(id))
    }

    let items = []

    if (quizNum === 1) {
      // Generic pool A
      items = getGenericQuiz1Items()
    } else if (quizNum === 3) {
      // Generic pool B
      items = getGenericQuiz3Items()
    } else if (quizNum === 5) {
      // AH-specific pool C
      items = getAHQuiz5Items()
    } else if (quizNum === 6) {
      // AH-specific pool D
      items = getAHQuiz6Items()
    } else if (quizNum === 2 || quizNum === 4) {
      // Personal products from user's purchases
      const { data: userPurchases } = await supabase
        .from('user_purchases')
        .select('product_id, product_name')
        .eq('bonus_card_number', session.bonus_card)

      const foodPurchases = (userPurchases || []).filter(p => {
        const nameLower = (p.product_name || '').toLowerCase()
        return !isNonFood(nameLower)
      })

      // Deduplicate by product_id, exclude already-used
      const uniqueProducts = []
      const seenIds = new Set()
      for (const p of foodPurchases) {
        const pid = p.product_id || p.product_name
        if (!seenIds.has(pid) && !usedIds.has(pid) && !usedIds.has(p.product_name)) {
          seenIds.add(pid)
          uniqueProducts.push(p)
        }
      }

      // Enrich with CO2 data
      const enriched = await Promise.all(uniqueProducts.map(async (p) => {
        let enrichedData = null
        let productImage = null
        if (p.product_id) {
          const { data: product } = await supabase
            .from('products')
            .select('is_vegan, is_vegetarian, is_organic, is_fairtrade, origin_country, origin_by_month, image_url, ingredients, nutrition_text, nutrition_json')
            .eq('id', p.product_id)
            .single()
          if (product) {
            enrichedData = getEnrichedData(product)
            productImage = product.image_url
          }
        }
        const evaluation = evaluateProduct(p.product_name, enrichedData)
        return {
          id: p.product_id || p.product_name,
          name: p.product_name,
          image_url: productImage,
          image_emoji: null,
          source: 'purchased',
          co2PerKg: evaluation.co2PerKg,
          co2Category: evaluation.co2Category,
          co2Matched: evaluation.co2PerKg != null
        }
      }))

      // Filter valid CO2 data, shuffle, take up to 10
      items = enriched
        .filter(item => item.co2PerKg != null && item.co2PerKg > 0)
        .sort(() => Math.random() - 0.5)
        .slice(0, 10)
    }

    // Filter out any used IDs (safety)
    items = items.filter(item => !usedIds.has(item.id))

    if (items.length < 4) {
      return res.status(400).json({ 
        error: 'not_enough_products',
        message: `Not enough products available for quiz ${quizNum}. Need at least 4.`,
        available: items.length
      })
    }

    // Store item IDs in session to prevent reuse
    const itemIds = items.map(i => i.id)
    const { error: updateError } = await supabase
      .from('experiment_sessions')
      .update({ 
        [`quiz${quizNum}_item_ids`]: itemIds,
        [`quiz${quizNum}_data`]: { items },
        updated_at: new Date().toISOString()
      })
      .eq('id', sessionId)

    if (updateError) {
      console.error(`[experiment/quiz${quizNum}/items] Update error:`, updateError)
    }

    res.json({ items })
  } catch (e) {
    console.error(`[experiment/quiz/items] Exception:`, e)
    res.status(500).json({ error: e.message })
  }
})

// Submit quiz ranking results
app.post('/api/experiment/:sessionId/quiz/:quizNumber/submit', async (req, res) => {
  try {
    const { sessionId, quizNumber } = req.params
    const { user_ranking } = req.body  // Array of item objects in user's order
    const quizNum = parseInt(quizNumber)

    if (![1, 2, 3, 4, 5, 6].includes(quizNum)) {
      return res.status(400).json({ error: 'Quiz number must be 1-6' })
    }

    if (!user_ranking || !Array.isArray(user_ranking) || user_ranking.length === 0) {
      return res.status(400).json({ error: 'user_ranking array is required' })
    }

    // Get session to retrieve original items
    const { data: session } = await supabase
      .from('experiment_sessions')
      .select('*')
      .eq('id', sessionId)
      .single()

    if (!session) {
      return res.status(404).json({ error: 'Session not found' })
    }

    const quizDataKey = `quiz${quizNum}_data`
    const originalItems = session[quizDataKey]?.items || user_ranking

    // Calculate score
    const scoreResult = calculateRankingScore(user_ranking, originalItems)
    
    // Map quiz number → experiment step name (V2 flow)
    const stepMap = {
      1: 'pre_quiz_general',
      5: 'pre_quiz_ah',
      2: 'pre_quiz_personal',
      3: 'post_quiz_general',
      6: 'post_quiz_ah',
      4: 'post_quiz_personal'
    }
    const currentStep = stepMap[quizNum] || session.current_step
    const nextStep = getNextStep(currentStep)

    // Update session
    const updateData = {
      [quizDataKey]: {
        items: originalItems,
        user_ranking: user_ranking.map((item, i) => ({ rank: i + 1, id: item.id, name: item.name })),
        score: scoreResult.score,
        maxScore: scoreResult.maxScore,
        totalDistance: scoreResult.totalDistance,
        details: scoreResult.details,
        correctOrder: scoreResult.correctOrder
      },
      current_step: nextStep,
      updated_at: new Date().toISOString()
    }

    const { data, error } = await supabase
      .from('experiment_sessions')
      .update(updateData)
      .eq('id', sessionId)
      .select()
      .single()

    if (error) {
      return res.status(500).json({ error: error.message })
    }

    res.json({ 
      session: data,
      score: scoreResult.score,
      maxScore: scoreResult.maxScore,
      details: scoreResult.details,
      correctOrder: scoreResult.correctOrder,
      nextStep
    })
  } catch (e) {
    console.error('[experiment/quiz/submit] Exception:', e)
    res.status(500).json({ error: e.message })
  }
})

// Submit pre-questionnaire (closed Likert) and advance
app.post('/api/experiment/:sessionId/pre-questionnaire', async (req, res) => {
  try {
    const { sessionId } = req.params
    const { responses } = req.body

    if (!responses || typeof responses !== 'object') {
      return res.status(400).json({ error: 'responses object is required' })
    }

    const { data, error } = await supabase
      .from('experiment_sessions')
      .update({ 
        pre_questionnaire: responses,
        current_step: 'learning_dashboard',
        updated_at: new Date().toISOString()
      })
      .eq('id', sessionId)
      .select()
      .single()

    if (error) {
      return res.status(500).json({ error: error.message })
    }

    res.json({ session: data })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Legacy: Submit self-perception responses (kept for backward compat)
app.post('/api/experiment/:sessionId/self-perception', async (req, res) => {
  try {
    const { sessionId } = req.params
    const { responses } = req.body

    if (!responses || typeof responses !== 'object') {
      return res.status(400).json({ error: 'responses object is required' })
    }

    const { data, error } = await supabase
      .from('experiment_sessions')
      .update({ 
        self_perception: responses,
        current_step: 'learning_dashboard',
        updated_at: new Date().toISOString()
      })
      .eq('id', sessionId)
      .select()
      .single()

    if (error) {
      return res.status(500).json({ error: error.message })
    }

    res.json({ session: data })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Advance past learning/dashboard step
app.post('/api/experiment/:sessionId/learning-complete', async (req, res) => {
  try {
    const { sessionId } = req.params

    const { data, error } = await supabase
      .from('experiment_sessions')
      .update({ 
        current_step: 'post_quiz_general',
        updated_at: new Date().toISOString()
      })
      .eq('id', sessionId)
      .select()
      .single()

    if (error) {
      return res.status(500).json({ error: error.message })
    }

    res.json({ session: data })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Legacy: Advance past intervention step (backward compat)
app.post('/api/experiment/:sessionId/intervention-complete', async (req, res) => {
  try {
    const { sessionId } = req.params

    const { data, error } = await supabase
      .from('experiment_sessions')
      .update({ 
        current_step: 'post_quiz_general',
        updated_at: new Date().toISOString()
      })
      .eq('id', sessionId)
      .select()
      .single()

    if (error) {
      return res.status(500).json({ error: error.message })
    }

    res.json({ session: data })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Submit post-questionnaire (closed Likert) and advance to reflection
app.post('/api/experiment/:sessionId/post-questionnaire', async (req, res) => {
  try {
    const { sessionId } = req.params
    const { responses } = req.body

    if (!responses || typeof responses !== 'object') {
      return res.status(400).json({ error: 'responses object is required' })
    }

    const { data, error } = await supabase
      .from('experiment_sessions')
      .update({ 
        post_questionnaire_closed: responses,
        current_step: 'post_reflection',
        updated_at: new Date().toISOString()
      })
      .eq('id', sessionId)
      .select()
      .single()

    if (error) {
      return res.status(500).json({ error: error.message })
    }

    res.json({ session: data })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Submit reflection responses (open-ended) and complete experiment
app.post('/api/experiment/:sessionId/reflection', async (req, res) => {
  try {
    const { sessionId } = req.params
    const { responses } = req.body

    if (!responses || typeof responses !== 'object') {
      return res.status(400).json({ error: 'responses object is required' })
    }

    const { data, error } = await supabase
      .from('experiment_sessions')
      .update({ 
        reflection: responses,
        post_questionnaire_open: responses,
        current_step: 'complete',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', sessionId)
      .select()
      .single()

    if (error) {
      return res.status(500).json({ error: error.message })
    }

    res.json({ session: data, completed: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// Get experiment config (questions, etc.) for frontend
app.get('/api/experiment/config', (req, res) => {
  res.json({
    selfPerceptionQuestions: SELF_PERCEPTION_QUESTIONS,
    reflectionQuestions: REFLECTION_QUESTIONS,
    preQuestionnaireQuestions: PRE_QUESTIONNAIRE_QUESTIONS,
    postQuestionnaireQuestions: POST_QUESTIONNAIRE_QUESTIONS,
    steps: EXPERIMENT_STEPS
  })
})

// Debug endpoint to test inserting into user_purchases
app.post('/api/debug/test-insert', async (req, res) => {
  const bonusCard = req.body.bonus_card
  if (!bonusCard) {
    return res.status(400).json({ error: 'bonus_card required - do not use defaults to avoid data contamination' })
  }
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
// Purchases are recorded per-user in user_purchases table (by bonus_card)
app.post('/api/ingest/scrape', async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : []
    if (!items.length) return res.status(400).json({ error: 'no_items' })

    const bonusCard = req.body?.bonus_card?.toString().trim() || null
    const sessionId = req.headers['x-session-id']
    const requestStore = req.body?.store?.toString().trim() || 'ah'  // 'ah' or 'jumbo'
    
    // Enhanced logging for debugging bonus card issues
    const isDev = process.env.NODE_ENV !== 'production'
    const cardDisplay = bonusCard 
      ? (isDev ? bonusCard : '****' + bonusCard.slice(-4))
      : 'NONE'
    
    console.log(`[Ingest] ===== NEW REQUEST =====`)
    console.log(`[Ingest] Items: ${items.length}, Store: ${requestStore}`)
    console.log(`[Ingest] Bonus Card: ${cardDisplay}`)
    console.log(`[Ingest] Session ID: ${sessionId ? sessionId.slice(0, 8) + '...' : 'none'}`)
    console.log(`[Ingest] Source IP: ${req.ip || req.connection?.remoteAddress || 'unknown'}`)

    // Normalize and de-duplicate by URL if present, else by normalized name + source
    const seen = new Set()
    const cleaned = []
    const seenIds = new Set()
    for (const raw of items) {
      const rawName = (raw?.name || '').toString().trim()
      if (!rawName) continue
      const url = (raw?.url || '').toString().trim()
      const source = (raw?.source || (requestStore === 'jumbo' ? 'jumbo_bonus' : 'ah_bonus')).toString().trim()
      const itemStore = raw?.store || requestStore  // Per-item store or request-level store
      
      // Use helper to extract ID and name from URL
      const extracted = extractProductFromUrl(url, rawName, itemStore)
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
          // Check if user already exists (to preserve their variant)
          const { data: existingUser } = await supabase
            .from('ah_bonus_users')
            .select('website_variant')
            .eq('bonus_card_number', bonusCard)
            .single()

          const upsertData = {
            bonus_card_number: bonusCard,
            last_scrape_at: new Date().toISOString(),
            scrape_count: 1
          }
          // Only assign variant for new users
          if (!existingUser || !existingUser.website_variant) {
            upsertData.website_variant = Math.random() < 0.5 ? 'A' : 'B'
          }

          const { error: userError } = await supabase
            .from('ah_bonus_users')
            .upsert(upsertData, {
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

      // 3. If bonus card provided, record purchases
      if (bonusCard) {
        const now = new Date().toISOString()
        const purchaseRecords = cleaned.map(p => ({
          bonus_card_number: bonusCard,
          product_id: p.id,
          product_name: p.name,
          product_url: p.url,
          price: p.price,
          quantity: 1,
          source: req.body?.source || 'bookmarklet',
          purchased_at: now,
          scraped_at: now,
          last_seen_at: now
        }))

        const cardForLog = isDev ? bonusCard : ('****' + bonusCard.slice(-4))
        console.log(`[Ingest] Recording ${purchaseRecords.length} purchases for bonus card ${cardForLog}`)
        if (isDev) {
          console.log(`[Ingest] Sample purchase record:`, JSON.stringify(purchaseRecords[0], null, 2))
        }

        // Step A: INSERT new products (duplicates will fail with 23505, that's fine)
        const { data, error: insertError } = await supabase
          .from('user_purchases')
          .insert(purchaseRecords)
          .select()
        
        let newlyInserted = 0
        if (insertError) {
          if (insertError.code === '23505') {
            // Some or all are duplicates — try inserting one by one to get the new ones in
            console.log('[Ingest] Batch insert hit duplicates — inserting individually...')
            for (const record of purchaseRecords) {
              const { error: singleErr } = await supabase
                .from('user_purchases')
                .insert([record])
              if (!singleErr) newlyInserted++
            }
            console.log(`[Ingest] Individual insert: ${newlyInserted} new, ${purchaseRecords.length - newlyInserted} already existed`)
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
          newlyInserted = data?.length || purchaseRecords.length
          console.log(`[Ingest] SUCCESS: Inserted ${newlyInserted} new purchase records`)
        }

        // Step B: UPDATE last_seen_at (and price) for ALL products in this scrape
        // This keeps track of which items are still in the user's history
        const productIds = cleaned.map(p => p.id).filter(Boolean)
        if (productIds.length > 0) {
          const { error: updateError } = await supabase
            .from('user_purchases')
            .update({ last_seen_at: now })
            .eq('bonus_card_number', bonusCard)
            .in('product_id', productIds)

          if (updateError) {
            console.error('[Ingest] last_seen_at update error:', updateError.message)
          } else {
            console.log(`[Ingest] Updated last_seen_at for ${productIds.length} products`)
          }

          // Also update price if it changed (non-null new price)
          for (const p of cleaned) {
            if (p.id && p.price != null) {
              await supabase
                .from('user_purchases')
                .update({ price: p.price })
                .eq('bonus_card_number', bonusCard)
                .eq('product_id', p.id)
            }
          }
        }

        purchasesRecorded = purchaseRecords.length
      } else {
        console.log('[Ingest] No bonusCard - skipping user_purchases insert')
      }
    }

    // Trigger background origin scraper to populate details for new products
    // This runs asynchronously and won't delay the response
    if (stored > 0) {
      triggerBackgroundOriginScraper()
    }

    // Build redirect URL for bookmarklet
    // Use custom APP_URL env var, or default to production domain
    // Query params must come BEFORE hash fragment
    // Redirect back to experiment flow after import (experiment handles next step)
    const appBase = process.env.APP_URL || 'https://www.bubblebrainz.com'
    const redirectUrl = bonusCard
      ? `${appBase}/?card=${bonusCard}&scraped=1#experiment`
      : `${appBase}/?scraped=1#experiment`

    return res.json({ 
      ok: true, 
      received: items.length, 
      stored,
      purchasesRecorded,
      purchaseError: purchaseError ? { code: purchaseError.code, message: purchaseError.message, hint: purchaseError.hint } : null,
      queuedForEnrichment,
      authType: bonusCard ? 'bonus_card' : 'anonymous',
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
        .not('url', 'is', null)  // Only products with URLs can be enriched
        .or('details_scrape_status.is.null,details_scrape_status.eq.incomplete')
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
            nutrition_text: result.data.nutrition_text ?? null,
            nutrition_json: result.data.nutrition_json ?? null,
            details_scraped_at: new Date().toISOString(),
          }
          
          // Mark as 'incomplete' if key fields are missing so it gets re-scraped
          const hasKeyFields = result.data.price != null && result.data.image_url && result.data.ingredients
          updateData.details_scrape_status = hasKeyFields ? 'success' : 'incomplete'
          
          await supabase
            .from('products')
            .update(updateData)
            .eq('id', productId)
          
          autoEnrichQueue.stats.totalProcessed++
          console.log(`[Auto-Enrich] ${hasKeyFields ? 'Successfully' : 'Partially'} enriched: ${product.name}${!hasKeyFields ? ' [incomplete]' : ''}`)
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
  logs: []
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
  
  // Cookie capture doesn't need user tracking
  const startedAt = new Date().toISOString()
  cookieCaptureState.running = true
  cookieCaptureState.startedAt = startedAt
  cookieCaptureState.logs = []
  
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
  
  // Visual login doesn't track userId — purchases are linked via bonus card at bookmarklet ingest time
  const startedAt = new Date().toISOString()
  autoScrapeState.running = true
  autoScrapeState.startedAt = startedAt
  autoScrapeState.lastRun = { status: 'running', startedAt }
  autoScrapeState.logs = []
  autoScrapeState.progress = 'Opening browser window...'
  
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
          
          // Auto-scrape stores to product catalog only
          // User purchases are linked via bonus card during bookmarklet ingest
          appendAutoScrapeLog('info', `⚠️ Products stored to catalog only — use bookmarklet with bonus card to link purchases`)
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
// Products stored to catalog only — purchases linked via bonus card at bookmarklet ingest
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
  autoScrapeState.lastRun = { status: 'running', startedAt }
  autoScrapeState.logs = []
  autoScrapeState.progress = 'Starting scraper in background...'
  
  appendAutoScrapeLog('info', 'Starting AH scraper in stealth mode (background)...')
  
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
  
  // Auto-scrape only stores to product catalog
  // No userId tracking needed
  
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
        
        // Auto-scrape stores to product catalog only
        // User purchases are linked via bonus card during bookmarklet ingest
        appendAutoScrapeLog('info', '✅ Scrape completed — products stored to catalog')
      } catch (e) {
        appendAutoScrapeLog('stderr', `Ingestion error: ${e.message}`)
      }
    }
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
