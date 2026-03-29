#!/usr/bin/env node
/**
 * USDA FoodData Central – Ingredient Profile Lookup Tool
 * 
 * Interactive CLI script to search for ingredients in the USDA FoodData Central
 * database and generate profile entries ready to paste into usda_ingredient_profiles.js
 * 
 * Usage:
 *   node server/usda_lookup.js                     # interactive mode
 *   node server/usda_lookup.js "chicken breast"     # quick search
 *   node server/usda_lookup.js --batch ingredients.txt  # batch mode (one per line)
 * 
 * Requires: USDA_API_KEY in .env (get free key at https://api.data.gov/signup/)
 * Rate limit: 1,000 requests/hour
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { createInterface } from 'readline'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// ---------------------------------------------------------------------------
// Load .env
// ---------------------------------------------------------------------------
function loadEnv() {
  const envPath = join(__dirname, '..', '.env')
  if (!existsSync(envPath)) {
    console.error('❌  .env file not found. Copy .env.example → .env and add your USDA_API_KEY.')
    process.exit(1)
  }
  const lines = readFileSync(envPath, 'utf-8').split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    const val = trimmed.slice(eqIdx + 1).trim()
    if (!process.env[key]) process.env[key] = val
  }
}

loadEnv()

const API_KEY = process.env.USDA_API_KEY
if (!API_KEY || API_KEY === 'your-usda-api-key-here') {
  console.error('❌  USDA_API_KEY not set. Add it to .env (get one at https://api.data.gov/signup/).')
  process.exit(1)
}

const BASE_URL = 'https://api.nal.usda.gov/fdc/v1'

// Preferred data types, in priority order
const PREFERRED_TYPES = ['Foundation', 'SR Legacy', 'Survey (FNDDS)']

// Nutrient ID → our field name
// Multiple IDs can map to the same field (Foundation uses different IDs)
const NUTRIENT_MAP = {
  1003: 'protein',
  1004: 'fat',
  1005: 'carbs',
  1008: 'energy_kcal',
  2047: 'energy_kcal',    // Energy (Atwater General Factors) – Foundation data
  2048: '_energy_specific', // Energy (Atwater Specific Factors) – fallback
  1258: 'saturated_fat',
  1292: 'mono_fat',
  1293: 'poly_fat',
  2000: 'sugars',
  1063: 'sugars',          // Sugars, Total NLEA – alternate ID
  1079: 'fiber',
  1093: 'sodium_mg',
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------
async function searchFoods(query, pageSize = 15) {
  const res = await fetch(`${BASE_URL}/foods/search?api_key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      pageSize,
      dataType: ['Foundation', 'SR Legacy', 'Survey (FNDDS)'],
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`USDA search failed (${res.status}): ${text}`)
  }
  return res.json()
}

async function getFoodDetail(fdcId) {
  const params = new URLSearchParams({ api_key: API_KEY })
  const res = await fetch(`${BASE_URL}/food/${fdcId}?${params}`)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`USDA detail failed (${res.status}): ${text}`)
  }
  return res.json()
}

// ---------------------------------------------------------------------------
// Extract nutrients from USDA food detail response
// ---------------------------------------------------------------------------
function extractNutrients(detail) {
  const profile = {
    fdcId: detail.fdcId,
    description: detail.description,
    protein: 0, fat: 0, saturated_fat: 0, mono_fat: 0, poly_fat: 0,
    carbs: 0, sugars: 0, fiber: 0, sodium_mg: 0, energy_kcal: 0,
    _energy_specific: 0,
  }

  // foodNutrients can have different shapes depending on data type
  const nutrients = detail.foodNutrients || []

  for (const n of nutrients) {
    // Search result shape: { nutrientId, nutrientName, value }
    // Detail shape: { nutrient: { id, name, ... }, amount }
    const id = n.nutrientId ?? n.nutrient?.id
    const value = n.value ?? n.amount ?? 0
    const field = NUTRIENT_MAP[id]
    if (field) {
      // Only overwrite if current value is 0 (avoids clobbering better data)
      if (!profile[field]) {
        profile[field] = Math.round(value * 100) / 100
      }
    }
  }

  // Use Atwater Specific energy as fallback if General/standard is missing
  if (!profile.energy_kcal && profile._energy_specific) {
    profile.energy_kcal = profile._energy_specific
  }
  delete profile._energy_specific

  return profile
}

// ---------------------------------------------------------------------------
// Format profile as JS code for usda_ingredient_profiles.js
// ---------------------------------------------------------------------------
function formatProfileCode(key, profile, dutchNames = []) {
  const dn = dutchNames.length
    ? `[${dutchNames.map(n => `'${n}'`).join(', ')}]`
    : `['TODO']`

  return `  '${key}': {
    fdcId: ${profile.fdcId},
    description: '${profile.description.replace(/'/g, "\\'")}',
    dutchNames: ${dn},
    protein: ${profile.protein}, fat: ${profile.fat}, saturated_fat: ${profile.saturated_fat}, mono_fat: ${profile.mono_fat}, poly_fat: ${profile.poly_fat},
    carbs: ${profile.carbs}, sugars: ${profile.sugars}, fiber: ${profile.fiber}, sodium_mg: ${profile.sodium_mg}, energy_kcal: ${profile.energy_kcal},
  },`
}

// ---------------------------------------------------------------------------
// Display search results
// ---------------------------------------------------------------------------
function displayResults(foods) {
  if (!foods || foods.length === 0) {
    console.log('  No results found.')
    return []
  }
  const sorted = [...foods].sort((a, b) => {
    const aIdx = PREFERRED_TYPES.indexOf(a.dataType)
    const bIdx = PREFERRED_TYPES.indexOf(b.dataType)
    return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx)
  })
  console.log()
  for (let i = 0; i < sorted.length; i++) {
    const f = sorted[i]
    const type = (f.dataType || 'Unknown').padEnd(18)
    console.log(`  [${String(i + 1).padStart(2)}]  ${type}  FDC#${f.fdcId}  ${f.description}`)
  }
  console.log()
  return sorted
}

// ---------------------------------------------------------------------------
// Display nutrient detail nicely
// ---------------------------------------------------------------------------
function displayProfile(profile) {
  console.log()
  console.log(`  ┌─ ${profile.description} (FDC#${profile.fdcId})`)
  console.log(`  │`)
  console.log(`  │  Energy:      ${profile.energy_kcal} kcal`)
  console.log(`  │  Protein:     ${profile.protein} g`)
  console.log(`  │  Fat:         ${profile.fat} g`)
  console.log(`  │    Saturated:  ${profile.saturated_fat} g`)
  console.log(`  │    Mono:       ${profile.mono_fat} g`)
  console.log(`  │    Poly:       ${profile.poly_fat} g`)
  console.log(`  │  Carbs:       ${profile.carbs} g`)
  console.log(`  │    Sugars:     ${profile.sugars} g`)
  console.log(`  │    Fiber:      ${profile.fiber} g`)
  console.log(`  │  Sodium:      ${profile.sodium_mg} mg`)
  console.log(`  └─`)
  console.log()
}

// ---------------------------------------------------------------------------
// Readline helper
// ---------------------------------------------------------------------------
function createRL() {
  return createInterface({ input: process.stdin, output: process.stdout })
}

function ask(rl, prompt) {
  return new Promise(resolve => rl.question(prompt, answer => resolve(answer.trim())))
}

// ---------------------------------------------------------------------------
// Interactive mode
// ---------------------------------------------------------------------------
async function interactiveMode() {
  const rl = createRL()
  const collected = []

  console.log()
  console.log('╔══════════════════════════════════════════════════════════════╗')
  console.log('║   USDA FoodData Central – Ingredient Profile Lookup        ║')
  console.log('║   Type a food name to search  •  "quit" to exit            ║')
  console.log('╚══════════════════════════════════════════════════════════════╝')
  console.log()

  while (true) {
    const query = await ask(rl, '🔍 Search: ')
    if (!query || query.toLowerCase() === 'quit' || query.toLowerCase() === 'exit') break

    try {
      console.log(`  Searching "${query}"...`)
      const data = await searchFoods(query)
      const sorted = displayResults(data.foods)
      if (sorted.length === 0) continue

      const choice = await ask(rl, '  Select number (or Enter to skip): ')
      if (!choice) continue

      const idx = parseInt(choice, 10) - 1
      if (isNaN(idx) || idx < 0 || idx >= sorted.length) {
        console.log('  Invalid selection.')
        continue
      }

      const selected = sorted[idx]
      console.log(`  Fetching detail for FDC#${selected.fdcId}...`)

      const detail = await getFoodDetail(selected.fdcId)
      const profile = extractNutrients(detail)
      displayProfile(profile)

      // Ask for key name and Dutch names
      const key = await ask(rl, `  Profile key (e.g. "chicken_breast"): `)
      if (!key) continue

      const dutchStr = await ask(rl, `  Dutch names (comma-separated, e.g. "kipfilet, kip"): `)
      const dutchNames = dutchStr ? dutchStr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : []

      const code = formatProfileCode(key, profile, dutchNames)
      console.log()
      console.log('  ── Generated code ──────────────────────────────────')
      console.log(code)
      console.log('  ────────────────────────────────────────────────────')
      console.log()

      collected.push({ key, profile, dutchNames, code })
    } catch (err) {
      console.error(`  ❌ Error: ${err.message}`)
    }
  }

  if (collected.length > 0) {
    console.log()
    console.log('═══════════════════════════════════════════════════════════')
    console.log('  All generated profiles:')
    console.log('═══════════════════════════════════════════════════════════')
    console.log()
    for (const c of collected) {
      console.log(c.code)
    }
    console.log()

    const save = await ask(rl, '  Save to usda_new_profiles.json? (y/n): ')
    if (save.toLowerCase() === 'y') {
      const outPath = join(__dirname, 'usda_new_profiles.json')
      const out = {}
      for (const c of collected) {
        out[c.key] = { ...c.profile, dutchNames: c.dutchNames }
      }
      writeFileSync(outPath, JSON.stringify(out, null, 2))
      console.log(`  ✅ Saved to ${outPath}`)
    }
  }

  rl.close()
  console.log('  Bye!')
}

// ---------------------------------------------------------------------------
// Quick search mode  (node usda_lookup.js "chicken breast")
// ---------------------------------------------------------------------------
async function quickSearch(query) {
  console.log(`\n  Searching USDA for "${query}"...\n`)
  const data = await searchFoods(query, 10)

  if (!data.foods || data.foods.length === 0) {
    console.log('  No results found.')
    return
  }

  // Pick the first Foundation or SR Legacy result
  const best = data.foods.find(f => PREFERRED_TYPES.includes(f.dataType)) || data.foods[0]
  console.log(`  Best match: ${best.description} (${best.dataType}, FDC#${best.fdcId})`)

  const detail = await getFoodDetail(best.fdcId)
  const profile = extractNutrients(detail)
  displayProfile(profile)

  // Generate profile key from description
  const key = best.description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 30)

  const code = formatProfileCode(key, profile)
  console.log('  ── Generated code (add dutchNames manually) ──')
  console.log(code)
  console.log()
}

// ---------------------------------------------------------------------------
// Batch mode  (node usda_lookup.js --batch ingredients.txt)
// ---------------------------------------------------------------------------
async function batchMode(filePath) {
  if (!existsSync(filePath)) {
    console.error(`  ❌ File not found: ${filePath}`)
    process.exit(1)
  }

  const lines = readFileSync(filePath, 'utf-8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'))

  console.log(`\n  Processing ${lines.length} ingredients from ${filePath}...\n`)

  const results = {}
  let delay = 0

  for (const line of lines) {
    // Each line: "key:search query:dutch1,dutch2"  or just "search query"
    const parts = line.split(':')
    let key, query, dutchNames = []

    if (parts.length >= 2) {
      key = parts[0].trim()
      query = parts[1].trim()
      dutchNames = parts[2] ? parts[2].split(',').map(s => s.trim().toLowerCase()) : []
    } else {
      query = parts[0].trim()
      key = query.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
    }

    // Rate limiting: ~1 req/4s = 900/hour (safe margin)
    if (delay > 0) await new Promise(r => setTimeout(r, delay))
    delay = 4000

    try {
      process.stdout.write(`  ${key.padEnd(25)} `)
      const data = await searchFoods(query, 5)
      if (!data.foods || data.foods.length === 0) {
        console.log('❌ No results')
        continue
      }

      const best = data.foods.find(f => PREFERRED_TYPES.includes(f.dataType)) || data.foods[0]

      // Small extra delay before detail request
      await new Promise(r => setTimeout(r, 1000))

      const detail = await getFoodDetail(best.fdcId)
      const profile = extractNutrients(detail)
      profile.dutchNames = dutchNames
      results[key] = profile

      console.log(`✅ ${best.description} (${profile.energy_kcal} kcal, ${profile.protein}g prot, ${profile.fat}g fat)`)
    } catch (err) {
      console.log(`❌ ${err.message}`)
    }
  }

  // Output
  console.log('\n  ───────────────────────────────────────────────')
  console.log('  Generated entries:\n')

  for (const [key, profile] of Object.entries(results)) {
    console.log(formatProfileCode(key, profile, profile.dutchNames))
  }

  // Save to JSON
  const outPath = join(__dirname, 'usda_new_profiles.json')
  writeFileSync(outPath, JSON.stringify(results, null, 2))
  console.log(`\n  ✅ Saved ${Object.keys(results).length} profiles to ${outPath}`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const args = process.argv.slice(2)

if (args[0] === '--batch' && args[1]) {
  batchMode(args[1]).catch(e => { console.error(e); process.exit(1) })
} else if (args.length > 0 && args[0] !== '--help') {
  quickSearch(args.join(' ')).catch(e => { console.error(e); process.exit(1) })
} else if (args[0] === '--help') {
  console.log(`
  USDA FoodData Central – Ingredient Profile Lookup

  Usage:
    node server/usda_lookup.js                          Interactive mode
    node server/usda_lookup.js "chicken breast"          Quick search
    node server/usda_lookup.js --batch ingredients.txt   Batch mode

  Batch file format (one per line):
    key:search query:dutch_name1,dutch_name2
    or just: search query

  Example batch file:
    chicken_breast:chicken breast raw:kipfilet,kippenborst,kip
    salmon:salmon atlantic raw:zalm
    rice_white:rice white long grain raw:rijst,basmati

  Environment:
    USDA_API_KEY must be set in .env (get key at https://api.data.gov/signup/)
`)
} else {
  interactiveMode().catch(e => { console.error(e); process.exit(1) })
}
