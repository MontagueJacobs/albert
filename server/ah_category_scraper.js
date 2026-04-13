#!/usr/bin/env node
/**
 * AH Category Scraper
 *
 * Scrapes products from Albert Heijn's API by taxonomy category and upserts
 * them into Supabase. Uses the AH search API (no browser needed).
 *
 * 29 built-in presets covering every AH department, plus meta-groups:
 *   --preset plantbased           Single preset (default)
 *   --preset vlees,vis,kaas       Multiple presets (comma-separated)
 *   --all                         Every AH category
 *   --all-food                    All food categories (21 presets)
 *   --all-nonfood                 All non-food categories (6 presets)
 *
 * Custom categories:
 *   --taxonomy 18041              Scrape a single taxonomy ID
 *   --taxonomy 18041,5282         Scrape multiple taxonomy IDs
 *
 * Ingredient enrichment (uses Playwright-based product_detail_scraper.py):
 *   --enrich                      Enrich products missing ingredients (standalone)
 *   --enrich-after                Auto-enrich after running the API scrape
 *   --enrich-limit 50             Max products to enrich (default: 20)
 *   --enrich-delay 5              Seconds between requests (default: 3)
 *   --enrich-force                Re-try previously failed products
 *
 * Options:
 *   --dry-run              Scrape and save JSON but don't upsert to Supabase
 *   --json-only            Only save JSON, skip Supabase entirely
 *   --out <file>           Output JSON filename (default: ah_<preset>_products.json)
 *   --source <name>        Override Supabase source tag (default: per-preset)
 *   --verbose              Show per-product output
 *
 * Usage:
 *   node server/ah_category_scraper.js                         # Scrape plant-based preset
 *   node server/ah_category_scraper.js --preset plantbased     # Same as above
 *   node server/ah_category_scraper.js --preset vlees,vis      # Multiple presets
 *   node server/ah_category_scraper.js --all                   # Scrape ALL categories
 *   node server/ah_category_scraper.js --all-food              # All food categories
 *   node server/ah_category_scraper.js --taxonomy 18041        # Just meat substitutes
 *   node server/ah_category_scraper.js --dry-run               # Scrape but don't import
 *   node server/ah_category_scraper.js --list                  # Show available presets
 *   node server/ah_category_scraper.js --enrich --enrich-limit 50  # Enrich 50 products
 *   node server/ah_category_scraper.js --preset zuivel --enrich-after  # Scrape + enrich
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------

const AH_API_BASE = 'https://api.ah.nl/mobile-services/product/search/v2'
const AH_TOKEN_URL = 'https://api.ah.nl/mobile-auth/v1/auth/token/anonymous'
const AH_HEADERS = {
  'X-Application': 'AHWEBSHOP',
  'User-Agent': 'Appie/8.22.3',
  'Content-Type': 'application/json',
}

/** Page size per API request (AH max is 1000, 100 is safe) */
const PAGE_SIZE = 100

/** Delay between API requests (ms) — be polite */
const REQUEST_DELAY = 300

// ---------------------------------------------------------------
// Presets - named groups of taxonomy IDs
// ---------------------------------------------------------------

const PRESETS = {
  // ── Plant-based (uses sub-taxonomies for broader coverage) ────────
  plantbased: {
    name: 'Vegetarisch, vegan en plantaardig',
    description: 'All plant-based/vegan/vegetarian products',
    source: 'api_plantbased',
    group: 'food',
    taxonomies: [
      { id: 18041, name: 'Vleesvervangers' },
      { id: 5282,  name: 'Plantaardige zuivel alternatieven' },
      { id: 8611,  name: 'Plantaardige drinks' },
      { id: 19816, name: 'Vegetarisch en plantaardig beleg' },
    ]
  },

  // ── Verse producten ───────────────────────────────────────────────
  groente: {
    name: 'Groente, aardappelen',
    description: 'Vegetables and potatoes',
    source: 'api_groente',
    group: 'food',
    taxonomies: [{ id: 6401, name: 'Groente, aardappelen' }]
  },
  fruit: {
    name: 'Fruit, verse sappen',
    description: 'Fruit and fresh juices',
    source: 'api_fruit',
    group: 'food',
    taxonomies: [{ id: 20885, name: 'Fruit, verse sappen' }]
  },
  maaltijden: {
    name: 'Maaltijden, salades',
    description: 'Ready meals and salads',
    source: 'api_maaltijden',
    group: 'food',
    taxonomies: [{ id: 1301, name: 'Maaltijden, salades' }]
  },

  // ── Vlees & vis ───────────────────────────────────────────────────
  vlees: {
    name: 'Vlees',
    description: 'Meat',
    source: 'api_vlees',
    group: 'food',
    taxonomies: [{ id: 9344, name: 'Vlees' }]
  },
  vis: {
    name: 'Vis',
    description: 'Fish and seafood',
    source: 'api_vis',
    group: 'food',
    taxonomies: [{ id: 1651, name: 'Vis' }]
  },
  vleeswaren: {
    name: 'Vleeswaren',
    description: 'Cold cuts and deli meats',
    source: 'api_vleeswaren',
    group: 'food',
    taxonomies: [{ id: 5481, name: 'Vleeswaren' }]
  },

  // ── Zuivel & kaas ────────────────────────────────────────────────
  kaas: {
    name: 'Kaas',
    description: 'Cheese',
    source: 'api_kaas',
    group: 'food',
    taxonomies: [{ id: 1192, name: 'Kaas' }]
  },
  zuivel: {
    name: 'Zuivel, eieren',
    description: 'Dairy products and eggs',
    source: 'api_zuivel',
    group: 'food',
    taxonomies: [{ id: 1730, name: 'Zuivel, eieren' }]
  },

  // ── Bakkerij ──────────────────────────────────────────────────────
  bakkerij: {
    name: 'Bakkerij',
    description: 'Bakery and bread',
    source: 'api_bakkerij',
    group: 'food',
    taxonomies: [{ id: 1355, name: 'Bakkerij' }]
  },

  // ── Voorraadkast ──────────────────────────────────────────────────
  pasta_rijst: {
    name: 'Pasta, rijst, wereldkeuken',
    description: 'Pasta, rice, and world cuisine',
    source: 'api_pasta_rijst',
    group: 'food',
    taxonomies: [{ id: 1796, name: 'Pasta, rijst, wereldkeuken' }]
  },
  soepen_sauzen: {
    name: 'Soepen, sauzen, kruiden, olie',
    description: 'Soups, sauces, herbs, oils',
    source: 'api_soepen_sauzen',
    group: 'food',
    taxonomies: [{ id: 6409, name: 'Soepen, sauzen, kruiden, olie' }]
  },
  ontbijt_beleg: {
    name: 'Ontbijtgranen, beleg',
    description: 'Cereals and sandwich toppings',
    source: 'api_ontbijt_beleg',
    group: 'food',
    taxonomies: [{ id: 6405, name: 'Ontbijtgranen, beleg' }]
  },

  // ── Snacks & snoep ───────────────────────────────────────────────
  borrel_chips: {
    name: 'Borrel, chips, snacks',
    description: 'Appetizers, chips, and snacks',
    source: 'api_borrel_chips',
    group: 'food',
    taxonomies: [{ id: 20824, name: 'Borrel, chips, snacks' }]
  },
  koek_snoep: {
    name: 'Koek, snoep, chocolade',
    description: 'Cookies, sweets, chocolate',
    source: 'api_koek_snoep',
    group: 'food',
    taxonomies: [{ id: 20129, name: 'Koek, snoep, chocolade' }]
  },
  tussendoortjes: {
    name: 'Tussendoortjes',
    description: 'Snacks and between meals',
    source: 'api_tussendoortjes',
    group: 'food',
    taxonomies: [{ id: 2457, name: 'Tussendoortjes' }]
  },

  // ── Diepvries ─────────────────────────────────────────────────────
  diepvries: {
    name: 'Diepvries',
    description: 'Frozen foods',
    source: 'api_diepvries',
    group: 'food',
    taxonomies: [{ id: 5881, name: 'Diepvries' }]
  },

  // ── Glutenvrij ────────────────────────────────────────────────────
  glutenvrij: {
    name: 'Glutenvrij',
    description: 'Gluten-free products',
    source: 'api_glutenvrij',
    group: 'food',
    taxonomies: [{ id: 4246, name: 'Glutenvrij' }]
  },

  // ── Dranken ───────────────────────────────────────────────────────
  koffie_thee: {
    name: 'Koffie, thee',
    description: 'Coffee and tea',
    source: 'api_koffie_thee',
    group: 'food',
    taxonomies: [{ id: 1043, name: 'Koffie, thee' }]
  },
  frisdrank: {
    name: 'Frisdrank, sappen, water',
    description: 'Soft drinks, juices, water',
    source: 'api_frisdrank',
    group: 'food',
    taxonomies: [{ id: 20130, name: 'Frisdrank, sappen, water' }]
  },
  bier_wijn: {
    name: 'Bier, wijn, aperitieven',
    description: 'Beer, wine, spirits (18+)',
    source: 'api_bier_wijn',
    group: 'food',
    nix18: true,
    taxonomies: [{ id: 6406, name: 'Bier, wijn, aperitieven' }]
  },

  // ── Non-food ──────────────────────────────────────────────────────
  drogisterij: {
    name: 'Drogisterij',
    description: 'Drugstore / personal care',
    source: 'api_drogisterij',
    group: 'nonfood',
    taxonomies: [{ id: 1045, name: 'Drogisterij' }]
  },
  gezondheid: {
    name: 'Gezondheid en sport',
    description: 'Health and sports',
    source: 'api_gezondheid',
    group: 'nonfood',
    taxonomies: [{ id: 11717, name: 'Gezondheid en sport' }]
  },
  huishouden: {
    name: 'Huishouden',
    description: 'Household products',
    source: 'api_huishouden',
    group: 'nonfood',
    taxonomies: [{ id: 1165, name: 'Huishouden' }]
  },
  baby_kind: {
    name: 'Baby en kind',
    description: 'Baby and children products',
    source: 'api_baby_kind',
    group: 'nonfood',
    taxonomies: [{ id: 18521, name: 'Baby en kind' }]
  },
  huisdier: {
    name: 'Huisdier',
    description: 'Pet supplies',
    source: 'api_huisdier',
    group: 'nonfood',
    taxonomies: [{ id: 18519, name: 'Huisdier' }]
  },
  koken_tafelen: {
    name: 'Koken, tafelen, vrije tijd',
    description: 'Cooking, dining, leisure',
    source: 'api_koken_tafelen',
    group: 'nonfood',
    taxonomies: [{ id: 1057, name: 'Koken, tafelen, vrije tijd' }]
  },

  // ── Special / seasonal ────────────────────────────────────────────
  voordeelshop: {
    name: 'AH Voordeelshop',
    description: 'AH discount shop',
    source: 'api_voordeelshop',
    group: 'special',
    taxonomies: [{ id: 20603, name: 'AH Voordeelshop' }]
  },
  pasen: {
    name: 'Pasen',
    description: 'Easter seasonal products',
    source: 'api_pasen',
    group: 'special',
    taxonomies: [{ id: 21024, name: 'Pasen' }]
  },
}

/** Helper: get presets filtered by group */
function getPresetsByGroup(group) {
  return Object.entries(PRESETS)
    .filter(([, p]) => p.group === group)
    .map(([key]) => key)
}

const FOOD_PRESETS = getPresetsByGroup('food')
const DRINK_PRESETS = ['koffie_thee', 'frisdrank', 'bier_wijn']
const FOOD_NO_DRINK_PRESETS = FOOD_PRESETS.filter(p => !DRINK_PRESETS.includes(p))
const NONFOOD_PRESETS = getPresetsByGroup('nonfood')
const ALL_PRESETS = Object.keys(PRESETS)

// ---------------------------------------------------------------
// AH API helpers
// ---------------------------------------------------------------

let _accessToken = null
let _tokenExpiry = 0

async function getAccessToken() {
  if (_accessToken && Date.now() < _tokenExpiry) return _accessToken

  const res = await fetch(AH_TOKEN_URL, {
    method: 'POST',
    headers: AH_HEADERS,
    body: JSON.stringify({ clientId: 'appie' })
  })

  if (!res.ok) throw new Error(`Token request failed: ${res.status} ${res.statusText}`)

  const data = await res.json()
  _accessToken = data.access_token
  // Expire 5 min early to be safe
  _tokenExpiry = Date.now() + (data.expires_in - 300) * 1000
  return _accessToken
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Fetch one page of products for a taxonomy ID.
 * @returns {{ products: object[], totalElements: number, totalPages: number }}
 */
async function fetchTaxonomyPage(taxonomyId, page = 0, size = PAGE_SIZE) {
  const token = await getAccessToken()
  const url = `${AH_API_BASE}?taxonomyId=${taxonomyId}&size=${size}&page=${page}`

  const res = await fetch(url, {
    headers: {
      ...AH_HEADERS,
      'Authorization': `Bearer ${token}`
    }
  })

  if (!res.ok) {
    throw new Error(`API error ${res.status} for taxonomy ${taxonomyId} page ${page}`)
  }

  const data = await res.json()
  return {
    products: data.products || [],
    totalElements: data.page?.totalElements || 0,
    totalPages: data.page?.totalPages || 0
  }
}

/**
 * Fetch ALL products for a taxonomy ID (handles pagination).
 */
async function fetchAllForTaxonomy(taxonomyId, taxonomyName, verbose = false) {
  const allProducts = []

  // First page to get total
  const first = await fetchTaxonomyPage(taxonomyId, 0)
  const total = first.totalElements
  const totalPages = Math.ceil(total / PAGE_SIZE)

  if (verbose) {
    console.log(`  [${taxonomyName}] ${total} products, ${totalPages} page(s)`)
  }

  allProducts.push(...first.products)

  // Remaining pages
  for (let page = 1; page < totalPages; page++) {
    await sleep(REQUEST_DELAY)
    const { products } = await fetchTaxonomyPage(taxonomyId, page)
    allProducts.push(...products)
    if (verbose) {
      process.stdout.write(`  [${taxonomyName}] Page ${page + 1}/${totalPages} (${allProducts.length}/${total})\r`)
    }
  }

  if (verbose && totalPages > 1) console.log()

  return allProducts.map(p => transformProduct(p, taxonomyId, taxonomyName))
}

// ---------------------------------------------------------------
// Product transformation
// ---------------------------------------------------------------

/** Extract subcategory from AH's taxonomy path. */
function extractSubCategory(product) {
  const cats = product.taxonomies || []
  // Last taxonomy entry is usually the most specific subcategory
  if (cats.length > 0) {
    return cats[cats.length - 1].name || null
  }
  return product.subCategory || null
}

/** Transform a raw AH API product into our normalized format. */
function transformProduct(raw, taxonomyId, taxonomyName) {
  const id = `wi${raw.webshopId}`
  const subCategory = extractSubCategory(raw)

  // propertyIcons is a flat string array like ["vegan", "biologisch", "vega"]
  const icons = (raw.propertyIcons || []).map(s => String(s).toLowerCase())

  const is_vegan = icons.includes('vegan')
  const is_vegetarian = is_vegan || icons.includes('vega') || icons.includes('vegetarisch')
  const is_organic = icons.includes('biologisch') || icons.includes('organic')

  return {
    id,
    name: raw.title || raw.description || '',
    url: `https://www.ah.nl/producten/product/${id}`,
    price: raw.priceBeforeBonus ?? raw.currentPrice ?? null,
    image_url: raw.images?.[0]?.url || null,
    mainCategory: raw.mainCategory || 'Vegetarisch, vegan en plantaardig',
    subCategory,
    taxonomyId: String(taxonomyId),
    taxonomyName,
    brand: raw.brand || null,
    salesUnitSize: raw.salesUnitSize || null,
    is_vegan,
    is_vegetarian,
    is_organic,
    nutriscore: raw.nutriscore || null,
  }
}

// ---------------------------------------------------------------
// Supabase upsert
// ---------------------------------------------------------------

function connectSupabase() {
  // Load .env from project root
  const envPath = join(__dirname, '..', '.env')
  try {
    const envContent = readFileSync(envPath, 'utf8')
    for (const line of envContent.split('\n')) {
      const match = line.match(/^([A-Z_]+)=(.*)$/)
      if (match) process.env[match[1]] = match[2].trim()
    }
  } catch { /* .env not found */ }

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY

  if (!url || !key) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env')
    return null
  }

  return createClient(url, key)
}

/**
 * Upsert products to Supabase.
 * Updates existing records, inserts new ones.
 */
async function upsertToSupabase(supabase, products, source) {
  const now = new Date().toISOString()
  let inserted = 0, updated = 0, errors = 0

  // Work in batches of 50
  const BATCH = 50
  for (let i = 0; i < products.length; i += BATCH) {
    const batch = products.slice(i, i + BATCH)

    const rows = batch.map(p => ({
      id: p.id,
      name: p.name,
      normalized_name: p.name.toLowerCase().replace(/[^a-z0-9\u00e0-\u00ff]+/g, ' ').trim(),
      url: p.url,
      image_url: p.image_url,
      price: p.price,
      brand: p.brand,
      unit_size: p.salesUnitSize,
      is_vegan: p.is_vegan,
      is_vegetarian: p.is_vegetarian,
      is_organic: p.is_organic,
      nutri_score: p.nutriscore,
      source,
      categories: [
        `ah:${p.taxonomyName}`,
        ...(p.subCategory ? [`ah_sub:${p.subCategory}`] : [])
      ],
      updated_at: now,
      last_seen_at: now,
    }))

    const { data, error } = await supabase
      .from('products')
      .upsert(rows, { onConflict: 'id', ignoreDuplicates: false })

    if (error) {
      console.error(`  Batch error at offset ${i}:`, error.message)
      errors += batch.length
    } else {
      // Count new vs updated (approximation: new ones won't have created_at == updated_at)
      inserted += batch.length
    }
  }

  return { inserted, errors }
}

// ---------------------------------------------------------------
// Enrichment: fetch ingredients/nutrition via product_detail_scraper.py
// ---------------------------------------------------------------

const DEFAULT_VENV_PYTHON = resolve(__dirname, '../../AH/bin/python')
const PYTHON_CMD = process.env.PYTHON || (existsSync(DEFAULT_VENV_PYTHON) ? DEFAULT_VENV_PYTHON : 'python3')
const PRODUCT_DETAIL_SCRIPT = join(__dirname, 'product_detail_scraper.py')

/**
 * Spawn the Playwright-based Python scraper for a batch of product URLs.
 * Uses --batch mode: one browser session for all products (no restart per page).
 *
 * Results are streamed: every time the Python scraper finishes a product it
 * emits a `[PRODUCT_RESULT] {...}` line on stdout.  We parse those lines
 * as they arrive and call `onResult(detail)` immediately so the caller can
 * persist each result to Supabase right away — no data lost on Ctrl-C.
 *
 * @param {string[]}  urls      - Product URLs to scrape
 * @param {object}    opts      - { headless, delay, verbose, onResult }
 * @param {Function}  opts.onResult - Called with each parsed result object as it streams in
 * @returns {Promise<number>}   - Number of results streamed (0 on total failure)
 */
function scrapeProductDetailsBatch(urls, { headless = true, delay = 3, verbose = false, onResult } = {}) {
  return new Promise((res) => {
    if (!existsSync(PRODUCT_DETAIL_SCRIPT)) {
      console.error('  ✗ product_detail_scraper.py not found at', PRODUCT_DETAIL_SCRIPT)
      res(0)
      return
    }

    const args = [
      PRODUCT_DETAIL_SCRIPT,
      '--batch',
      '--delay', String(delay),
      '--output', join(__dirname, '_enrich_results.json'),
    ]
    if (headless) args.push('--headless')
    else args.push('--no-headless')

    if (verbose) console.log(`  Spawning: ${PYTHON_CMD} ${args.join(' ')}`)

    const proc = spawn(PYTHON_CMD, args, {
      cwd: dirname(PRODUCT_DETAIL_SCRIPT),
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    // Feed URLs via stdin, then close
    proc.stdin.write(urls.join('\n') + '\n')
    proc.stdin.end()

    let stderr = ''
    let streamed = 0
    let lineBuf = ''   // buffer for partial lines

    // Stream scraper progress to console and parse [PRODUCT_RESULT] lines live
    proc.stdout.on('data', d => {
      lineBuf += d.toString()
      const lines = lineBuf.split('\n')
      lineBuf = lines.pop() // keep incomplete trailing line in buffer

      for (const line of lines) {
        if (line.startsWith('[PRODUCT_RESULT] ')) {
          try {
            const detail = JSON.parse(line.slice('[PRODUCT_RESULT] '.length))
            streamed++
            if (onResult) onResult(detail)
          } catch (e) {
            console.error('  ✗ Failed to parse [PRODUCT_RESULT] line:', e.message)
          }
        } else if (line.startsWith('[INFO]') || line.startsWith('[SUCCESS]') || line.startsWith('[WARN]')) {
          console.log(`    ${line}`)
        }
      }
    })
    proc.stderr.on('data', d => { stderr += d.toString() })

    proc.on('close', (code) => {
      // Process any remaining data in the line buffer
      if (lineBuf.startsWith('[PRODUCT_RESULT] ')) {
        try {
          const detail = JSON.parse(lineBuf.slice('[PRODUCT_RESULT] '.length))
          streamed++
          if (onResult) onResult(detail)
        } catch {}
      }

      if (code !== 0 && code !== null) {
        console.error(`  ✗ Scraper exited with code ${code}`)
        if (stderr) console.error('    stderr:', stderr.slice(-400))
      }
      res(streamed)
    })

    // Timeout: 5 min per product headless, 10 min per product non-headless
    const perProductTimeout = headless ? 300000 : 600000
    const totalTimeout = Math.max(perProductTimeout, urls.length * (headless ? 60000 : 120000))
    setTimeout(() => {
      proc.kill()
      console.error(`  ✗ Scraper timeout (${Math.round(totalTimeout / 1000)}s)`)
      res(streamed)
    }, totalTimeout)
  })
}

/**
 * Enrich products in Supabase that are missing ingredient data.
 * Uses the Playwright-based product_detail_scraper.py in batch mode —
 * one browser session for all products (no restart between pages).
 *
 * @param {object} supabase  - Supabase client
 * @param {object} opts      - { limit, delay, source, verbose, force, headless }
 */
async function enrichProducts(supabase, opts = {}) {
  const {
    limit = 20,
    delay = 3,
    source = null,
    verbose = false,
    force = false,
    headless = true,
  } = opts

  console.log('╔══════════════════════════════════════════════════════╗')
  console.log('║       Ingredient Enrichment                        ║')
  console.log('╚══════════════════════════════════════════════════════╝')
  console.log()

  // Query products missing ingredients (paginate to bypass Supabase 1000-row limit)
  const PAGE = 1000
  let products = []

  for (let offset = 0; products.length < limit; offset += PAGE) {
    const batchSize = Math.min(PAGE, limit - products.length)
    let query = supabase
      .from('products')
      .select('id, name, url, ingredients, details_scrape_status')

    if (!force) {
      query = query
        .is('ingredients', null)
        .not('details_scrape_status', 'eq', 'failed')
        .not('details_scrape_status', 'eq', 'non_food')
    }

    if (source) {
      query = query.eq('source', source)
    }

    query = query.order('updated_at', { ascending: false }).range(offset, offset + batchSize - 1)

    const { data, error } = await query

    if (error) {
      console.error('  ✗ Supabase query error:', error.message)
      return
    }

    if (!data || data.length === 0) break
    products.push(...data)
    if (data.length < batchSize) break // no more rows
  }

  if (!products || products.length === 0) {
    console.log('  ✓ No products need enrichment!')
    return
  }

  // Build URL list and index by URL for later matching
  const urlToProduct = new Map()
  const urls = []
  for (const p of products) {
    const productUrl = p.url || `https://www.ah.nl/producten/product/${p.id}`
    urls.push(productUrl)
    urlToProduct.set(productUrl, p)
  }

  console.log(`  Found ${products.length} products missing ingredients (limit: ${limit})`)
  console.log(`  Delay between requests: ${delay}s`)
  console.log(`  Browser: ${headless ? 'headless' : 'VISIBLE — log in when the browser opens'}`)
  console.log(`  Python: ${PYTHON_CMD}`)
  console.log(`  Mode: single browser session (batch)`)
  console.log(`  Saving: incremental — each product saved to Supabase as it completes`)
  console.log()

  for (let i = 0; i < products.length; i++) {
    console.log(`  ${(i + 1).toString().padStart(3)}. ${products[i].name}`)
  }
  console.log()

  // Counters updated live as results stream in
  let success = 0, failed = 0, partial = 0

  // onResult callback — saves each product to Supabase the moment it arrives
  const onResult = async (detail) => {
    const p = urlToProduct.get(detail.url)
    if (!p) {
      console.log(`    ? No matching product for URL: ${detail.url}`)
      return
    }

    if (!detail.success) {
      console.log(`  ✗ ${p.name}: Failed${detail.error ? ' — ' + detail.error : ''}`)
      await supabase
        .from('products')
        .update({
          details_scrape_status: 'failed',
          details_scraped_at: new Date().toISOString(),
        })
        .eq('id', p.id)
      failed++
    } else {
      const updateData = {}
      if (detail.ingredients) updateData.ingredients = detail.ingredients
      if (detail.nutrition_text) updateData.nutrition_text = detail.nutrition_text
      if (detail.nutrition_json) updateData.nutrition_json = detail.nutrition_json
      if (detail.is_vegan != null) updateData.is_vegan = detail.is_vegan
      if (detail.is_vegetarian != null) updateData.is_vegetarian = detail.is_vegetarian
      if (detail.is_organic != null) updateData.is_organic = detail.is_organic
      if (detail.is_fairtrade != null) updateData.is_fairtrade = detail.is_fairtrade
      if (detail.nutri_score) updateData.nutri_score = detail.nutri_score
      if (detail.origin_country) updateData.origin_country = detail.origin_country
      if (detail.origin_by_month) updateData.origin_by_month = detail.origin_by_month
      if (detail.brand) updateData.brand = detail.brand
      if (detail.allergens && detail.allergens.length) updateData.allergens = detail.allergens

      const hasIngredients = !!detail.ingredients
      updateData.details_scrape_status = hasIngredients ? 'success' : 'incomplete'
      updateData.details_scraped_at = new Date().toISOString()

      const { error: updateError } = await supabase
        .from('products')
        .update(updateData)
        .eq('id', p.id)

      if (updateError) {
        console.log(`  ✗ ${p.name}: DB error — ${updateError.message}`)
        failed++
      } else if (hasIngredients) {
        console.log(`  ✓ ${p.name}: ${detail.ingredients.substring(0, 70)}...`)
        success++
      } else {
        console.log(`  ~ ${p.name}: no ingredients found on page`)
        partial++
      }
    }
  }

  // Run the scraper — results stream in via onResult and are saved immediately
  const streamed = await scrapeProductDetailsBatch(urls, { headless, delay, verbose, onResult })

  // Mark any products that got no result at all (e.g. scraper crashed mid-batch)
  const processedUrls = new Set()
  // We can't easily track which URLs were processed inside onResult without state,
  // so use the counters: if streamed < total, some were never processed
  if (streamed < products.length) {
    console.log(`  ⚠ ${products.length - streamed} products did not produce a result (scraper interrupted?)`)
  }

  console.log()
  console.log(`  ── Enrichment summary ──`)
  console.log(`     Success:    ${success}`)
  console.log(`     Partial:    ${partial} (no ingredients on page)`)
  console.log(`     Failed:     ${failed}`)
  console.log(`     Streamed:   ${streamed} / ${products.length}`)
  console.log(`     ★ All saved results are already in Supabase`)
}

// ---------------------------------------------------------------
// CLI
// ---------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2)
  const opts = {
    presets: ['plantbased'],   // array of preset names to scrape
    taxonomyIds: null,
    dryRun: false,
    jsonOnly: false,
    outFile: null,
    source: null,
    verbose: false,
    list: false,
    // Enrichment options
    enrich: false,          // standalone enrichment mode
    enrichAfter: false,     // auto-enrich after scrape
    enrichLimit: 20,        // max products to enrich
    enrichDelay: 3,         // seconds between enrichment requests
    enrichForce: false,     // re-enrich even previously failed products
    headless: false,        // visible browser by default (AH blocks headless)
  }

  let presetExplicitlySet = false

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--preset':
      case '-p':
        opts.presets = args[++i].split(',').map(s => s.trim()).filter(Boolean)
        presetExplicitlySet = true
        break
      case '--all':
        opts.presets = ALL_PRESETS
        presetExplicitlySet = true
        break
      case '--all-food':
        opts.presets = FOOD_PRESETS
        presetExplicitlySet = true
        break
      case '--all-food-no-drinks':
        opts.presets = FOOD_NO_DRINK_PRESETS
        presetExplicitlySet = true
        break
      case '--all-nonfood':
        opts.presets = NONFOOD_PRESETS
        presetExplicitlySet = true
        break
      case '--taxonomy':
      case '-t':
        opts.taxonomyIds = args[++i].split(',').map(Number)
        break
      case '--dry-run':
        opts.dryRun = true
        break
      case '--json-only':
        opts.jsonOnly = true
        break
      case '--out':
      case '-o':
        opts.outFile = args[++i]
        break
      case '--source':
      case '-s':
        opts.source = args[++i]
        break
      case '--verbose':
      case '-v':
        opts.verbose = true
        break
      case '--list':
      case '-l':
        opts.list = true
        break
      case '--enrich':
        opts.enrich = true
        break
      case '--enrich-after':
        opts.enrichAfter = true
        break
      case '--enrich-limit':
      case '--limit':
        opts.enrichLimit = parseInt(args[++i], 10) || 20
        break
      case '--enrich-delay':
      case '--delay':
        opts.enrichDelay = parseFloat(args[++i]) || 3
        break
      case '--enrich-force':
        opts.enrichForce = true
        break
      case '--headless':
        opts.headless = true
        break
      case '--help':
      case '-h':
        console.log(`
AH Category Scraper — Scrape products from AH by taxonomy category

Usage:
  node server/ah_category_scraper.js [options]

Preset selection:
  --preset <names>    One or more presets, comma-separated (default: plantbased)
  --all               Scrape ALL categories (~34,000 products)
  --all-food          Scrape all food categories (~21 presets)
  --all-food-no-drinks  All food except drinks (no koffie/thee, frisdrank, bier/wijn)
  --all-nonfood       Scrape all non-food categories (~6 presets)

Custom categories:
  --taxonomy <ids>    Scrape specific taxonomy IDs (comma-separated)

Ingredient enrichment (uses Playwright browser scraper):
  --enrich            Enrich products missing ingredients (standalone, no API scrape)
  --enrich-after      Auto-enrich after running the API scrape
  --enrich-limit <n>  Max products to enrich per run (default: 20)
  --enrich-delay <s>  Seconds between enrichment requests (default: 3)
  --enrich-force      Re-try products that previously failed enrichment
  --headless          Run browser headless (default: visible, AH blocks headless)

Options:
  --dry-run           Scrape & save JSON, skip Supabase upsert
  --json-only         Only save JSON file
  --out <file>        Output JSON filename
  --source <name>     Override Supabase source tag
  --verbose           Show per-product output
  --list              Show available presets
  --help              Show this help

Examples:
  node server/ah_category_scraper.js                           # Default: plant-based
  node server/ah_category_scraper.js --preset vlees,vis        # Meat + fish
  node server/ah_category_scraper.js --all-food --dry-run      # All food, no DB write
  node server/ah_category_scraper.js --all                     # Everything
  node server/ah_category_scraper.js --enrich --enrich-limit 50  # Enrich 50 products
  node server/ah_category_scraper.js --preset zuivel --enrich-after  # Scrape + enrich
`)
        process.exit(0)
        break
    }
  }

  // If --taxonomy is used, it overrides presets
  if (opts.taxonomyIds) {
    opts.presets = null
  }

  return opts
}

// ---------------------------------------------------------------
// Main
// ---------------------------------------------------------------

async function main() {
  const opts = parseArgs()

  // ── List presets ──────────────────────────────────────────────────
  if (opts.list) {
    console.log('\nAvailable presets:\n')
    const groups = { food: [], nonfood: [], special: [] }
    for (const [key, preset] of Object.entries(PRESETS)) {
      groups[preset.group || 'special'].push([key, preset])
    }

    for (const [groupName, entries] of Object.entries(groups)) {
      if (entries.length === 0) continue
      console.log(`  ─── ${groupName.toUpperCase()} ───`)
      for (const [key, preset] of entries) {
        const taxIds = preset.taxonomies.map(t => t.id).join(', ')
        const nix = preset.nix18 ? ' (18+)' : ''
        console.log(`  ${key.padEnd(16)} ${preset.name}${nix}`)
        console.log(`  ${''.padEnd(16)} IDs: ${taxIds}  |  source: ${preset.source}`)
      }
      console.log()
    }

    console.log('  Meta-groups:')
    console.log(`    --all            ${ALL_PRESETS.length} presets (all categories)`)
    console.log(`    --all-food       ${FOOD_PRESETS.length} presets (food only)`)
    console.log(`    --all-food-no-drinks  ${FOOD_NO_DRINK_PRESETS.length} presets (food, no drinks)`)
    console.log(`    --all-nonfood    ${NONFOOD_PRESETS.length} presets (non-food only)`)
    console.log()
    return
  }

  // ── Standalone enrichment mode ────────────────────────────────────
  if (opts.enrich) {
    const supabase = connectSupabase()
    if (!supabase) {
      console.error('Missing Supabase credentials. Cannot enrich.')
      process.exit(1)
    }
    await enrichProducts(supabase, {
      limit: opts.enrichLimit,
      delay: opts.enrichDelay,
      source: opts.source || null,
      verbose: opts.verbose,
      force: opts.enrichForce,
      headless: opts.headless,
    })
    console.log('\n── Done! ──────────────────────────────────────────────\n')
    return
  }

  // ── Banner ────────────────────────────────────────────────────────
  console.log('╔══════════════════════════════════════════════════════╗')
  console.log('║       AH Category Scraper                          ║')
  console.log('╚══════════════════════════════════════════════════════╝')
  console.log()

  // ── Build the list of scrape jobs ─────────────────────────────────
  // Each job = { label, taxonomies, source, outFile }
  const jobs = []

  if (opts.taxonomyIds) {
    // Custom taxonomy IDs → single job
    const source = opts.source || 'api_custom'
    const label = 'custom'
    jobs.push({
      label,
      taxonomies: opts.taxonomyIds.map(id => ({ id, name: `Taxonomy_${id}` })),
      source,
      outFile: opts.outFile || join(__dirname, `ah_custom_products.json`),
    })
  } else {
    // Validate preset names
    for (const name of opts.presets) {
      if (!PRESETS[name]) {
        console.error(`Unknown preset: "${name}". Use --list to see available presets.`)
        process.exit(1)
      }
    }

    if (opts.presets.length === 1) {
      // Single preset → single job (keeps previous behaviour)
      const preset = PRESETS[opts.presets[0]]
      jobs.push({
        label: opts.presets[0],
        taxonomies: preset.taxonomies,
        source: opts.source || preset.source,
        outFile: opts.outFile || join(__dirname, `ah_${opts.presets[0]}_products.json`),
      })
    } else {
      // Multiple presets → one job per preset
      for (const name of opts.presets) {
        const preset = PRESETS[name]
        jobs.push({
          label: name,
          taxonomies: preset.taxonomies,
          source: opts.source || preset.source,
          // When scraping multiple, each gets its own file
          outFile: join(__dirname, `ah_${name}_products.json`),
        })
      }
    }
  }

  const multiJob = jobs.length > 1
  if (multiJob) {
    console.log(`Scraping ${jobs.length} categories: ${jobs.map(j => j.label).join(', ')}`)
    console.log(`Supabase: ${opts.jsonOnly ? 'SKIP' : opts.dryRun ? 'DRY RUN' : 'UPSERT (per-category source tag)'}`)
    console.log()
  } else {
    const job = jobs[0]
    console.log(`Preset:     ${job.label}`)
    console.log(`Source tag: ${job.source}`)
    console.log(`Taxonomies: ${job.taxonomies.map(t => `${t.id} (${t.name})`).join(', ')}`)
    console.log(`Output:     ${job.outFile}`)
    console.log(`Supabase:   ${opts.jsonOnly ? 'SKIP' : opts.dryRun ? 'DRY RUN' : 'UPSERT'}`)
    console.log()
  }

  // ── Connect Supabase once (if needed) ─────────────────────────────
  let supabase = null
  if (!opts.jsonOnly && !opts.dryRun) {
    supabase = connectSupabase()
    if (!supabase) {
      console.error('Missing Supabase credentials. Falling back to --json-only mode.')
      opts.jsonOnly = true
    }
  }

  // ── Run each job ──────────────────────────────────────────────────
  let grandTotal = 0
  let grandUpserted = 0
  let grandErrors = 0

  for (let jobIdx = 0; jobIdx < jobs.length; jobIdx++) {
    const job = jobs[jobIdx]

    if (multiJob) {
      console.log(`\n━━ [${jobIdx + 1}/${jobs.length}] ${job.label} (${PRESETS[job.label]?.name || job.label}) ━━`)
    }

    // Phase 1: Scrape from API
    console.log('── Phase 1: Scraping from AH API ──────────────────────')
    const allProducts = []
    const seenIds = new Set()

    for (const taxonomy of job.taxonomies) {
      try {
        console.log(`\n  Fetching ${taxonomy.name} (ID: ${taxonomy.id})...`)
        const products = await fetchAllForTaxonomy(taxonomy.id, taxonomy.name, opts.verbose)
        let newCount = 0
        for (const p of products) {
          if (!seenIds.has(p.id)) {
            seenIds.add(p.id)
            allProducts.push(p)
            newCount++
          }
        }
        console.log(`  ✓ ${products.length} products (${newCount} new, ${products.length - newCount} duplicates)`)
      } catch (err) {
        console.error(`  ✗ Error scraping taxonomy ${taxonomy.id}: ${err.message}`)
      }

      await sleep(500) // pause between taxonomies
    }

    console.log(`\n  Total unique products: ${allProducts.length}`)
    grandTotal += allProducts.length

    // Save JSON
    writeFileSync(job.outFile, JSON.stringify(allProducts, null, 2))
    console.log(`  Saved to ${job.outFile}`)

    // Subcategory breakdown (only for single-job or verbose)
    if (!multiJob || opts.verbose) {
      const subCounts = {}
      for (const p of allProducts) {
        const sub = p.subCategory || '(none)'
        subCounts[sub] = (subCounts[sub] || 0) + 1
      }
      console.log('\n  Subcategory breakdown:')
      Object.entries(subCounts)
        .sort((a, b) => b[1] - a[1])
        .forEach(([sub, count]) => console.log(`    ${count.toString().padStart(4)} ${sub}`))
    }

    // Vegan/vegetarian summary
    const veganCount = allProducts.filter(p => p.is_vegan).length
    const vegCount = allProducts.filter(p => p.is_vegetarian).length
    console.log(`\n  Vegan: ${veganCount}/${allProducts.length}  Vegetarian: ${vegCount}/${allProducts.length}`)

    // Phase 2: Supabase upsert
    if (!opts.jsonOnly) {
      console.log('\n── Phase 2: Supabase Upsert ───────────────────────────')

      if (opts.dryRun) {
        console.log('  [DRY RUN] Would upsert', allProducts.length, 'products with source:', job.source)
      } else if (supabase) {
        console.log(`  Upserting ${allProducts.length} products (source: ${job.source})...`)
        const result = await upsertToSupabase(supabase, allProducts, job.source)
        console.log(`  ✓ Upserted: ${result.inserted}  Errors: ${result.errors}`)
        grandUpserted += result.inserted
        grandErrors += result.errors
      }
    }
  }

  // ── Grand summary (multi-job) ─────────────────────────────────────
  if (multiJob) {
    console.log('\n╔══════════════════════════════════════════════════════╗')
    console.log('║       Grand Summary                                ║')
    console.log('╚══════════════════════════════════════════════════════╝')
    console.log(`  Categories scraped:  ${jobs.length}`)
    console.log(`  Total products:      ${grandTotal}`)
    if (!opts.jsonOnly && !opts.dryRun && supabase) {
      console.log(`  Upserted:            ${grandUpserted}`)
      console.log(`  Errors:              ${grandErrors}`)
    }
    console.log(`  JSON files:          server/ah_<category>_products.json`)
  }

  // Show DB totals
  if (!opts.jsonOnly && !opts.dryRun && supabase) {
    const { count } = await supabase
      .from('products')
      .select('*', { count: 'exact', head: true })
    console.log(`\n  Total products in DB: ${count}`)
  }

  // ── Optional enrichment after scrape ──────────────────────────────
  if (opts.enrichAfter && supabase) {
    console.log()
    await enrichProducts(supabase, {
      limit: opts.enrichLimit,
      delay: opts.enrichDelay,
      source: opts.source || null,
      verbose: opts.verbose,
      force: opts.enrichForce,
      headless: opts.headless,
    })
  }

  console.log('\n── Done! ──────────────────────────────────────────────\n')
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
