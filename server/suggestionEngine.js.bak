/**
 * Category-aware product suggestion engine.
 *
 * For each CO₂ category we define "swap" categories — lower-emission
 * alternatives that serve a similar culinary purpose.  When a user views
 * a product, we can suggest real AH products from the swap categories
 * that are both relevant and genuinely better for the climate.
 *
 * Architecture:
 *   1) CATEGORY_SWAPS defines per-category swap targets + Dutch keywords + tips
 *   2) findSmartAlternatives() queries the Supabase product catalog by keyword,
 *      evaluates each candidate's CO₂ category, and keeps only swap-category
 *      matches that genuinely improve the score.
 *   3) getSmartSuggestions() returns text tips for the product detail page.
 *
 * The keyword lists are designed to match real Albert Heijn product names
 * stored in the `normalized_name` column (lowercase, no diacritics).
 */

import { PRODUCT_CATEGORY_KEYWORDS } from './co2Emissions.js'

// ──────────────────────────────────────────────────────────────────
// 0. Auto-keyword builder
//    For each swap target category, pull the comprehensive keyword list
//    from PRODUCT_CATEGORY_KEYWORDS so we don't have to maintain two
//    sources.  Extra hand-picked keywords are merged on top.
// ──────────────────────────────────────────────────────────────────

/**
 * Build a search keyword list for one or more CO₂ categories by pulling
 * from the master PRODUCT_CATEGORY_KEYWORDS map.
 * @param {string[]} categories - target CO₂ categories
 * @param {string[]} extraKeywords - additional hand-picked search terms
 * @returns {string[]} deduplicated keyword list suitable for ilike queries
 */
function buildSwapKeywords(categories, extraKeywords = []) {
  const kws = new Set(extraKeywords.map(k => k.toLowerCase()))
  for (const cat of categories) {
    const words = PRODUCT_CATEGORY_KEYWORDS[cat]
    if (words) {
      for (const w of words) {
        // Skip very short words (< 3 chars) — they create too many false positives
        if (w.length >= 3) kws.add(w.toLowerCase())
      }
    }
  }
  return [...kws]
}

// ──────────────────────────────────────────────────────────────────
// 1. Category swap map
//    key   = source CO₂ category (the product the user is looking at)
//    value = {
//      swaps:    [target categories] — lower-CO₂ categories for replacement
//      keywords: [search terms]      — auto-built + hand-curated extras
//      tip:      { nl, en }          — contextual sustainability tip
//    }
// ──────────────────────────────────────────────────────────────────

export const CATEGORY_SWAPS = {
  // ── Meat → plant-based / lower-emission protein ──────────────
  beef_herd: {
    swaps: ['tofu', 'other_pulses', 'peas', 'poultry_meat'],
    keywords: buildSwapKeywords(
      ['tofu', 'other_pulses', 'peas', 'poultry_meat'],
      ['plantaardig', 'vegan', 'vegetarisch', 'bonen burger', 'groente burger', 'vegaburger', 'mc2']
    ),
    tip: { nl: 'Rundvlees heeft de hoogste CO₂-uitstoot. Plantaardige alternatieven besparen tot 95%.', en: 'Beef has the highest CO₂ footprint. Plant-based alternatives can save up to 95%.' }
  },
  beef_dairy: {
    swaps: ['tofu', 'other_pulses', 'peas', 'poultry_meat'],
    keywords: buildSwapKeywords(
      ['tofu', 'other_pulses', 'peas', 'poultry_meat'],
      ['plantaardig', 'vegan', 'bonen burger', 'groente burger']
    ),
    tip: { nl: 'Rundvlees heeft de hoogste CO₂-uitstoot. Plantaardige alternatieven besparen tot 90%.', en: 'Beef has the highest CO₂ footprint. Plant-based alternatives can save up to 90%.' }
  },
  lamb_mutton: {
    swaps: ['tofu', 'other_pulses', 'peas', 'poultry_meat', 'pig_meat'],
    keywords: buildSwapKeywords(
      ['tofu', 'other_pulses', 'peas', 'poultry_meat', 'pig_meat'],
      ['plantaardig', 'vegan', 'vegetarisch']
    ),
    tip: { nl: 'Lam is qua CO₂ vergelijkbaar met rundvlees. Overweeg gevogelte of plantaardig.', en: 'Lamb has a similar CO₂ footprint to beef. Consider poultry or plant-based.' }
  },
  pig_meat: {
    swaps: ['tofu', 'other_pulses', 'poultry_meat', 'peas'],
    keywords: buildSwapKeywords(
      ['tofu', 'other_pulses', 'poultry_meat', 'peas'],
      ['plantaardig', 'vegan', 'vegetarisch worst', 'vegetarisch gehakt', 'vegaworst', 'vegagehakt']
    ),
    tip: { nl: 'Varkensvlees heeft een gemiddelde uitstoot. Kip of plantaardig bespaart 50-80%.', en: 'Pork has moderate emissions. Chicken or plant-based saves 50-80%.' }
  },
  poultry_meat: {
    swaps: ['tofu', 'other_pulses', 'peas', 'eggs'],
    keywords: buildSwapKeywords(
      ['tofu', 'other_pulses', 'peas'],
      ['plantaardig kip', 'vegan kip', 'vegetarische schnitzel', 'kipstuckjes vegan', 'vegetarische nuggets']
    ),
    tip: { nl: 'Kip scoort al goed voor vlees. Plantaardige varianten besparen nog 60-80%.', en: 'Chicken already scores well for meat. Plant-based options save another 60-80%.' }
  },

  // ── Seafood → lower-emission protein ─────────────────────────
  shrimps_farmed: {
    swaps: ['fish_farmed', 'tofu', 'other_pulses', 'peas'],
    keywords: buildSwapKeywords(
      ['tofu', 'other_pulses', 'fish_farmed'],
      ['visstick', 'plantaardige vis', 'vegan vis', 'visvervanger']
    ),
    tip: { nl: 'Garnalen hebben een hoge uitstoot. Vis of plantaardig is beter.', en: 'Shrimp has high emissions. Fish or plant-based is better.' }
  },
  fish_farmed: {
    swaps: ['tofu', 'other_pulses', 'peas', 'eggs'],
    keywords: buildSwapKeywords(
      ['tofu', 'other_pulses', 'peas'],
      ['plantaardige vis', 'visvervanger', 'vegan vis', 'vegan tonijn']
    ),
    tip: { nl: 'Vis heeft een gemiddelde uitstoot. Peulvruchten of tofu besparen 50%.', en: 'Fish has moderate emissions. Legumes or tofu save 50%.' }
  },

  // ── Dairy → plant-based dairy ────────────────────────────────
  cheese: {
    swaps: ['nuts', 'tofu', 'soy_milk'],
    keywords: buildSwapKeywords(
      ['nuts', 'tofu'],
      ['vegan kaas', 'plantaardige kaas', 'notenpasta', 'cashewkaas', 'plantaardig beleg']
    ),
    tip: { nl: 'Kaas heeft een verrassend hoge CO₂-uitstoot door de zuivelketen. Plantaardige kaas bespaart tot 80%.', en: 'Cheese has a surprisingly high CO₂ footprint. Plant-based cheese saves up to 80%.' }
  },
  milk: {
    swaps: ['soy_milk', 'oatmeal'],
    keywords: buildSwapKeywords(
      ['soy_milk', 'oatmeal'],
      ['havermelk', 'sojamelk', 'amandelmelk', 'plantaardige melk', 'haver drink', 'kokomelk', 'rijstmelk', 'plantaardig yoghurt', 'vegan yoghurt', 'alpro', 'oatly']
    ),
    tip: { nl: 'Zuivel heeft ~3× meer CO₂ dan havermelk. Plantaardige melk bespaart tot 70%.', en: 'Dairy has ~3× more CO₂ than oat milk. Plant-based milk saves up to 70%.' }
  },
  eggs: {
    swaps: ['tofu', 'other_pulses', 'peas'],
    keywords: buildSwapKeywords(
      ['tofu', 'other_pulses', 'peas'],
      ['tofu scramble', 'plantaardig ei', 'vegan ei']
    ),
    tip: { nl: 'Eieren scoren gemiddeld. Tofu en peulvruchten zijn een goed alternatief voor eiwitbronnen.', en: 'Eggs score average. Tofu and legumes are good protein alternatives.' }
  },

  // ── Oils → lower-emission oils ───────────────────────────────
  olive_oil: {
    swaps: ['rapeseed_oil', 'sunflower_oil'],
    keywords: buildSwapKeywords(
      ['rapeseed_oil', 'sunflower_oil'],
      ['zonnebloemolie', 'raapzaadolie', 'koolzaadolie']
    ),
    tip: { nl: 'Olijfolie scoort goed maar raapzaadolie heeft nog minder uitstoot.', en: 'Olive oil scores well but rapeseed oil has even lower emissions.' }
  },
  palm_oil: {
    swaps: ['rapeseed_oil', 'sunflower_oil'],
    keywords: buildSwapKeywords(
      ['rapeseed_oil', 'sunflower_oil'],
      ['zonnebloemolie', 'raapzaadolie']
    ),
    tip: { nl: 'Palmolie is gelinkt aan ontbossing. Kies voor Europese oliën.', en: 'Palm oil is linked to deforestation. Choose European oils.' }
  },
  soybean_oil: {
    swaps: ['rapeseed_oil', 'sunflower_oil'],
    keywords: buildSwapKeywords(
      ['rapeseed_oil', 'sunflower_oil'],
      ['zonnebloemolie', 'raapzaadolie']
    ),
    tip: { nl: 'Sojaolie heeft een relatief hoge uitstoot. Europese oliën zijn beter.', en: 'Soybean oil has relatively high emissions. European oils are better.' }
  },

  // ── Grains → already low, but rice is the outlier ────────────
  rice: {
    swaps: ['potatoes', 'wheat_rye', 'oatmeal', 'maize'],
    keywords: buildSwapKeywords(
      ['potatoes', 'wheat_rye', 'oatmeal', 'maize'],
      ['pasta', 'couscous', 'aardappel', 'bulgur', 'quinoa', 'orzo']
    ),
    tip: { nl: 'Rijst heeft hoge methaanuitstoot door natte teelt. Pasta, aardappelen of couscous zijn 70% lager.', en: 'Rice has high methane emissions from wet cultivation. Pasta, potatoes, or couscous are 70% lower.' }
  },

  // ── Beverages ────────────────────────────────────────────────
  coffee: {
    swaps: ['tea'],
    keywords: buildSwapKeywords(
      ['tea'],
      ['thee', 'kruidenthee', 'groene thee', 'rooibos', 'munt thee', 'earl grey', 'kamille']
    ),
    tip: { nl: 'Koffie heeft een aanzienlijke uitstoot (28 kg CO₂/kg). Thee is 5-10× lager.', en: 'Coffee has significant emissions (28 kg CO₂/kg). Tea is 5-10× lower.' }
  },
  dark_chocolate: {
    swaps: ['nuts', 'other_fruit', 'baked_goods', 'candy_sweets'],
    keywords: buildSwapKeywords(
      ['nuts', 'other_fruit'],
      ['noten', 'fruit', 'notenmix', 'studentenhaver', 'gedroogd fruit', 'dadels', 'vijgen', 'trail mix']
    ),
    tip: { nl: 'Cacao heeft de op één na hoogste CO₂-uitstoot (47 kg/kg) door ontbossing. Noten en fruit zijn betere snacks.', en: 'Cocoa has the second-highest CO₂ footprint (47 kg/kg) from deforestation. Nuts and fruit are better snacks.' }
  },
  spirits: {
    swaps: ['beer', 'wine'],
    keywords: buildSwapKeywords(
      ['beer', 'wine'],
      ['bier', 'wijn', 'radler']
    ),
    tip: { nl: 'Sterke drank heeft ~2× meer CO₂ dan bier of wijn.', en: 'Spirits have ~2× more CO₂ than beer or wine.' }
  },

  // ── Processed foods ─────────────────────────────────────────
  ready_meals: {
    swaps: ['other_vegetables', 'potatoes', 'wheat_rye', 'tofu', 'soup'],
    keywords: buildSwapKeywords(
      ['other_vegetables', 'potatoes', 'wheat_rye', 'tofu', 'soup'],
      ['groente', 'verse groente', 'roerbakgroente', 'maaltijdsalade', 'salade', 'verse soep']
    ),
    tip: { nl: 'Kant-en-klaarmaaltijden bevatten vaak vlees en zuivel. Verse groenten of soep bespaart CO₂.', en: 'Ready meals often contain meat and dairy. Fresh vegetables or soup saves CO₂.' }
  },
  ice_cream: {
    swaps: ['other_fruit', 'soy_milk', 'berries_grapes'],
    keywords: buildSwapKeywords(
      ['other_fruit', 'soy_milk', 'berries_grapes'],
      ['sorbet', 'vegan ijs', 'plantaardig ijs', 'fruit ijs', 'ijslolly', 'waterijs', 'alpro ijs']
    ),
    tip: { nl: 'Roomijs bevat zuivel (hoge CO₂). Sorbet of plantaardig ijs bespaart tot 60%.', en: 'Dairy ice cream has high CO₂. Sorbet or plant-based ice cream saves up to 60%.' }
  },
  desserts: {
    swaps: ['other_fruit', 'soy_milk', 'berries_grapes'],
    keywords: buildSwapKeywords(
      ['other_fruit', 'soy_milk'],
      ['fruit', 'plantaardig toetje', 'vegan dessert', 'alpro dessert', 'sojatoetje', 'plantaardige yoghurt']
    ),
    tip: { nl: 'Zuiveldesserts hebben een hoge uitstoot. Plantaardige of fruitdesserts zijn beter.', en: 'Dairy desserts have high emissions. Plant-based or fruit desserts are better.' }
  },
  spreads: {
    swaps: ['nuts', 'groundnuts', 'other_fruit'],
    keywords: buildSwapKeywords(
      ['nuts', 'groundnuts'],
      ['pindakaas', 'notenpasta', 'hummus', 'jam', 'honing']
    ),
    tip: { nl: 'Sommige smeersels (leverworst, smeerkaas) bevatten zuivel/vlees. Pindakaas of hummus zijn lagere CO₂ keuzes.', en: 'Some spreads (liver sausage, cheese spread) contain dairy/meat. Peanut butter or hummus are lower CO₂ choices.' }
  },
  snacks: {
    swaps: ['nuts', 'other_fruit', 'groundnuts'],
    keywords: buildSwapKeywords(
      ['nuts', 'groundnuts', 'other_fruit'],
      ['noten', 'notenmix', 'studentenhaver', 'gedroogd fruit', 'popcorn', 'rijstwafels']
    ),
    tip: { nl: 'Snacks met vlees of kaas hebben een hogere uitstoot. Noten en gedroogd fruit zijn betere keuzes.', en: 'Snacks with meat or cheese have higher emissions. Nuts and dried fruit are better choices.' }
  },

  // ── Sugar ────────────────────────────────────────────────────
  cane_sugar: {
    swaps: ['beet_sugar'],
    keywords: buildSwapKeywords(
      ['beet_sugar'],
      ['bietsuiker', 'kristalsuiker', 'suiker']
    ),
    tip: { nl: 'Rietsuiker wordt van ver geïmporteerd. Europese bietsuiker heeft minder transportuitstoot.', en: 'Cane sugar is imported from far away. European beet sugar has lower transport emissions.' }
  },

  // ── Groundnuts (peanuts) — relatively high for a plant food ──
  groundnuts: {
    swaps: ['other_pulses', 'peas', 'nuts'],
    keywords: buildSwapKeywords(
      ['other_pulses', 'peas', 'nuts'],
      ['hummus', 'kikkererwten', 'cashew', 'amandelen']
    ),
    tip: { nl: 'Pinda\'s zijn goed maar andere peulvruchten en noten hebben nog minder uitstoot.', en: 'Peanuts are good but other legumes and tree nuts have even lower emissions.' }
  },

  // ── Tofu / soy products — already low but can still improve ──
  tofu: {
    swaps: ['other_pulses', 'peas'],
    keywords: buildSwapKeywords(
      ['other_pulses', 'peas'],
      ['bonen', 'linzen', 'kikkererwten', 'falafel']
    ),
    tip: { nl: 'Tofu is al een goede keus! Bonen en linzen hebben nog iets minder uitstoot.', en: 'Tofu is already a great choice! Beans and lentils have slightly lower emissions.' }
  }
}

// Categories that are already very low-emission — no swap needed,
// just show positive feedback + "similar" in-category products.
// Threshold: roughly ≤ 2.0 kg CO₂/kg → score ≥ 8
export const LOW_EMISSION_CATEGORIES = new Set([
  // Vegetables
  'tomatoes', 'onions_leeks', 'root_vegetables', 'brassicas',
  'other_vegetables', 'potatoes',
  // Fruits
  'citrus_fruit', 'apples', 'bananas', 'berries_grapes', 'other_fruit',
  // Legumes & plant protein
  'peas', 'other_pulses',
  // Grains (except rice)
  'wheat_rye', 'oatmeal', 'maize', 'barley',
  // Low-emission misc
  'beet_sugar', 'tea', 'nuts', 'soy_milk',
  'soft_drinks', 'beer', 'wine',
  // Processed but inherently low
  'candy_sweets', 'baked_goods', 'soup',
  'sauces_condiments', 'cassava',
  // baby food — can't really swap
  'baby_food'
])

// Related categories (same general group, useful for "similar" alternatives)
export const RELATED_CATEGORIES = {
  // Meats
  beef_herd: ['beef_dairy', 'lamb_mutton'],
  beef_dairy: ['beef_herd', 'lamb_mutton'],
  lamb_mutton: ['beef_herd', 'beef_dairy'],
  pig_meat: ['poultry_meat'],
  poultry_meat: ['pig_meat', 'eggs'],
  // Dairy
  milk: ['cheese', 'eggs', 'soy_milk'],
  cheese: ['milk', 'eggs'],
  eggs: ['milk', 'cheese'],
  // Seafood
  fish_farmed: ['shrimps_farmed'],
  shrimps_farmed: ['fish_farmed'],
  // Vegetables
  tomatoes: ['other_vegetables', 'brassicas', 'root_vegetables'],
  potatoes: ['root_vegetables', 'other_vegetables'],
  brassicas: ['other_vegetables', 'root_vegetables'],
  other_vegetables: ['brassicas', 'tomatoes', 'root_vegetables'],
  root_vegetables: ['potatoes', 'other_vegetables'],
  onions_leeks: ['other_vegetables', 'root_vegetables'],
  // Fruits
  apples: ['other_fruit', 'citrus_fruit', 'berries_grapes', 'bananas'],
  bananas: ['apples', 'citrus_fruit', 'other_fruit'],
  citrus_fruit: ['apples', 'other_fruit', 'bananas'],
  berries_grapes: ['other_fruit', 'apples'],
  other_fruit: ['apples', 'berries_grapes', 'citrus_fruit', 'bananas'],
  // Grains
  rice: ['wheat_rye', 'potatoes', 'oatmeal', 'maize'],
  wheat_rye: ['rice', 'oatmeal', 'maize'],
  oatmeal: ['wheat_rye', 'maize', 'barley'],
  maize: ['wheat_rye', 'oatmeal'],
  barley: ['wheat_rye', 'oatmeal'],
  // Plant proteins
  tofu: ['other_pulses', 'peas', 'nuts'],
  other_pulses: ['peas', 'tofu', 'nuts'],
  peas: ['other_pulses', 'tofu'],
  nuts: ['groundnuts', 'other_pulses'],
  groundnuts: ['nuts', 'other_pulses'],
  // Oils
  olive_oil: ['rapeseed_oil', 'sunflower_oil'],
  sunflower_oil: ['rapeseed_oil', 'olive_oil'],
  rapeseed_oil: ['sunflower_oil', 'olive_oil'],
  soybean_oil: ['rapeseed_oil', 'sunflower_oil'],
  palm_oil: ['rapeseed_oil', 'sunflower_oil'],
  // Beverages
  coffee: ['tea'],
  tea: ['coffee'],
  wine: ['beer'],
  beer: ['wine'],
  spirits: ['beer', 'wine'],
  soy_milk: ['oatmeal', 'milk'],
  // Sweets
  dark_chocolate: ['candy_sweets', 'nuts', 'other_fruit'],
  candy_sweets: ['other_fruit', 'nuts'],
  baked_goods: ['other_fruit', 'nuts'],
  // Processed
  ready_meals: ['soup', 'other_vegetables'],
  soup: ['other_vegetables', 'ready_meals'],
  ice_cream: ['other_fruit', 'berries_grapes'],
  desserts: ['other_fruit', 'berries_grapes', 'soy_milk'],
  spreads: ['groundnuts', 'nuts'],
  snacks: ['nuts', 'groundnuts', 'other_fruit'],
  // Sugar
  cane_sugar: ['beet_sugar'],
  beet_sugar: ['cane_sugar']
}

/**
 * Find real product alternatives from the database.
 *
 * Strategy:
 *   1. Build a comprehensive keyword list from CATEGORY_SWAPS + PRODUCT_CATEGORY_KEYWORDS
 *   2. Query Supabase products by keyword (ilike on normalized_name)
 *   3. Evaluate each candidate's CO₂ category and score
 *   4. Keep only candidates whose evaluated category is in the swap list AND score > current
 *   5. Sort by: swap-category match → food-form relevance → CO₂ improvement → absolute score
 *   6. If swap matches are too few, allow high-improvement non-swap products as a fallback
 *
 * @param {Object} options
 * @param {Object} options.supabase - Supabase client
 * @param {string} options.productId - Current product ID (to exclude from results)
 * @param {string} options.productName - Current product name
 * @param {string} options.co2Category - CO₂ category of the current product
 * @param {number|null} options.currentScore - Current product's score (1-7, 1 = best)
 * @param {Function} options.evaluateProduct - evaluateProduct function reference
 * @param {Function} options.getEnrichedData - getEnrichedData function reference
 * @param {string} options.lang - Language ('nl' or 'en')
 * @param {number} options.maxResults - Max results to return (default 5)
 * @returns {Promise<Object>} - { alternatives: [...], tip: string|null }
 */
export async function findSmartAlternatives({
  supabase,
  productId,
  productName,
  co2Category,
  currentScore,
  evaluateProduct,
  getEnrichedData,
  lang = 'nl',
  maxResults = 5
}) {
  const result = { alternatives: [], tip: null }

  if (!supabase || currentScore == null) return result

  // 1. Get the swap info for this category
  const swapInfo = CATEGORY_SWAPS[co2Category]
  const isLowEmission = LOW_EMISSION_CATEGORIES.has(co2Category)

  // For already excellent products, return positive tip and in-category alternatives
  if (isLowEmission || currentScore <= 2) {
    result.tip = lang === 'nl'
      ? '🌿 Uitstekende keuze! Dit product heeft al een zeer lage CO₂-uitstoot.'
      : '🌿 Excellent choice! This product already has very low CO₂ emissions.'

    // Still try to find similar products in same category for variety
    const related = RELATED_CATEGORIES[co2Category] || []
    const relatedKws = buildSwapKeywords([co2Category, ...related])
    if (relatedKws.length > 0) {
      const sameCategoryAlts = await queryByKeywords(supabase, relatedKws.slice(0, 30), productId, 60)
      if (sameCategoryAlts.length > 0) {
        const scored = scoreAndSort(sameCategoryAlts, evaluateProduct, getEnrichedData, currentScore, false, [], productName)
        result.alternatives = scored.slice(0, maxResults)
      }
    }
    return result
  }

  // 2. Set the contextual tip
  if (swapInfo?.tip) {
    result.tip = swapInfo.tip[lang] || swapInfo.tip.nl
  } else {
    // Generic tip for categories without specific swap info
    result.tip = lang === 'nl'
      ? '🔄 Bekijk de alternatieven hieronder voor producten met minder CO₂-uitstoot.'
      : '🔄 Check the alternatives below for products with lower CO₂ emissions.'
  }

  // 3. Build candidate pool from multiple query strategies
  const swapCategories = swapInfo?.swaps || []
  let candidates = []

  // Strategy A: Search using the pre-built keywords from CATEGORY_SWAPS
  // These are automatically derived from PRODUCT_CATEGORY_KEYWORDS + extras
  const searchKeywords = swapInfo?.keywords || []
  if (searchKeywords.length > 0) {
    // Split into batches to avoid overly-long OR filters (Supabase limit)
    const batches = chunkArray(searchKeywords, 25)
    for (const batch of batches) {
      const batchResults = await queryByKeywords(supabase, batch, productId, 80)
      candidates.push(...batchResults)
    }
  }

  // Strategy B: If no swap info exists, build keywords from related categories
  if (!swapInfo) {
    const related = RELATED_CATEGORIES[co2Category] || []
    if (related.length > 0) {
      const relatedKws = buildSwapKeywords(related)
      if (relatedKws.length > 0) {
        const relatedResults = await queryByKeywords(supabase, relatedKws.slice(0, 25), productId, 60)
        candidates.push(...relatedResults)
      }
    }
  }

  // Strategy C: Name-based search — extract meaningful tokens from the source
  // product name and search for products with similar names (e.g. "gehakt" → "vegan gehakt")
  const nameKws = extractNameKeywords(productName)
  if (nameKws.length > 0) {
    const nameResults = await queryByKeywords(supabase, nameKws, productId, 40)
    candidates.push(...nameResults)
  }

  // Strategy D: If all above yielded very few, broaden to popular products
  if (candidates.length < maxResults * 3) {
    const popularCandidates = await queryPopularProducts(supabase, productId, 80)
    candidates.push(...popularCandidates)
  }

  // 4. Deduplicate by id
  const seen = new Set()
  candidates = candidates.filter(c => {
    if (seen.has(c.id)) return false
    seen.add(c.id)
    return true
  })

  // 5. Score all candidates, filter to better ones
  const scored = scoreAndSort(candidates, evaluateProduct, getEnrichedData, currentScore, true, swapCategories, productName)

  // 6. Build final list — prefer swap-category matches, then fill with high-improvement non-swap
  const swapMatches = scored.filter(c => c.isSwapCategory)
  const nonSwapBetter = scored.filter(c => !c.isSwapCategory && c.improvement >= 2)

  if (swapMatches.length >= maxResults) {
    result.alternatives = swapMatches.slice(0, maxResults)
  } else {
    // Fill remaining slots with non-swap products that are significantly better
    const remaining = maxResults - swapMatches.length
    result.alternatives = [
      ...swapMatches,
      ...nonSwapBetter.slice(0, remaining)
    ]
  }

  return result
}

/**
 * Generate text suggestions (improved version of getSuggestions).
 * Returns an array of tip strings based on the CO₂ category and score.
 */
export function getSmartSuggestions(productName, co2Category, score, lang = 'nl') {
  const tips = []

  if (score == null) return tips

  // For excellent products, congratulate
  if (score <= 2 || LOW_EMISSION_CATEGORIES.has(co2Category)) {
    tips.push(lang === 'nl'
      ? '✨ Geweldige keuze! Dit product heeft een zeer lage CO₂-uitstoot.'
      : '✨ Great choice! This product has very low CO₂ emissions.')
    return tips
  }

  // Get category-specific tip
  const swapInfo = CATEGORY_SWAPS[co2Category]
  if (swapInfo?.tip) {
    tips.push(swapInfo.tip[lang] || swapInfo.tip.nl)
  }

  // Generic tips based on score range (1 = best, 7 = worst)
  if (score >= 5) {
    tips.push(lang === 'nl'
      ? '🔄 Bekijk de alternatieven hieronder — er zijn producten die tot 90% minder CO₂ uitstoten.'
      : '🔄 Check the alternatives below — there are products with up to 90% less CO₂ emissions.')
  } else if (score >= 4) {
    tips.push(lang === 'nl'
      ? '🔄 Bekijk de alternatieven hieronder voor producten met een lagere CO₂-uitstoot.'
      : '🔄 Check the alternatives below for products with a lower CO₂ footprint.')
  } else if (score >= 3) {
    tips.push(lang === 'nl'
      ? '💡 Er zijn vergelijkbare producten met een betere score beschikbaar.'
      : '💡 Similar products with a better score are available.')
  }

  return tips
}

// ── Internal helpers ────────────────────────────────────────────

/** Standard product columns to select from Supabase */
const PRODUCT_COLUMNS = 'id, name, url, image_url, price, is_vegan, is_vegetarian, is_organic, is_fairtrade, nutri_score, ingredients, nutrition_text, nutrition_json, origin_country, brand, categories'

/**
 * Query products by keyword search on normalized_name.
 * Uses ilike with OR to match any of the given keywords.
 */
async function queryByKeywords(supabase, keywords, excludeId, limit) {
  if (!keywords || keywords.length === 0) return []

  // Build an OR filter using ilike for each keyword
  const orFilter = keywords.map(kw => {
    // Replace spaces with % for fuzzy multi-word matching
    const escaped = kw.replace(/\s+/g, '%')
    return `normalized_name.ilike.%${escaped}%`
  }).join(',')

  try {
    const { data } = await supabase
      .from('products')
      .select(PRODUCT_COLUMNS)
      .neq('id', excludeId || '')
      .or(orFilter)
      .order('seen_count', { ascending: false })
      .limit(limit)

    return data || []
  } catch (e) {
    // If OR filter is too long, try with fewer keywords
    if (keywords.length > 10) {
      return queryByKeywords(supabase, keywords.slice(0, 10), excludeId, limit)
    }
    return []
  }
}

/**
 * Get popular products as a fallback candidate pool.
 */
async function queryPopularProducts(supabase, excludeId, limit) {
  try {
    const { data } = await supabase
      .from('products')
      .select(PRODUCT_COLUMNS)
      .neq('id', excludeId || '')
      .order('seen_count', { ascending: false })
      .limit(limit)

    return data || []
  } catch {
    return []
  }
}

/**
 * Extract meaningful keywords from a product name for name-based search.
 * E.g. "AH Rundvlees gehakt" → ["gehakt", "plantaardig gehakt", "vegan gehakt"]
 * This helps find direct substitutes (e.g. meat → vegan version of the same form).
 */
function extractNameKeywords(productName) {
  if (!productName) return []
  const lower = productName.toLowerCase()
  const keywords = []

  // Check for food-form words — if the source has "gehakt", search for "vegan gehakt", etc.
  for (const form of FOOD_FORMS) {
    if (lower.includes(form)) {
      keywords.push(`plantaardig ${form}`)
      keywords.push(`vegan ${form}`)
      keywords.push(`vegetarisch ${form}`)
      // Also search just the form — will match any product with that form
      keywords.push(form)
    }
  }

  return keywords
}

/**
 * Split an array into chunks of given size.
 */
function chunkArray(arr, size) {
  const chunks = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}

// ── Name Relevance Scoring ──────────────────────────────────────

// Words to ignore when computing name relevance (common Dutch/brand filler)
const STOP_WORDS = new Set([
  // Determiners & prepositions
  'ah', 'de', 'het', 'een', 'en', 'van', 'met', 'voor', 'op', 'in', 'uit',
  'per', 'bij', 'tot', 'aan', 'als', 'dan', 'die', 'dat', 'ook', 'nog',
  // Package/quantity
  'bio', 'biologisch', 'huismerk', 'merk', 'stuks', 'stuk', 'gram', 'ml',
  'liter', 'kg', 'pack', 'mini', 'groot', 'klein', 'vers', 'vrij',
  // Brand names that add noise
  'terra', 'planted', 'garden', 'gourmet', 'albert', 'heijn', 'jumbo',
  'basic', 'premium', 'excellent', 'original', 'classic', 'naturel'
])

// Common Dutch food-form words that indicate culinary purpose.
// These allow us to match e.g. "rundergehakt" ↔ "vegan gehakt" (both "gehakt").
const FOOD_FORMS = [
  // Meat forms
  'gehakt', 'burger', 'worst', 'filet', 'schnitzel', 'steak', 'bal', 'balletjes',
  'stukjes', 'reepjes', 'plakjes', 'blokjes', 'sticks', 'nuggets', 'kroket',
  'shoarma', 'gyros', 'kebab', 'ragout', 'stoofvlees', 'braadstuk',
  'roerbakreepjes', 'fricandeau', 'medaillons', 'loempia',
  // Dairy forms
  'melk', 'yoghurt', 'kwark', 'kaas', 'boter', 'room', 'vla', 'pudding',
  'drink', 'drinkontbijt', 'toetje', 'dessert',
  // Carb/meal forms
  'spread', 'salade', 'soep', 'saus', 'pasta', 'rijst', 'brood',
  'maaltijd', 'pizza', 'wrap', 'tortilla', 'pannenkoek', 'wafel',
  // Snack forms
  'chips', 'koek', 'koekjes', 'ijs', 'snack', 'nootjes', 'mix',
]

/**
 * Compute how relevant a candidate name is to the source product name.
 * Returns 0-1 where 1 = perfect keyword overlap.
 *
 * Uses four strategies (best score wins):
 *   1. Exact token match (strongest signal)
 *   2. Substring/contains match (e.g. "kipfilet" contains "kip")
 *   3. Shared food-form root (e.g. "rundergehakt" and "vegan gehakt" share "gehakt")
 *   4. Longest common substring ≥ 4 chars (fuzzy fallback)
 */
function nameRelevance(sourceName, candidateName) {
  if (!sourceName || !candidateName) return 0

  const tokenize = (s) =>
    s.toLowerCase()
      .replace(/[^a-z0-9àáâãäåèéêëìíîïòóôõöùúûüñç]+/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w))

  const sourceTokens = tokenize(sourceName)
  if (sourceTokens.length === 0) return 0
  const candidateTokens = tokenize(candidateName)
  if (candidateTokens.length === 0) return 0

  const srcJoined = sourceName.toLowerCase()
  const candJoined = candidateName.toLowerCase()

  // ── Strategy 3: Food-form bonus ──
  // If both products share a food-form word, they serve the same culinary purpose
  let formBonus = 0
  for (const form of FOOD_FORMS) {
    if (srcJoined.includes(form) && candJoined.includes(form)) {
      // Longer form words are more specific (e.g. "schnitzel" > "mix")
      formBonus = Math.max(formBonus, form.length >= 6 ? 0.85 : form.length >= 4 ? 0.6 : 0.4)
    }
  }

  // ── Strategy 1-2-4: Token-based matching ──
  let matches = 0
  for (const token of sourceTokens) {
    // Strategy 1: Exact token match
    if (candidateTokens.includes(token)) { matches += 1; continue }

    // Strategy 2: Substring match — one token fully inside another
    let found = false
    for (const ct of candidateTokens) {
      if (ct.length >= 3 && token.length >= 3) {
        if (ct.includes(token) || token.includes(ct)) {
          matches += 0.8
          found = true
          break
        }
      }
    }
    if (found) continue

    // Strategy 4: Longest common substring ≥ 4 chars
    let bestRoot = 0
    for (const ct of candidateTokens) {
      const shorter = token.length < ct.length ? token : ct
      const longer = token.length < ct.length ? ct : token
      for (let len = shorter.length; len >= 4; len--) {
        for (let start = 0; start <= shorter.length - len; start++) {
          const sub = shorter.substring(start, start + len)
          if (longer.includes(sub)) {
            bestRoot = Math.max(bestRoot, len)
            break
          }
        }
        if (bestRoot >= len) break
      }
    }
    if (bestRoot >= 4) {
      matches += Math.min(0.7, bestRoot / token.length)
    }
  }

  const tokenScore = matches / sourceTokens.length
  // Return the best of token-based score or food-form bonus
  return Math.max(tokenScore, formBonus)
}

// ── Core scoring & sorting ──────────────────────────────────────

/**
 * Score and sort candidate products for recommendation quality.
 *
 * Scoring factors (in priority order):
 *   1. Is this a swap-category product? (highest priority)
 *   2. Name relevance — direct substitutes first
 *   3. CO₂ improvement (current score - candidate score; positive = candidate is better)
 *   4. Absolute CO₂ score (lower = better)
 *
 * Also filters out candidates whose score is null or (if mustBeBetter) not better.
 */
function scoreAndSort(candidates, evaluateProduct, getEnrichedData, currentScore, mustBeBetter, preferredCategories = [], sourceName = '') {
  const preferredSet = new Set(preferredCategories)

  return candidates
    .map(c => {
      const enriched = getEnrichedData(c)
      const evaluation = evaluateProduct(c.name, enriched)
      const relevance = nameRelevance(sourceName, c.name)
      const improvement = (evaluation.score != null && currentScore != null)
        ? currentScore - evaluation.score  // positive = candidate is better (lower score)
        : 0

      return {
        id: c.id,
        name: c.name,
        url: c.url,
        image_url: c.image_url,
        price: c.price,
        score: evaluation.score,
        co2Category: evaluation.co2Category,
        co2PerKg: evaluation.co2PerKg,
        is_vegan: c.is_vegan,
        is_vegetarian: c.is_vegetarian,
        is_organic: c.is_organic,
        is_fairtrade: c.is_fairtrade,
        isSwapCategory: preferredSet.has(evaluation.co2Category),
        improvement,
        relevance,
        // Composite rank score for sorting (higher = better)
        rankScore: computeRankScore(evaluation.score, currentScore, relevance, preferredSet.has(evaluation.co2Category))
      }
    })
    .filter(c => {
      if (c.score == null) return false
      if (mustBeBetter && c.score >= currentScore) return false  // lower score = better
      return true
    })
    .sort((a, b) => b.rankScore - a.rankScore)
}

/**
 * Compute a single rank score for sorting alternatives.
 * This replaces the multi-key sort with a weighted composite score
 * that balances all factors.
 *
 * Weights:
 *   - Swap category match: +50 (ensures they bubble to the top)
 *   - Name relevance: ×20 (food-form match strongly preferred)
 *   - CO₂ improvement: ×3 (bigger improvements preferred)
 *   - Absolute score: ×1 (lower score = better, so we invert)
 */
function computeRankScore(candidateScore, currentScore, relevance, isSwapCategory) {
  if (candidateScore == null) return -999

  const improvement = currentScore != null ? (currentScore - candidateScore) : 0

  let score = 0
  if (isSwapCategory) score += 50
  score += relevance * 20
  score += improvement * 3
  score += (8 - candidateScore) * 1  // invert: score 1 = +7, score 7 = +1

  return score
}
