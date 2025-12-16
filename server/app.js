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
const SUPABASE_PRODUCTS_TABLE = process.env.SUPABASE_PRODUCTS_TABLE || 'ah_products'
const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : null
const PYTHON_CMD = process.env.PYTHON || 'python3'
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

// Data file path
const DATA_FILE = path.join(__dirname, 'purchases.json')

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
  { code: 'keyword_local', delta: 1, match: (name) => name.includes('lokaal') || name.includes('local') },
  { code: 'keyword_plant', delta: 2, match: (name) => name.includes('plant') || name.includes('vega') || name.includes('soja') || name.includes('tofu') || name.includes('havermelk') },
  { code: 'keyword_meat', delta: -3, match: (name) => name.includes('vlees') || name.includes('beef') || name.includes('rund') || name.includes('kip') || name.includes('meat') },
  { code: 'keyword_plastic', delta: -1, match: (name) => name.includes('plastic') || name.includes('verpakt') }
]

// Helper functions
async function loadPurchases() {
  try {
    const data = await fs.readFile(DATA_FILE, 'utf8')
    return JSON.parse(data)
  } catch (error) {
    return []
  }
}

async function savePurchases(purchases) {
  await fs.writeFile(DATA_FILE, JSON.stringify(purchases, null, 2))
}

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

function evaluateProduct(productName = '') {
  const input = typeof productName === 'string' ? productName : ''
  const normalized = normalizeProductName(input)
  const lowerProduct = input.toLowerCase()
  let workingScore = 5
  const adjustments = []
  const matchedCategories = []
  const matchedKeywords = []
  const categorySet = new Set()
  let suggestions = getSuggestions(input)
  let notes = null
  let matchedProduct = null

  const applyCategory = (category) => {
    if (!category || categorySet.has(category) || !CATEGORY_KEYS.has(category)) return
    categorySet.add(category)
    const catData = SUSTAINABILITY_DB.categories[category]
    if (catData) {
      matchedCategories.push({
        category,
        icon: catData.icon,
        referenceScore: catData.score
      })
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

    if (Array.isArray(entry.suggestions) && entry.suggestions.length > 0) {
      suggestions = entry.suggestions
    }

    const baseDelta = (entry.baseScore ?? 5) - 5
    if (baseDelta) {
      applyDelta('catalog', 'catalog_base', baseDelta)
    }

    if (Array.isArray(entry.categories)) {
      for (const category of entry.categories) {
        applyCategory(category)
      }
    }

    if (Array.isArray(entry.adjustments)) {
      for (const adj of entry.adjustments) {
        if (!adj || typeof adj.delta !== 'number') continue
        applyDelta('catalog', adj.code, adj.delta)
      }
    }
  }

  const productData = SUSTAINABILITY_DB.products[normalized] || SUSTAINABILITY_DB.products[lowerProduct]
  if (productData && Array.isArray(productData.categories)) {
    for (const category of productData.categories) {
      applyCategory(category)
    }
  }

  for (const rule of KEYWORD_RULES) {
    if (rule.match(lowerProduct)) {
      applyDelta('keyword', rule.code, rule.delta)
      matchedKeywords.push(rule.code)
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
    suggestions,
    rating: getRating(finalScore),
    notes,
    matched: matchedProduct
  }
}

function calculateScore(productName) {
  return evaluateProduct(productName).score
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

function getSuggestions(productName) {
  const suggestions = []
  const lowerProduct = productName.toLowerCase()

  if ((lowerProduct.includes('melk') || lowerProduct.includes('milk')) && !lowerProduct.includes('haver') && !lowerProduct.includes('soja')) {
    suggestions.push('🥬 Probeer havermelk of sojamelk - 75% minder CO2!')
  }

  if (lowerProduct.includes('vlees') || lowerProduct.includes('beef') || lowerProduct.includes('rund')) {
    suggestions.push('🥬 Probeer tofu of tempeh - 90% minder CO2!')
  }

  if (lowerProduct.includes('kip') || lowerProduct.includes('chicken')) {
    suggestions.push('🥬 Probeer plantaardige kip alternatieven')
  }

  if (!lowerProduct.includes('bio') && !lowerProduct.includes('organic') && !lowerProduct.includes('fair')) {
    suggestions.push('🌱 Zoek naar biologische of Fair Trade varianten')
  }

  if (lowerProduct.includes('plastic') || lowerProduct.includes('verpakt')) {
    suggestions.push('♻️ Kies voor producten met minder verpakking')
  }

  return suggestions.length > 0 ? suggestions : ['Geweldig! Je maakt al een goede keuze! ✨']
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

// API Routes
app.get('/api/purchases', async (req, res) => {
  const purchases = await loadPurchases()
  res.json(purchases)
})

app.post('/api/purchases', async (req, res) => {
  const { product, quantity, price } = req.body
  const evaluation = evaluateProduct(product)

  const purchase = {
    date: new Date().toISOString(),
    product: product,
    quantity: parseInt(quantity) || 1,
    price: parseFloat(price) || 0,
    sustainability_score: evaluation.score
  }

  const purchases = await loadPurchases()
  purchases.push(purchase)
  await savePurchases(purchases)

  res.json({ success: true, purchase })
})

// Support both GET and POST for score lookup
app.get('/api/score', (req, res) => {
  const { product, item } = req.query
  const input = typeof product === 'string' && product.trim().length > 0
    ? product
    : (typeof item === 'string' ? item : '')
  if (!product || typeof product !== 'string' || product.trim().length === 0) {
    if (!input || input.trim().length === 0) {
      return res.status(400).json({ error: 'missing_product' })
    }
  }

  const evaluation = evaluateProduct(input || product)
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

app.get('/api/insights', async (req, res) => {
  const purchases = await loadPurchases()

  if (purchases.length === 0) {
    return res.json({ message: 'No purchases yet!' })
  }

  const totalScore = purchases.reduce((sum, p) => sum + p.sustainability_score, 0)
  const avgScore = totalScore / purchases.length

  const best = purchases.reduce((max, p) => (p.sustainability_score > max.sustainability_score ? p : max))
  const worst = purchases.reduce((min, p) => (p.sustainability_score < min.sustainability_score ? p : min))

  res.json({
    total_purchases: purchases.length,
    average_score: avgScore,
    rating: getRating(avgScore),
    best_purchase: best.product,
    worst_purchase: worst.product,
    total_spent: purchases.reduce((sum, p) => sum + p.price, 0)
  })
})

app.get('/api/profile_suggestions', async (req, res) => {
  try {
    const dataPath = path.join(__dirname, '..', '..', 'predictions.json')
    const content = await fs.readFile(dataPath, 'utf8')
    const parsed = JSON.parse(content)
    res.json(parsed)
  } catch (err) {
    res.status(500).json({ error: 'predictions not available', details: err.message })
  }
})

app.get('/api/catalog/meta', async (req, res) => {
  if (req.query.refresh === 'true') {
    await refreshCatalog({ force: true })
  }
  res.json(getCatalogMeta())
})

// Ingest scraped items from the user's browser (extension/bookmarklet)
app.post('/api/ingest/scrape', async (req, res) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items : []
    if (!items.length) return res.status(400).json({ error: 'no_items' })

    // Normalize and de-duplicate by URL if present, else by normalized name + source
  const seen = new Set()
  const cleaned = []
  const seenIds = new Set()
    for (const raw of items) {
      const name = (raw?.name || '').toString().trim()
      if (!name) continue
      const url = (raw?.url || '').toString().trim()
      const source = (raw?.source || 'ah_bonus').toString().trim()
  const normalized_name = normalizeProductName(name)
  const key = url || `${normalized_name}::${source}`
  if (seen.has(key)) continue
  seen.add(key)
      // Human-readable ID: try to extract AH slug from URL, else prefix normalized_name
      let id = null
      let slugName = null
      if (url) {
        try {
          const u = new URL(url)
          // Expected: /producten/product/<wi...>/<slug>
          const parts = u.pathname.split('/').filter(Boolean)
          const slug = parts[parts.length - 1]
          if (slug && /^[a-z0-9\-]+$/.test(slug)) {
            id = slug
            // Create display name from slug
            slugName = slug.replace(/-/g, ' ')
            slugName = slugName.replace(/\b[a-z]/g, (c) => c.toUpperCase())
          }
        } catch (_) {
          // ignore URL parsing errors
        }
      }
      if (!id) {
        id = `ah-${normalized_name.replace(/\s+/g, '-')}`
      }

      // De-duplicate by final id to avoid ON CONFLICT multiple-affect error
      if (seenIds.has(id)) {
        continue
      }
      seenIds.add(id)
      const finalName = slugName || name
      const finalNormalized = id ? normalizeProductName((slugName || '').toLowerCase()) : normalizeProductName(finalName)

      cleaned.push({
        id,
        name: finalName,
        normalized_name: finalNormalized,
        url: url || null,
        image_url: (raw?.image || '').toString().trim() || null,
        price: (typeof raw?.price === 'number' && !Number.isNaN(raw.price)) ? raw.price : null,
        source,
        updated_at: new Date().toISOString()
      })
    }

    if (!cleaned.length) return res.status(400).json({ error: 'no_valid_items' })

    let stored = 0
    if (supabase) {
      const { error } = await supabase
        .from(SUPABASE_PRODUCTS_TABLE)
        .upsert(cleaned, { onConflict: 'id' })
      if (error) return res.status(500).json({ error: 'supabase_insert_failed', detail: error.message })
      stored = cleaned.length
    }

    return res.json({ ok: true, received: items.length, stored })
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

// Start automated scraping with user credentials
app.post('/api/auto-scrape', async (req, res) => {
  // Block on hosted environments (Vercel) - cannot run headless browsers
  if (process.env.VERCEL) {
    return res.status(501).json({ 
      error: 'not_supported_on_hosted',
      message: 'Automated scraping is not available on hosted environments. Please use the bookmarklet method instead.'
    })
  }
  
  if (autoScrapeState.running) {
    return res.status(409).json({ 
      error: 'scrape_in_progress', 
      startedAt: autoScrapeState.startedAt 
    })
  }
  
  const { email, password } = req.body || {}
  
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
  autoScrapeState.lastRun = { status: 'running', startedAt }
  autoScrapeState.logs = []
  autoScrapeState.progress = 'Starting automated scraper...'
  
  appendAutoScrapeLog('info', 'Starting automated AH scraper...')
  appendAutoScrapeLog('info', `Email: ${email.substring(0, 3)}***@${email.split('@')[1] || '***'}`)
  
  let autoScrapeProcess
  try {
    autoScrapeProcess = spawn(PYTHON_CMD, [
      AUTO_SCRAPE_SCRIPT,
      '--email', email,
      '--password', password,
      '--headless'
    ], {
      cwd: __dirname,
      env: { ...process.env, PYTHONUNBUFFERED: '1' }
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
    autoScrapeState.lastRun = {
      status: code === 0 && resultData?.success ? 'success' : 'error',
      startedAt,
      completedAt,
      durationMs,
      error: code !== 0 ? `Scraper exited with code ${code}` : (resultData?.error || null),
      productsFound: resultData?.count || 0
    }
    
    appendAutoScrapeLog('info', code === 0 ? 'Auto-scrape process completed.' : `Auto-scrape exited with code ${code}`)
    
    // If we got products, ingest them to Supabase
    if (resultData?.success && resultData?.products?.length > 0 && supabase) {
      appendAutoScrapeLog('info', `Ingesting ${resultData.products.length} products to database...`)
      
      try {
        // Normalize and prepare products for ingestion
        const cleaned = resultData.products.map((item) => {
          const name = (item.name || '').toString().trim()
          const normalized = normalizeProductName(name)
          const url = (item.url || '').toString().trim()
          
          // Generate ID from URL or name
          let id = null
          if (url) {
            const urlMatch = url.match(/\/producten\/product\/[^/]+\/([^/?#]+)/)
            if (urlMatch) id = urlMatch[1]
          }
          if (!id) {
            id = `auto_${normalized.replace(/[^a-z0-9]/g, '_').substring(0, 50)}`
          }
          
          return {
            id,
            name,
            normalized_name: normalized,
            url: url || null,
            image_url: (item.image || '').toString().trim() || null,
            price: typeof item.price === 'number' ? item.price : null,
            source: 'ah_auto_scrape',
            tags: null,
            updated_at: new Date().toISOString()
          }
        }).filter((item) => item.name && item.id)
        
        // Upsert to Supabase
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
  
  return res.status(202).json({ status: 'started', startedAt })
})

// Get auto-scrape status
app.get('/api/auto-scrape/status', (req, res) => {
  res.json({
    status: autoScrapeState.running ? 'running' : 'idle',
    running: autoScrapeState.running,
    startedAt: autoScrapeState.startedAt,
    lastRun: autoScrapeState.lastRun,
    progress: autoScrapeState.progress,
    logs: autoScrapeState.logs.slice(-100)
  })
})

// Check if auto-scrape is available (not on Vercel)
app.get('/api/auto-scrape/available', (req, res) => {
  res.json({
    available: !process.env.VERCEL,
    reason: process.env.VERCEL ? 'hosted_environment' : null
  })
})

// Serve built frontend (if present) so http://localhost:3001 serves the SPA in production/local builds
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
