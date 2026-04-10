#!/usr/bin/env node
/**
 * AH Category Scraper
 *
 * Scrapes products from Albert Heijn's API by taxonomy category and upserts
 * them into Supabase. Uses the AH search API (no browser needed).
 *
 * Built-in presets:
 *   --preset plantbased   "Vegetarisch, vegan en plantaardig" (default)
 *                          Taxonomy IDs: 18041, 5282, 8611, 19816
 *
 * Custom categories:
 *   --taxonomy 18041       Scrape a single taxonomy ID
 *   --taxonomy 18041,5282  Scrape multiple taxonomy IDs
 *
 * Options:
 *   --dry-run              Scrape and save JSON but don't upsert to Supabase
 *   --json-only            Only save JSON, skip Supabase entirely
 *   --out <file>           Output JSON filename (default: ah_<preset>_products.json)
 *   --source <name>        Supabase source tag (default: api_plantbased)
 *   --verbose              Show per-product output
 *
 * Usage:
 *   node server/ah_category_scraper.js                         # Scrape plant-based preset
 *   node server/ah_category_scraper.js --preset plantbased     # Same as above
 *   node server/ah_category_scraper.js --taxonomy 18041        # Just meat substitutes
 *   node server/ah_category_scraper.js --taxonomy 18041,5282   # Multiple taxonomies
 *   node server/ah_category_scraper.js --dry-run               # Scrape but don't import
 *   node server/ah_category_scraper.js --list                  # Show available presets
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

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
  plantbased: {
    name: 'Vegetarisch, vegan en plantaardig',
    description: 'All plant-based/vegan/vegetarian products',
    source: 'api_plantbased',
    taxonomies: [
      { id: 18041, name: 'Vleesvervangers' },
      { id: 5282,  name: 'Plantaardige zuivel alternatieven' },
      { id: 8611,  name: 'Plantaardige drinks' },
      { id: 19816, name: 'Vegetarisch en plantaardig beleg' },
    ]
  },
  // Easy to add more presets here:
  // meatfishdairy: {
  //   name: 'Vlees, kip, vis + Zuivel',
  //   source: 'api_meatfishdairy',
  //   taxonomies: [ ... ]
  // },
}

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
// CLI
// ---------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2)
  const opts = {
    preset: 'plantbased',
    taxonomyIds: null,
    dryRun: false,
    jsonOnly: false,
    outFile: null,
    source: null,
    verbose: false,
    list: false,
  }

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--preset':
      case '-p':
        opts.preset = args[++i]
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
      case '--help':
      case '-h':
        console.log(`
AH Category Scraper — Scrape products from AH by taxonomy category

Usage:
  node server/ah_category_scraper.js [options]

Options:
  --preset <name>     Use a built-in preset (default: plantbased)
  --taxonomy <ids>    Scrape specific taxonomy IDs (comma-separated)
  --dry-run           Scrape & save JSON, skip Supabase upsert
  --json-only         Only save JSON file
  --out <file>        Output JSON filename
  --source <name>     Supabase source tag (default from preset)
  --verbose           Show per-product output
  --list              Show available presets
  --help              Show this help
`)
        process.exit(0)
        break
    }
  }

  return opts
}

// ---------------------------------------------------------------
// Main
// ---------------------------------------------------------------

async function main() {
  const opts = parseArgs()

  // List presets
  if (opts.list) {
    console.log('\nAvailable presets:\n')
    for (const [key, preset] of Object.entries(PRESETS)) {
      console.log(`  ${key}`)
      console.log(`    ${preset.name}`)
      console.log(`    Source: ${preset.source}`)
      console.log(`    Taxonomies:`)
      for (const t of preset.taxonomies) {
        console.log(`      ${t.id} - ${t.name}`)
      }
      console.log()
    }
    return
  }

  // Determine what to scrape
  let taxonomies
  let source
  let presetName

  if (opts.taxonomyIds) {
    // Custom taxonomy IDs
    taxonomies = opts.taxonomyIds.map(id => ({ id, name: `Taxonomy_${id}` }))
    source = opts.source || 'api_custom'
    presetName = 'custom'
  } else {
    // Use preset
    const preset = PRESETS[opts.preset]
    if (!preset) {
      console.error(`Unknown preset: ${opts.preset}. Use --list to see available presets.`)
      process.exit(1)
    }
    taxonomies = preset.taxonomies
    source = opts.source || preset.source
    presetName = opts.preset
  }

  const outFile = opts.outFile || join(__dirname, `ah_${presetName}_products.json`)

  console.log('╔══════════════════════════════════════════════════════╗')
  console.log('║       AH Category Scraper                          ║')
  console.log('╚══════════════════════════════════════════════════════╝')
  console.log()
  console.log(`Preset:     ${presetName}`)
  console.log(`Source tag: ${source}`)
  console.log(`Taxonomies: ${taxonomies.map(t => `${t.id} (${t.name})`).join(', ')}`)
  console.log(`Output:     ${outFile}`)
  console.log(`Supabase:   ${opts.jsonOnly ? 'SKIP' : opts.dryRun ? 'DRY RUN' : 'UPSERT'}`)
  console.log()

  // Phase 1: Scrape from API
  console.log('── Phase 1: Scraping from AH API ──────────────────────')
  const allProducts = []
  const seenIds = new Set()

  for (const taxonomy of taxonomies) {
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

  // Save JSON
  writeFileSync(outFile, JSON.stringify(allProducts, null, 2))
  console.log(`  Saved to ${outFile}`)

  // Subcategory breakdown
  const subCounts = {}
  for (const p of allProducts) {
    const sub = p.subCategory || '(none)'
    subCounts[sub] = (subCounts[sub] || 0) + 1
  }
  console.log('\n  Subcategory breakdown:')
  Object.entries(subCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([sub, count]) => console.log(`    ${count.toString().padStart(4)} ${sub}`))

  // Vegan/vegetarian summary
  const veganCount = allProducts.filter(p => p.is_vegan).length
  const vegCount = allProducts.filter(p => p.is_vegetarian).length
  console.log(`\n  Vegan: ${veganCount}/${allProducts.length}  Vegetarian: ${vegCount}/${allProducts.length}`)

  // Phase 2: Supabase upsert
  if (!opts.jsonOnly) {
    console.log('\n── Phase 2: Supabase Upsert ───────────────────────────')

    if (opts.dryRun) {
      console.log('  [DRY RUN] Would upsert', allProducts.length, 'products with source:', source)
    } else {
      const supabase = connectSupabase()
      if (!supabase) {
        console.error('  ✗ Could not connect to Supabase. Skipping upsert.')
      } else {
        console.log(`  Upserting ${allProducts.length} products (source: ${source})...`)
        const result = await upsertToSupabase(supabase, allProducts, source)
        console.log(`  ✓ Upserted: ${result.inserted}  Errors: ${result.errors}`)

        // Show total count in table
        const { count } = await supabase
          .from('products')
          .select('*', { count: 'exact', head: true })
        console.log(`  Total products in DB: ${count}`)

        // Show plant-based count
        const { count: pbCount } = await supabase
          .from('products')
          .select('*', { count: 'exact', head: true })
          .eq('source', source)
        console.log(`  Products with source '${source}': ${pbCount}`)
      }
    }
  }

  console.log('\n── Done! ──────────────────────────────────────────────\n')
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
