/**
 * Category-aware product suggestion engine.
 *
 * For each CO₂ category we define "swap" categories — lower-emission
 * alternatives that serve a similar culinary purpose.  When a user views
 * a product, we can suggest real AH products from the swap categories
 * that are both relevant and genuinely better for the climate.
 */

// ──────────────────────────────────────────────────────────────────
// 1. Category swap map
//    key = source CO₂ category
//    value = { swaps: [target categories], keywords: [Supabase name search hints] }
//
//    "swaps" are categories that make sense as replacements.
//    "keywords" are extra search terms for the Supabase ilike query
//    when the swap categories don't yield enough results.
// ──────────────────────────────────────────────────────────────────

export const CATEGORY_SWAPS = {
  // ── Meat → plant-based / lower-emission protein ──────────────
  beef_herd: {
    swaps: ['tofu', 'other_pulses', 'peas', 'poultry_meat'],
    keywords: ['plantaardig', 'vegan', 'vegetarisch', 'tempeh', 'seitan', 'bonen burger', 'groente burger'],
    tip: { nl: 'Rundvlees heeft de hoogste CO₂-uitstoot. Plantaardige alternatieven besparen tot 95%.', en: 'Beef has the highest CO₂ footprint. Plant-based alternatives can save up to 95%.' }
  },
  beef_dairy: {
    swaps: ['tofu', 'other_pulses', 'peas', 'poultry_meat'],
    keywords: ['plantaardig', 'vegan', 'tempeh', 'seitan', 'bonen burger'],
    tip: { nl: 'Rundvlees heeft de hoogste CO₂-uitstoot. Plantaardige alternatieven besparen tot 90%.', en: 'Beef has the highest CO₂ footprint. Plant-based alternatives can save up to 90%.' }
  },
  lamb_mutton: {
    swaps: ['tofu', 'other_pulses', 'poultry_meat', 'pig_meat'],
    keywords: ['plantaardig', 'vegan', 'tempeh'],
    tip: { nl: 'Lam is qua CO₂ vergelijkbaar met rundvlees. Overweeg gevogelte of plantaardig.', en: 'Lamb has a similar CO₂ footprint to beef. Consider poultry or plant-based.' }
  },
  pig_meat: {
    swaps: ['tofu', 'other_pulses', 'poultry_meat'],
    keywords: ['plantaardig', 'vegan', 'tempeh', 'vegetarisch worst', 'vegetarisch gehakt'],
    tip: { nl: 'Varkensvlees heeft een gemiddelde uitstoot. Kip of plantaardig bespaart 50-80%.', en: 'Pork has moderate emissions. Chicken or plant-based saves 50-80%.' }
  },
  poultry_meat: {
    swaps: ['tofu', 'other_pulses', 'peas', 'eggs'],
    keywords: ['plantaardig kip', 'vegan kip', 'vegetarische schnitzel', 'tempeh'],
    tip: { nl: 'Kip scoort al goed voor vlees. Plantaardige varianten besparen nog 60-80%.', en: 'Chicken already scores well for meat. Plant-based options save another 60-80%.' }
  },

  // ── Seafood → lower-emission protein ─────────────────────────
  shrimps_farmed: {
    swaps: ['fish_farmed', 'tofu', 'peas'],
    keywords: ['visstick', 'plantaardige vis'],
    tip: { nl: 'Garnalen hebben een hoge uitstoot. Vis of plantaardig is beter.', en: 'Shrimp has high emissions. Fish or plant-based is better.' }
  },
  fish_farmed: {
    swaps: ['tofu', 'peas', 'eggs'],
    keywords: ['plantaardige vis', 'visvervanger'],
    tip: { nl: 'Vis heeft een gemiddelde uitstoot. Peulvruchten of tofu besparen 50%.', en: 'Fish has moderate emissions. Legumes or tofu save 50%.' }
  },

  // ── Dairy → plant-based dairy ────────────────────────────────
  cheese: {
    swaps: ['nuts', 'tofu'],
    keywords: ['vegan kaas', 'plantaardige kaas', 'notenpasta'],
    tip: { nl: 'Kaas heeft een verrassend hoge CO₂-uitstoot door de zuivelketen. Plantaardige kaas bespaart tot 80%.', en: 'Cheese has a surprisingly high CO₂ footprint. Plant-based cheese saves up to 80%.' }
  },
  milk: {
    swaps: ['soy_milk', 'oatmeal'],
    keywords: ['havermelk', 'sojamelk', 'amandelmelk', 'plantaardige melk', 'haver drink'],
    tip: { nl: 'Zuivel heeft ~3× meer CO₂ dan havermelk. Plantaardige melk bespaart tot 70%.', en: 'Dairy has ~3× more CO₂ than oat milk. Plant-based milk saves up to 70%.' }
  },
  eggs: {
    swaps: ['tofu', 'other_pulses'],
    keywords: ['tofu', 'kikkererwten'],
    tip: { nl: 'Eieren scoren gemiddeld. Tofu en peulvruchten zijn een goed alternatief voor eiwitbronnen.', en: 'Eggs score average. Tofu and legumes are good protein alternatives.' }
  },

  // ── Oils → lower-emission oils ───────────────────────────────
  olive_oil: {
    swaps: ['rapeseed_oil', 'sunflower_oil'],
    keywords: ['zonnebloemolie', 'raapzaadolie'],
    tip: { nl: 'Olijfolie scoort goed maar raapzaadolie heeft nog minder uitstoot.', en: 'Olive oil scores well but rapeseed oil has even lower emissions.' }
  },
  palm_oil: {
    swaps: ['rapeseed_oil', 'sunflower_oil'],
    keywords: ['zonnebloemolie', 'raapzaadolie'],
    tip: { nl: 'Palmolie is gelinkt aan ontbossing. Kies voor Europese oliën.', en: 'Palm oil is linked to deforestation. Choose European oils.' }
  },

  // ── Grains → already low, but rice is the outlier ────────────
  rice: {
    swaps: ['potatoes', 'wheat_rye', 'oatmeal', 'maize'],
    keywords: ['pasta', 'couscous', 'aardappel', 'bulgur'],
    tip: { nl: 'Rijst heeft hoge methaanuitstoot door natte teelt. Pasta, aardappelen of couscous zijn 70% lager.', en: 'Rice has high methane emissions from wet cultivation. Pasta, potatoes, or couscous are 70% lower.' }
  },

  // ── Beverages ────────────────────────────────────────────────
  coffee: {
    swaps: ['tea'],
    keywords: ['thee', 'kruidenthee'],
    tip: { nl: 'Koffie heeft een aanzienlijke uitstoot. Thee is 5-10× lager.', en: 'Coffee has significant emissions. Tea is 5-10× lower.' }
  },
  dark_chocolate: {
    swaps: ['nuts', 'other_fruit'],
    keywords: ['noten', 'fruit'],
    tip: { nl: 'Cacao heeft een hoge uitstoot door ontbossing. Noten en fruit zijn betere snacks.', en: 'Cocoa has high emissions from deforestation. Nuts and fruit are better snacks.' }
  },

  // ── Processed foods → homemade / simpler alternatives ──────
  ready_meals: {
    swaps: ['other_vegetables', 'potatoes', 'wheat_rye', 'tofu'],
    keywords: ['groente', 'verse', 'zelf koken'],
    tip: { nl: 'Kant-en-klaarmaaltijden bevatten vaak vlees en zuivel. Verse groenten koken bespaart CO₂.', en: 'Ready meals often contain meat and dairy. Cooking fresh vegetables saves CO₂.' }
  },

  // ── Sugar ────────────────────────────────────────────────────
  cane_sugar: {
    swaps: ['beet_sugar'],
    keywords: ['bietsuiker', 'suiker'],
    tip: { nl: 'Rietsuiker wordt van ver geïmporteerd. Europese bietsuiker heeft minder transportuitstoot.', en: 'Cane sugar is imported from far away. European beet sugar has lower transport emissions.' }
  }
}

// Categories that are already very low-emission (score ≥ 9), no swap needed
export const LOW_EMISSION_CATEGORIES = new Set([
  'tomatoes', 'onions_leeks', 'root_vegetables', 'brassicas',
  'other_vegetables', 'potatoes', 'citrus_fruit', 'apples',
  'bananas', 'berries_grapes', 'other_fruit', 'peas',
  'other_pulses', 'tofu', 'soy_milk', 'wheat_rye', 'oatmeal',
  'maize', 'barley', 'beet_sugar', 'tea', 'nuts', 'groundnuts'
])

// Related categories (same general group, useful for "similar" alternatives)
export const RELATED_CATEGORIES = {
  beef_herd: ['beef_dairy', 'lamb_mutton'],
  beef_dairy: ['beef_herd', 'lamb_mutton'],
  lamb_mutton: ['beef_herd', 'beef_dairy'],
  pig_meat: ['poultry_meat'],
  poultry_meat: ['pig_meat', 'eggs'],
  milk: ['cheese', 'eggs', 'soy_milk'],
  cheese: ['milk', 'eggs'],
  eggs: ['milk', 'cheese'],
  fish_farmed: ['shrimps_farmed'],
  shrimps_farmed: ['fish_farmed'],
  tomatoes: ['other_vegetables', 'brassicas', 'root_vegetables'],
  potatoes: ['root_vegetables', 'other_vegetables'],
  apples: ['other_fruit', 'citrus_fruit', 'berries_grapes', 'bananas'],
  bananas: ['apples', 'citrus_fruit', 'other_fruit'],
  rice: ['wheat_rye', 'potatoes', 'oatmeal', 'maize'],
  wheat_rye: ['rice', 'oatmeal', 'maize'],
  olive_oil: ['rapeseed_oil', 'sunflower_oil'],
  sunflower_oil: ['rapeseed_oil', 'olive_oil'],
  rapeseed_oil: ['sunflower_oil', 'olive_oil'],
  coffee: ['tea'],
  tea: ['coffee'],
  wine: ['beer'],
  beer: ['wine']
}

/**
 * Find real product alternatives from the database.
 *
 * @param {Object} options
 * @param {Object} options.supabase - Supabase client
 * @param {string} options.productId - Current product ID (to exclude from results)
 * @param {string} options.productName - Current product name
 * @param {string} options.co2Category - CO₂ category of the current product
 * @param {number|null} options.currentScore - Current product's score (0-10)
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
  if (isLowEmission || currentScore >= 9) {
    result.tip = lang === 'nl'
      ? '🌿 Uitstekende keuze! Dit product heeft al een zeer lage CO₂-uitstoot.'
      : '🌿 Excellent choice! This product already has very low CO₂ emissions.'

    // Still try to find similar products in same category for variety
    const related = RELATED_CATEGORIES[co2Category] || []
    const sameCategoryAlts = await queryCategoryProducts(supabase, [co2Category, ...related], productId, 50)
    if (sameCategoryAlts.length > 0) {
      const scored = scoreAndSort(sameCategoryAlts, evaluateProduct, getEnrichedData, currentScore, false, [], productName)
      result.alternatives = scored.slice(0, maxResults)
    }
    return result
  }

  // 2. Set the contextual tip
  if (swapInfo?.tip) {
    result.tip = swapInfo.tip[lang] || swapInfo.tip.nl
  }

  // 3. Query products from swap categories
  const swapCategories = swapInfo?.swaps || []
  const searchKeywords = swapInfo?.keywords || []

  // Find products whose CO₂ category is in the swap list.
  // We query by keyword hints (from CATEGORY_SWAPS) to get relevant candidates,
  // then score them and keep only those that actually land in a swap category.
  let candidates = []

  if (searchKeywords.length > 0) {
    const keywordCandidates = await queryByKeywords(supabase, searchKeywords, productId, 120)
    candidates.push(...keywordCandidates)
  }

  // Also pull from RELATED_CATEGORIES for same-group variety
  const related = RELATED_CATEGORIES[co2Category] || []
  if (related.length > 0) {
    // Build extra keywords from related category names
    const relatedKeywords = related.flatMap(cat => cat.replace(/_/g, ' ').split(' ')).filter(w => w.length > 3)
    if (relatedKeywords.length > 0) {
      const relatedCandidates = await queryByKeywords(supabase, relatedKeywords, productId, 40)
      candidates.push(...relatedCandidates)
    }
  }

  // Fallback: if keyword search yielded very few candidates, broaden the pool
  // but we'll still filter to swap-category matches only below
  if (candidates.length < maxResults * 2) {
    const popularCandidates = await queryPopularProducts(supabase, productId, 100)
    candidates.push(...popularCandidates)
  }

  // Deduplicate by id
  const seen = new Set()
  candidates = candidates.filter(c => {
    if (seen.has(c.id)) return false
    seen.add(c.id)
    return true
  })

  // Score all candidates, filter to better ones, and keep ONLY swap-category matches
  const scored = scoreAndSort(candidates, evaluateProduct, getEnrichedData, currentScore, true, swapCategories, productName)

  // Prefer swap-category products; only include non-swap if we still have room
  const swapMatches = scored.filter(c => c.isSwapCategory)
  const nonSwapBetter = scored.filter(c => !c.isSwapCategory)

  if (swapMatches.length >= maxResults) {
    result.alternatives = swapMatches.slice(0, maxResults)
  } else {
    // Only fill with strict swap-category matches — no generic high scorers
    result.alternatives = swapMatches.slice(0, maxResults)
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

  // For excellent products, just congratulate
  if (score >= 9 || LOW_EMISSION_CATEGORIES.has(co2Category)) {
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

  // Generic tips based on score range
  if (score <= 4) {
    tips.push(lang === 'nl'
      ? '🔄 Bekijk de alternatieven hieronder voor producten met een lagere CO₂-uitstoot.'
      : '🔄 Check the alternatives below for products with a lower CO₂ footprint.')
  } else if (score <= 6) {
    tips.push(lang === 'nl'
      ? '💡 Er zijn vergelijkbare producten met een betere score beschikbaar.'
      : '💡 Similar products with a better score are available.')
  }

  return tips
}

// ── Internal helpers ────────────────────────────────────────────

async function queryCategoryProducts(supabase, categories, excludeId, limit) {
  // Use categories array overlap to find products in same categories
  const { data } = await supabase
    .from('products')
    .select('id, name, url, image_url, price, is_vegan, is_vegetarian, is_organic, is_fairtrade, nutri_score, ingredients, nutrition_text, nutrition_json, origin_country, brand, categories')
    .neq('id', excludeId || '')
    .order('seen_count', { ascending: false })
    .limit(limit)

  return data || []
}

async function queryByKeywords(supabase, keywords, excludeId, limit) {
  if (!keywords || keywords.length === 0) return []

  // Build an OR filter using ilike for each keyword
  const orFilter = keywords.map(kw => `normalized_name.ilike.%${kw.replace(/\s+/g, '%')}%`).join(',')

  const { data } = await supabase
    .from('products')
    .select('id, name, url, image_url, price, is_vegan, is_vegetarian, is_organic, is_fairtrade, nutri_score, ingredients, nutrition_text, nutrition_json, origin_country, brand, categories')
    .neq('id', excludeId || '')
    .or(orFilter)
    .order('seen_count', { ascending: false })
    .limit(limit)

  return data || []
}

async function queryPopularProducts(supabase, excludeId, limit) {
  const { data } = await supabase
    .from('products')
    .select('id, name, url, image_url, price, is_vegan, is_vegetarian, is_organic, is_fairtrade, nutri_score, ingredients, nutrition_text, nutrition_json, origin_country, brand, categories')
    .neq('id', excludeId || '')
    .order('seen_count', { ascending: false })
    .limit(limit)

  return data || []
}

// Words to ignore when computing name relevance (common Dutch/brand filler)
const STOP_WORDS = new Set([
  'ah', 'de', 'het', 'een', 'en', 'van', 'met', 'voor', 'op', 'in', 'uit',
  'bio', 'biologisch', 'huismerk', 'merk', 'stuks', 'stuk', 'gram', 'ml',
  'liter', 'kg', 'pack', 'mini', 'groot', 'klein', 'vers', 'vrij',
  'terra', 'planted', 'garden', 'gourmet'
])

// Common Dutch food-form words that indicate culinary purpose
// Used to detect shared function between e.g. "rundergehakt" and "rulgehakt"
const FOOD_FORMS = [
  'gehakt', 'burger', 'worst', 'filet', 'schnitzel', 'steak', 'bal', 'balletjes',
  'stukjes', 'reepjes', 'plakjes', 'blokjes', 'sticks', 'nuggets', 'kroket',
  'shoarma', 'gyros', 'kebab', 'ragout', 'stoofvlees', 'braadstuk',
  'melk', 'yoghurt', 'kwark', 'kaas', 'boter', 'room', 'vla', 'pudding',
  'spread', 'salade', 'soep', 'saus', 'pasta', 'rijst', 'brood',
]

/**
 * Compute how relevant a candidate name is to the source product name.
 * Returns 0-1 where 1 = perfect keyword overlap.
 * Uses three strategies:
 *   1. Exact token match
 *   2. Substring/contains match
 *   3. Shared food-form root (e.g. "rundergehakt" and "rulgehakt" share "gehakt")
 */
function nameRelevance(sourceName, candidateName) {
  if (!sourceName || !candidateName) return 0
  const tokenize = (s) => s.toLowerCase().replace(/[^a-z0-9àáâãäåèéêëìíîïòóôõöùúûüñç]+/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP_WORDS.has(w))
  const sourceTokens = tokenize(sourceName)
  if (sourceTokens.length === 0) return 0
  const candidateTokens = tokenize(candidateName)
  const srcJoined = sourceName.toLowerCase()
  const candJoined = candidateName.toLowerCase()

  // Check for shared food-form words in both names
  let formBonus = 0
  for (const form of FOOD_FORMS) {
    if (srcJoined.includes(form) && candJoined.includes(form)) {
      formBonus = Math.max(formBonus, form.length >= 6 ? 0.8 : 0.5)
    }
  }

  let matches = 0
  for (const token of sourceTokens) {
    // Exact token match
    if (candidateTokens.includes(token)) { matches += 1; continue }
    // Substring match: one token fully inside another
    let found = false
    for (const ct of candidateTokens) {
      if (ct.includes(token) || token.includes(ct)) { matches += 0.8; found = true; break }
    }
    if (found) continue
    // Shared root match: find longest common substring ≥ 4 chars
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
  // Combine: take the best of token-based score or food-form bonus
  return Math.max(tokenScore, formBonus)
}

function scoreAndSort(candidates, evaluateProduct, getEnrichedData, currentScore, mustBeBetter, preferredCategories = [], sourceName = '') {
  const preferredSet = new Set(preferredCategories)

  return candidates
    .map(c => {
      const enriched = getEnrichedData(c)
      const evaluation = evaluateProduct(c.name, enriched)
      const relevance = nameRelevance(sourceName, c.name)
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
        is_organic: c.is_organic,
        is_fairtrade: c.is_fairtrade,
        isSwapCategory: preferredSet.has(evaluation.co2Category),
        improvement: evaluation.score != null && currentScore != null
          ? evaluation.score - currentScore
          : 0,
        relevance
      }
    })
    .filter(c => {
      if (c.score == null) return false
      if (mustBeBetter && c.score <= currentScore) return false
      return true
    })
    .sort((a, b) => {
      // 1. Swap category products first
      if (a.isSwapCategory !== b.isSwapCategory) return a.isSwapCategory ? -1 : 1
      // 2. Name relevance — direct substitutes ("gehakt" → "vegan gehakt") first
      if (Math.abs(a.relevance - b.relevance) > 0.1) return b.relevance - a.relevance
      // 3. Higher score improvement
      if (b.improvement !== a.improvement) return b.improvement - a.improvement
      // 4. Higher absolute score
      return b.score - a.score
    })
}
