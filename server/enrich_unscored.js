#!/usr/bin/env node
/**
 * enrich_unscored.js
 * 
 * Diagnostic tool: shows how many food products in the database lack a CO₂ score
 * from name/ingredient matching, and how many can be rescued via AH store category
 * inference (which now happens at runtime in evaluateProduct() via co2Emissions.js).
 *
 * Usage:
 *   node server/enrich_unscored.js              # report
 *   node server/enrich_unscored.js --json       # output JSON for piping
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  getCO2Emissions,
  isNonFood,
  co2ToScore,
  CO2_EMISSIONS_DATA,
  inferCO2FromAHCategories
} from './co2Emissions.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env') })

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// ============================================================================
// MAIN — diagnostic tool showing scoring coverage
// ============================================================================
async function main() {
  const args = process.argv.slice(2)
  const jsonMode = args.includes('--json')
  const log = jsonMode ? () => {} : (...a) => console.log(...a)

  log('🔍 Querying products from database...')

  // Fetch all products in batches (Supabase maxes at 1000 per query)
  let allProducts = []
  let offset = 0
  const batchSize = 1000
  while (true) {
    const { data, error } = await supabase
      .from('products')
      .select('id, name, normalized_name, categories, ingredients, nutrition_text, nutrition_json, url, image_url, source')
      .range(offset, offset + batchSize - 1)
    if (error) { console.error('DB error:', error); process.exit(1) }
    if (!data || data.length === 0) break
    allProducts = allProducts.concat(data)
    if (data.length < batchSize) break
    offset += batchSize
  }

  log(`📦 Total products: ${allProducts.length}`)
  log(`🔄 Starting classification...`)

  // Classify each product
  const unscored = []     // food items with no CO₂ match at all
  const scored = []       // items that got a score from name/ingredients
  const nonFood = []      // items flagged as non-food
  const fixable = []      // unscored items where AH category gives us a match

  for (let i = 0; i < allProducts.length; i++) {
    const product = allProducts[i]
    if (i > 0 && i % 2000 === 0) log(`   ... processed ${i}/${allProducts.length}`)
    
    const co2 = getCO2Emissions(
      product.name,
      product.ingredients || null,
      product.nutrition_text || null,
      product.nutrition_json || null
    )

    if (co2.isNonFood) {
      nonFood.push(product)
      continue
    }

    if (co2.matched) {
      scored.push({ ...product, co2Category: co2.category, co2PerKg: co2.co2PerKg })
      continue
    }

    // Unscored food item — check if AH category inference would rescue it
    const inferred = inferCO2FromAHCategories(product.categories)
    if (inferred) {
      fixable.push({
        id: product.id,
        name: product.name,
        categories: product.categories,
        inferredCategory: inferred,
        co2PerKg: CO2_EMISSIONS_DATA[inferred] || null
      })
    } else {
      unscored.push({
        id: product.id,
        name: product.name,
        categories: product.categories,
        source: product.source
      })
    }
  }

  // Group unscored by their AH main category for analysis
  const unscoredByCategory = {}
  for (const p of unscored) {
    const mainCat = (p.categories || []).find(c => c.startsWith('ah:')) || '(no category)'
    if (!unscoredByCategory[mainCat]) unscoredByCategory[mainCat] = []
    unscoredByCategory[mainCat].push(p.name)
  }

  if (jsonMode) {
    console.log(JSON.stringify({
      total: allProducts.length,
      scored: scored.length,
      nonFood: nonFood.length,
      unscored: unscored.length,
      fixable: fixable.length,
      fixableItems: fixable.map(f => ({ name: f.name, inferredCategory: f.inferredCategory, co2PerKg: f.co2PerKg })),
      unscoredItems: unscored.map(u => ({ name: u.name, categories: u.categories })),
      unscoredByCategory
    }, null, 2))
    process.exit(0)
  }

  log('\n📊 SUMMARY:')
  log(`   ✅ Scored (name/ingredients):  ${scored.length}`)
  log(`   🚫 Non-food:                   ${nonFood.length}`)
  log(`   🔧 Rescued via AH categories:  ${fixable.length}`)
  log(`   ❌ Still unscored:              ${unscored.length}`)
  log(`   📈 Total coverage: ${((scored.length + fixable.length) / (allProducts.length - nonFood.length) * 100).toFixed(1)}% of food items`)

  if (fixable.length > 0) {
    log('\n🔧 RESCUED ITEMS (AH category → CO₂ category):')
    const grouped = {}
    for (const f of fixable) {
      if (!grouped[f.inferredCategory]) grouped[f.inferredCategory] = []
      grouped[f.inferredCategory].push(f.name)
    }
    for (const [cat, names] of Object.entries(grouped).sort((a, b) => b[1].length - a[1].length)) {
      const co2 = CO2_EMISSIONS_DATA[cat]
      const score = co2ToScore(co2)
      log(`\n   ${cat} (${co2} kg CO₂/kg → score ${score}):`)
      for (const n of names.slice(0, 10)) {
        log(`     • ${n}`)
      }
      if (names.length > 10) log(`     ... and ${names.length - 10} more`)
    }
  }

  if (unscored.length > 0) {
    log('\n❌ STILL UNSCORED (no name match, no AH category match):')
    for (const [cat, names] of Object.entries(unscoredByCategory).sort((a, b) => b.length - a.length)) {
      log(`\n   ${cat} (${names.length} items):`)
      for (const n of names.slice(0, 8)) {
        log(`     • ${n}`)
      }
      if (names.length > 8) log(`     ... and ${names.length - 8} more`)
    }
  }

  log('\n✅ Note: AH category inference runs automatically at scoring time.')
  log('   No database changes needed — the mapping is in co2Emissions.js.')
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
