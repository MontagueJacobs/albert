/**
 * Plant-based suggestion engine.
 *
 * Recommends products exclusively from AH's "Vegetarisch, vegan en plantaardig"
 * section as alternatives to meat, fish, and dairy products.
 *
 * Architecture:
 *   1) CATEGORY_SWAPS defines which CO2 categories qualify for recommendations,
 *      mapped to relevant plant-based AH subcategories.
 *   2) findSmartAlternatives() queries only the plant-based pool (source =
 *      'api_plantbased') in Supabase, using subcategory matching + keyword
 *      search to find the most relevant alternatives.
 *   3) getSmartSuggestions() returns text tips for the product detail page.
 *   4) Categories NOT in CATEGORY_SWAPS get NO recommendations.
 *
 * Data source:
 *   The plant-based product pool is scraped from AH's API taxonomy sections:
 *     - 18041: Vleesvervangers (meat substitutes)
 *     - 5282:  Plantaardige zuivel alternatieven (plant-based dairy)
 *     - 8611:  Plantaardige drinks (plant-based drinks)
 *     - 19816: Vegetarisch en plantaardig beleg (vegetarian toppings/spreads)
 *   These are stored with source = 'api_plantbased' and categories[] containing
 *   'ah:Vleesvervangers', 'ah_sub:Vegetarisch gehakt', etc.
 */

// ---------------------------------------------------------------
// 1. Categories that qualify for plant-based recommendations
//    Only meat, fish, and dairy CO2 categories get suggestions.
//    Everything else -> no recommendations.
// ---------------------------------------------------------------

/**
 * Map from CO2 category -> {
 *   ahSubCategories: AH subcategories to search in (from categories[] field)
 *   keywords:        extra search terms for normalized_name matching
 *   tip:             contextual sustainability tip { nl, en }
 * }
 */
export const CATEGORY_SWAPS = {
  // -- Red meat
  beef_herd: {
    ahSubCategories: ['Vegetarisch gehakt', 'Vegetarische burgers', 'Vegetarische steak', 'Vega balletjes', 'Vegetarische stukjes'],
    keywords: ['gehakt', 'burger', 'steak', 'bal', 'stukjes', 'terra', 'planted', 'beyond', 'impossible'],
    tip: {
      nl: 'Rundvlees heeft de hoogste CO\u2082-uitstoot. Plantaardige alternatieven uit de vegan afdeling besparen tot 95%.',
      en: 'Beef has the highest CO\u2082 footprint. Plant-based alternatives from the vegan section save up to 95%.'
    }
  },
  beef_dairy: {
    ahSubCategories: ['Vegetarisch gehakt', 'Vegetarische burgers', 'Vegetarische steak', 'Vega balletjes', 'Vegetarische stukjes'],
    keywords: ['gehakt', 'burger', 'steak', 'bal', 'stukjes', 'terra', 'planted'],
    tip: {
      nl: 'Rundvlees heeft de hoogste CO\u2082-uitstoot. Plantaardige alternatieven besparen tot 90%.',
      en: 'Beef has the highest CO\u2082 footprint. Plant-based alternatives save up to 90%.'
    }
  },
  lamb_mutton: {
    ahSubCategories: ['Vegetarisch gehakt', 'Vegetarische burgers', 'Vegetarische steak', 'Vegetarische shoarma, gyros, kebab', 'Falafel'],
    keywords: ['gehakt', 'burger', 'kebab', 'gyros', 'falafel', 'shoarma'],
    tip: {
      nl: 'Lam is qua CO\u2082 vergelijkbaar met rundvlees. Kies plantaardig uit de vegan afdeling.',
      en: 'Lamb has a similar CO\u2082 footprint to beef. Choose plant-based from the vegan section.'
    }
  },

  // -- Pork
  pig_meat: {
    ahSubCategories: ['Vegetarische worst', 'Vegetarische schnitzel', 'Vegetarische spekjes', 'Vegetarisch gehakt', 'Plantaardige vleeswaren'],
    keywords: ['worst', 'schnitzel', 'spek', 'gehakt', 'vleeswaren', 'rookworst', 'ham'],
    tip: {
      nl: 'Varkensvlees heeft een gemiddelde uitstoot. Plantaardige worst, schnitzel of gehakt bespaart 50-80%.',
      en: 'Pork has moderate emissions. Plant-based sausage, schnitzel, or mince saves 50-80%.'
    }
  },

  // -- Poultry
  poultry_meat: {
    ahSubCategories: ['Vegetarische schnitzel', 'Vegetarische stukjes', 'Vegetarische kipfilet', 'Vegetarische shoarma, gyros, kebab', 'Vegetarische burgers'],
    keywords: ['schnitzel', 'stukjes', 'kipfilet', 'kip', 'nuggets', 'shoarma', 'burger'],
    tip: {
      nl: 'Kip scoort al relatief goed voor vlees. Plantaardige varianten besparen nog 60-80%.',
      en: 'Chicken already scores relatively well for meat. Plant-based variants save another 60-80%.'
    }
  },

  // -- Seafood
  shrimps_farmed: {
    ahSubCategories: ['Vegetarische stukjes', 'Tofu', 'Falafel', 'Vegetarische burgers'],
    keywords: ['visvervanger', 'tofu', 'falafel', 'stukjes'],
    tip: {
      nl: 'Garnalen hebben een hoge uitstoot. Plantaardige alternatieven zijn veel beter.',
      en: 'Shrimp has high emissions. Plant-based alternatives are much better.'
    }
  },
  fish_farmed: {
    ahSubCategories: ['Tofu', 'Vegetarische stukjes', 'Falafel', 'Tempeh'],
    keywords: ['visvervanger', 'tofu', 'tempeh', 'falafel'],
    tip: {
      nl: 'Vis heeft een gemiddelde uitstoot. Tofu, tempeh of falafel zijn goede alternatieven.',
      en: 'Fish has moderate emissions. Tofu, tempeh, or falafel are good alternatives.'
    }
  },

  // -- Dairy
  cheese: {
    ahSubCategories: ['Plantaardige kaas voor beleg', 'Plantaardige spreads', 'Hummus naturel', 'Hummus met smaakje'],
    keywords: ['kaas', 'spread', 'hummus', 'cashew', 'smeerbaar'],
    tip: {
      nl: 'Kaas heeft een verrassend hoge CO₂-uitstoot. Plantaardige kaas bespaart tot 80%.',
      en: 'Cheese has a surprisingly high CO₂ footprint. Plant-based cheese saves up to 80%.'
    }
  },
  milk: {
    ahSubCategories: ['Haverdrink', 'Sojadrink', 'Amandel, cashewdrink', 'Kokosdrink', 'Rijstdrank, erwtendrink'],
    keywords: ['havermelk', 'sojamelk', 'amandelmelk', 'kokosmelk', 'haver', 'oat', 'alpro', 'oatly'],
    tip: {
      nl: 'Zuivel heeft ~3x meer CO\u2082 dan havermelk. Plantaardige melk bespaart tot 70%.',
      en: 'Dairy has ~3x more CO\u2082 than oat milk. Plant-based milk saves up to 70%.'
    }
  },
  eggs: {
    ahSubCategories: ['Tofu', 'Tempeh', 'Plantaardige spreads'],
    keywords: ['tofu', 'tempeh', 'scramble', 'spread'],
    tip: {
      nl: 'Eieren scoren gemiddeld. Tofu en tempeh zijn goede eiwitbronnen met minder uitstoot.',
      en: 'Eggs score average. Tofu and tempeh are good protein sources with lower emissions.'
    }
  },

  // -- Dairy desserts & products
  ice_cream: {
    ahSubCategories: ['Plantaardige toetjes', 'Plantaardige yoghurt met smaak'],
    keywords: ['ijs', 'sorbet', 'plantaardig', 'vegan'],
    tip: {
      nl: 'Roomijs bevat zuivel (hoge CO\u2082). Plantaardig ijs of toetjes besparen tot 60%.',
      en: 'Dairy ice cream has high CO\u2082. Plant-based ice cream or desserts save up to 60%.'
    }
  },
  desserts: {
    ahSubCategories: ['Plantaardige toetjes', 'Plantaardige yoghurt met smaak', 'Plantaardige kwark, vla'],
    keywords: ['toetje', 'yoghurt', 'kwark', 'vla', 'pudding', 'alpro'],
    tip: {
      nl: 'Zuiveldesserts hebben een hoge uitstoot. Plantaardige toetjes zijn beter.',
      en: 'Dairy desserts have high emissions. Plant-based desserts are better.'
    }
  },

  // -- Sugar
  cane_sugar: {
    ahSubCategories: [],
    keywords: ['bietsuiker', 'kristalsuiker'],
    tip: {
      nl: 'Rietsuiker heeft bijna 2x zoveel CO₂-uitstoot als bietsuiker. Kies bietsuiker (zoals AH Kristalsuiker) voor een lagere voetafdruk.',
      en: 'Cane sugar has nearly 2x the CO₂ emissions of beet sugar. Choose beet sugar (like AH Kristalsuiker) for a lower footprint.'
    }
  },
}

/** Set of all CO2 categories that qualify for recommendations */
export const RECOMMENDABLE_CATEGORIES = new Set(Object.keys(CATEGORY_SWAPS))

// Legacy export -- still used by findReplacementSuggestions in app.js
export const LOW_EMISSION_CATEGORIES = new Set([
  'tomatoes', 'onions_leeks', 'root_vegetables', 'brassicas',
  'other_vegetables', 'potatoes',
  'citrus_fruit', 'apples', 'bananas', 'berries_grapes', 'other_fruit',
  'peas', 'other_pulses',
  'wheat_rye', 'oatmeal', 'maize', 'barley',
  'beet_sugar', 'tea', 'nuts', 'soy_milk',
  'soft_drinks', 'beer', 'wine',
  'candy_sweets', 'baked_goods', 'soup',
  'sauces_condiments', 'cassava',
  'baby_food'
])

// Legacy export -- kept for findReplacementSuggestions
export const RELATED_CATEGORIES = {
  beef_herd: ['beef_dairy', 'lamb_mutton'],
  beef_dairy: ['beef_herd', 'lamb_mutton'],
  lamb_mutton: ['beef_herd', 'beef_dairy'],
  pig_meat: ['poultry_meat'],
  poultry_meat: ['pig_meat', 'eggs'],
  milk: ['cheese', 'eggs'],
  cheese: ['milk', 'eggs'],
  eggs: ['milk', 'cheese'],
  fish_farmed: ['shrimps_farmed'],
  shrimps_farmed: ['fish_farmed'],
}

// ---------------------------------------------------------------
// 2. Main entry point -- find plant-based alternatives
// ---------------------------------------------------------------

/**
 * Find plant-based product alternatives from the AH "Vegetarisch, vegan en
 * plantaardig" section in the database.
 *
 * @param {Object} options
 * @param {Object} options.supabase - Supabase client
 * @param {string} options.productId - Current product ID (to exclude)
 * @param {string} options.productName - Current product name
 * @param {string} options.co2Category - CO2 category of the current product
 * @param {number|null} options.currentScore - Current product's score (1-10, 10=best)
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

  // Gate: Only recommend for meat/fish/dairy
  if (!RECOMMENDABLE_CATEGORIES.has(co2Category)) {
    return result  // No recommendations for non-meat/fish/dairy
  }

  const swapInfo = CATEGORY_SWAPS[co2Category]
  if (!swapInfo) return result

  // Set the contextual tip
  result.tip = swapInfo.tip[lang] || swapInfo.tip.nl

  // Build candidate pool from plant-based products only
  let candidates = []

  // Strategy A: Query by AH subcategory (most precise)
  if (swapInfo.ahSubCategories.length > 0) {
    const subCatResults = await queryBySubcategory(supabase, swapInfo.ahSubCategories, productId, 80)
    candidates.push(...subCatResults)
  }

  // Strategy B: Keyword search within plant-based pool
  if (swapInfo.keywords.length > 0) {
    const kwResults = await queryPlantBasedByKeywords(supabase, swapInfo.keywords, productId, 60)
    candidates.push(...kwResults)
  }

  // Strategy C: Food-form matching from the source product name
  const nameKws = extractFoodFormKeywords(productName)
  if (nameKws.length > 0) {
    const nameResults = await queryPlantBasedByKeywords(supabase, nameKws, productId, 40)
    candidates.push(...nameResults)
  }

  // Strategy D: If very few results, broaden to all plant-based products
  if (candidates.length < maxResults * 2) {
    const broadResults = await queryAllPlantBased(supabase, productId, 80)
    candidates.push(...broadResults)
  }

  // Deduplicate by id
  const seen = new Set()
  candidates = candidates.filter(c => {
    if (seen.has(c.id)) return false
    seen.add(c.id)
    return true
  })

  // Keep milk swaps focused on plant-based milk/drink products
  if (co2Category === 'milk') {
    const milkCandidates = candidates.filter(isMilkAlternativeCandidate)
    if (milkCandidates.length > 0) {
      candidates = milkCandidates
    }
  }

  // Score and sort candidates
  const scored = scoreAndSort(candidates, evaluateProduct, getEnrichedData, currentScore, productName, swapInfo.ahSubCategories)

  result.alternatives = scored.slice(0, maxResults)
  return result
}

/**
 * Generate text suggestions for the product detail page.
 * Only returns tips for meat/fish/dairy products.
 */
export function getSmartSuggestions(productName, co2Category, score, lang = 'nl') {
  const tips = []

  if (score == null) return tips

  // Only provide tips for meat/fish/dairy
  if (!RECOMMENDABLE_CATEGORIES.has(co2Category)) {
    return tips
  }

  const swapInfo = CATEGORY_SWAPS[co2Category]
  if (swapInfo?.tip) {
    tips.push(swapInfo.tip[lang] || swapInfo.tip.nl)
  }

  tips.push(lang === 'nl'
    ? '\ud83d\udd04 Bekijk de plantaardige alternatieven hieronder uit de AH vegan afdeling.'
    : '\ud83d\udd04 Check the plant-based alternatives below from the AH vegan section.')

  return tips
}

// ---------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------

/** Standard product columns to select from Supabase */
const PRODUCT_COLUMNS = 'id, name, url, image_url, price, is_vegan, is_vegetarian, is_organic, is_fairtrade, nutri_score, ingredients, nutrition_text, nutrition_json, origin_country, brand, categories'

/**
 * Query plant-based products by AH subcategory.
 * Searches the categories[] array field for 'ah_sub:SubCategoryName'.
 */
async function queryBySubcategory(supabase, subCategories, excludeId, limit) {
  if (!subCategories || subCategories.length === 0) return []

  const orFilter = subCategories.map(sub =>
    `categories.cs.{"ah_sub:${sub}"}`
  ).join(',')

  try {
    const { data } = await supabase
      .from('products')
      .select(PRODUCT_COLUMNS)
      .eq('source', 'api_plantbased')
      .neq('id', excludeId || '')
      .or(orFilter)
      .limit(limit)

    return data || []
  } catch {
    return []
  }
}

/**
 * Query plant-based products by keyword on normalized_name.
 * Only searches within source = 'api_plantbased'.
 */
async function queryPlantBasedByKeywords(supabase, keywords, excludeId, limit) {
  if (!keywords || keywords.length === 0) return []

  const orFilter = keywords.map(kw => {
    const escaped = kw.replace(/\s+/g, '%')
    return `normalized_name.ilike.%${escaped}%`
  }).join(',')

  try {
    const { data } = await supabase
      .from('products')
      .select(PRODUCT_COLUMNS)
      .eq('source', 'api_plantbased')
      .neq('id', excludeId || '')
      .or(orFilter)
      .limit(limit)

    return data || []
  } catch (e) {
    if (keywords.length > 10) {
      return queryPlantBasedByKeywords(supabase, keywords.slice(0, 10), excludeId, limit)
    }
    return []
  }
}

/**
 * Get all plant-based products as a broad fallback.
 */
async function queryAllPlantBased(supabase, excludeId, limit) {
  try {
    const { data } = await supabase
      .from('products')
      .select(PRODUCT_COLUMNS)
      .eq('source', 'api_plantbased')
      .neq('id', excludeId || '')
      .limit(limit)

    return data || []
  } catch {
    return []
  }
}

// -- Food-form extraction ----------------------------------------

/** Common Dutch food-form words that indicate culinary purpose */
const FOOD_FORMS = [
  'gehakt', 'burger', 'worst', 'filet', 'schnitzel', 'steak', 'bal', 'balletjes',
  'stukjes', 'reepjes', 'plakjes', 'blokjes', 'sticks', 'nuggets', 'kroket',
  'shoarma', 'gyros', 'kebab', 'ragout', 'stoofvlees', 'braadstuk',
  'roerbakreepjes', 'fricandeau', 'medaillons', 'loempia', 'spekjes',
  'melk', 'yoghurt', 'kwark', 'kaas', 'boter', 'room', 'vla', 'pudding',
  'drink', 'drinkontbijt', 'toetje', 'dessert',
  'ijs', 'snack', 'spread',
]

const MILK_ALT_HINTS = [
  'melk', 'drink', 'barista',
  'haver', 'havermelk', 'haverdrink',
  'soja', 'sojamelk', 'sojadrink',
  'amandel', 'amandelmelk',
  'rijst', 'rijstdrink',
  'erwt', 'erwtendrink',
  'kokos', 'kokosmelk',
  'cashew', 'hazelnoot', 'spelt'
]

function isMilkAlternativeCandidate(candidate) {
  const name = (candidate?.name || '').toLowerCase()
  const categoryText = Array.isArray(candidate?.categories)
    ? candidate.categories.join(' ').toLowerCase()
    : ''
  const haystack = `${name} ${categoryText}`
  return MILK_ALT_HINTS.some(hint => haystack.includes(hint))
}

/**
 * Extract food-form keywords from a product name.
 * E.g. "AH Rundvlees gehakt" -> ["gehakt"]
 */
function extractFoodFormKeywords(productName) {
  if (!productName) return []
  const lower = productName.toLowerCase()
  const keywords = []
  for (const form of FOOD_FORMS) {
    if (lower.includes(form)) {
      keywords.push(form)
    }
  }
  return keywords
}

// -- Name Relevance Scoring --------------------------------------

const STOP_WORDS = new Set([
  'ah', 'de', 'het', 'een', 'en', 'van', 'met', 'voor', 'op', 'in', 'uit',
  'per', 'bij', 'tot', 'aan', 'als', 'dan', 'die', 'dat', 'ook', 'nog',
  'bio', 'biologisch', 'huismerk', 'merk', 'stuks', 'stuk', 'gram', 'ml',
  'liter', 'kg', 'pack', 'mini', 'groot', 'klein', 'vers', 'vrij',
  'terra', 'planted', 'garden', 'gourmet', 'albert', 'heijn', 'jumbo',
  'basic', 'premium', 'excellent', 'original', 'classic', 'naturel'
])

/**
 * Compute how relevant a candidate name is to the source product name.
 * Returns 0-1 where 1 = perfect relevance.
 */
function nameRelevance(sourceName, candidateName) {
  if (!sourceName || !candidateName) return 0

  const srcLower = sourceName.toLowerCase()
  const candLower = candidateName.toLowerCase()

  // Food-form bonus
  let formBonus = 0
  for (const form of FOOD_FORMS) {
    if (srcLower.includes(form) && candLower.includes(form)) {
      formBonus = Math.max(formBonus, form.length >= 6 ? 0.9 : form.length >= 4 ? 0.7 : 0.5)
    }
  }

  // Token overlap
  const tokenize = (s) =>
    s.replace(/[^a-z0-9\u00e0-\u00ff]+/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w))

  const sourceTokens = tokenize(srcLower)
  const candidateTokens = tokenize(candLower)
  if (sourceTokens.length === 0) return formBonus

  let matches = 0
  for (const token of sourceTokens) {
    if (candidateTokens.includes(token)) { matches += 1; continue }
    for (const ct of candidateTokens) {
      if (ct.length >= 3 && token.length >= 3 && (ct.includes(token) || token.includes(ct))) {
        matches += 0.7
        break
      }
    }
  }

  const tokenScore = matches / sourceTokens.length
  return Math.max(tokenScore, formBonus)
}

// -- Subcategory relevance ----------------------------------------

/**
 * Check if a candidate is from one of the preferred AH subcategories.
 */
function isInPreferredSubcategory(candidate, preferredSubCategories) {
  if (!candidate.categories || !Array.isArray(candidate.categories)) return false
  return preferredSubCategories.some(sub =>
    candidate.categories.includes('ah_sub:' + sub)
  )
}

// -- Core scoring & sorting ---------------------------------------

/**
 * Score and sort candidate products for recommendation quality.
 *
 * Scoring factors:
 *   1. Preferred AH subcategory match (+40)
 *   2. Name relevance / food-form match (x25)
 *   3. CO2 improvement over the current product (x3)
 *   4. Absolute CO2 score -- lower is better (x1)
 *
 * Filters out candidates with null score or worse score than current.
 */
function scoreAndSort(candidates, evaluateProduct, getEnrichedData, currentScore, sourceName, preferredSubCategories) {
  return candidates
    .map(c => {
      const enriched = getEnrichedData(c)
      const evaluation = evaluateProduct(c.name, enriched)
      const relevance = nameRelevance(sourceName, c.name)
      const improvement = (evaluation.score != null && currentScore != null)
        ? evaluation.score - currentScore
        : 0
      const inPreferred = isInPreferredSubcategory(c, preferredSubCategories || [])

      let rankScore = 0
      if (inPreferred) rankScore += 40
      rankScore += relevance * 25
      rankScore += improvement * 3
      rankScore += (evaluation.score != null) ? evaluation.score * 1 : 0

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
        isSwapCategory: true,
        improvement,
        relevance,
        rankScore
      }
    })
    .filter(c => {
      if (c.score == null) return false
      if (c.score <= currentScore) return false
      return true
    })
    .sort((a, b) => b.rankScore - a.rankScore)
}
