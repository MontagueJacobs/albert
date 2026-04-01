/**
 * CO2 Emissions Data for Food Products
 * 
 * Multi-source emission model:
 *   Primary: Agribalyse v3.2 (ADEME, French LCA) + OWID (Poore & Nemecek 2018, global)
 *   Validation: OWID range used to flag outliers
 * 
 * Values are in kg CO2 equivalent per kg of food product
 * These include all supply chain emissions: land use, farming, animal feed,
 * processing, transport, retail, packaging, and losses.
 */

import { getIngredientProfile, getOilSaturatedFraction, getProteinDensity } from './usda_ingredient_profiles.js'
import { AGRIBALYSE_EMISSIONS } from './agribalyse_emissions.js'

/**
 * EU & Netherlands Dietary Baseline
 * 
 * Calculated by combining:
 * 1. FAOSTAT dietary composition (kcal/person/day, 2021) via OWID API
 *    Source: https://ourworldindata.org/grapher/dietary-composition-by-country
 * 2. Caloric density (kcal/kg) per food category (USDA FoodData Central)
 * 3. CO2 emissions per kg from our CO2_EMISSIONS_DATA
 * 
 * Formula: For each food category:
 *   kg/day = kcal/day ÷ kcal_per_kg
 *   CO2/day = kg/day × CO2_per_kg
 *   Total = sum across all categories
 * 
 * These baselines allow comparing a user's grocery CO2 against the average consumer.
 */
const DIETARY_BASELINES = {
  eu27: {
    label: 'EU-27 Average',
    year: 2021,
    co2PerDay: 6.73,         // kg CO2-eq/person/day from food
    co2PerYear: 2456,        // kg CO2-eq/person/year from food
    co2PerKg: 2.71,          // weighted avg kg CO2-eq per kg of food consumed
    foodKgPerDay: 2.48,      // kg of food consumed per person per day
    // Breakdown by food group (% of total food CO2)
    breakdown: {
      dairy: 32.3,           // Milk products
      beef: 14.3,            // Beef & buffalo meat
      alcohol: 9.0,          // Alcoholic beverages
      pork: 8.7,             // Pig meat
      cereals: 5.5,          // Wheat, barley, maize, rice, other cereals
      sugar: 4.7,            // Sugar & sweeteners
      fats: 7.4,             // Animal fats + vegetable oils
      fruit: 3.5,            // Fruit
      poultry: 3.4,          // Poultry meat
      seafood: 3.4,          // Fish & seafood
      vegetables: 2.3,       // Vegetables
      eggs: 2.1,             // Eggs
      other_meat: 1.4,       // Sheep, goat, other meat
      other: 2.0             // Nuts, pulses, oilcrops, misc
    }
  },
  netherlands: {
    label: 'Netherlands Average',
    year: 2021,
    co2PerDay: 7.68,         // kg CO2-eq/person/day from food
    co2PerYear: 2802,        // kg CO2-eq/person/year from food
    co2PerKg: 2.86,          // weighted avg kg CO2-eq per kg of food consumed
    foodKgPerDay: 2.68,      // kg of food consumed per person per day
    breakdown: {
      dairy: 38.8,
      beef: 18.9,
      pork: 6.2,
      alcohol: 4.9,
      fats: 6.3,
      sugar: 4.4,
      fruit: 4.2,
      cereals: 4.7,
      eggs: 2.9,
      seafood: 2.5,
      vegetables: 2.1,
      poultry: 1.6,
      other_meat: 1.2,
      other: 1.3
    }
  }
}

/**
 * Parse a unit_size string (e.g. "500 g", "1.5 l", "150 ml", "2 stuks") into grams.
 * For liquids, assumes ~1 g/ml density (reasonable for beverages, milk, juice, sauces).
 * Returns null if parsing fails.
 * @param {string} unitSize - e.g. "500 g", "1,5 kg", "750 ml", "1 l", "2 stuks"
 * @returns {number|null} - weight in grams, or null
 */
function parseWeightGrams(unitSize) {
  if (!unitSize || typeof unitSize !== 'string') return null
  
  const s = unitSize.trim().toLowerCase().replace(',', '.')
  
  // Handle multi-pack format: "6 x 330 ml" → multiply count × volume
  const multiMatch = s.match(/(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(kilogram|gram|liter|milliliter|centiliter|deciliter|kg|g|l|ml|cl|dl)\b/)
  if (multiMatch) {
    const count = parseInt(multiMatch[1])
    const value = parseFloat(multiMatch[2])
    const unit = multiMatch[3]
    if (!isNaN(count) && !isNaN(value) && count > 0 && value > 0) {
      const perUnit = unitToGrams(value, unit)
      return perUnit !== null ? count * perUnit : null
    }
  }
  
  // Match number + unit patterns (supports both abbreviated and full Dutch/English words)
  const match = s.match(/(\d+(?:\.\d+)?)\s*(kilogram|gram|liter|milliliter|centiliter|deciliter|stuks?|st|kg|g|l|ml|cl|dl)\b/)
  if (!match) return null
  
  const value = parseFloat(match[1])
  const unit = match[2]
  
  if (isNaN(value) || value <= 0) return null
  
  return unitToGrams(value, unit)
}

function unitToGrams(value, unit) {
  switch (unit) {
    case 'kg':
    case 'kilogram': return value * 1000
    case 'g':
    case 'gram': return value
    case 'l':
    case 'liter': return value * 1000    // ~1g/ml for most food liquids
    case 'dl':
    case 'deciliter': return value * 100
    case 'cl':
    case 'centiliter': return value * 10
    case 'ml':
    case 'milliliter': return value
    case 'stuk':
    case 'stuks':
    case 'st':
      return null  // Can't determine weight from piece count alone
    default:
      return null
  }
}

/**
 * Default weights (in grams) per CO2 category.
 * Used when a product has no unit_size data (e.g., unpackaged fresh produce).
 * Values represent a typical single-purchase unit at a Dutch supermarket.
 */
const CATEGORY_DEFAULT_WEIGHTS = {
  // Fresh produce (sold loose or in small packs)
  'tomatoes': 500,
  'onions_leeks': 500,
  'root_vegetables': 500,
  'brassicas': 500,
  'other_vegetables': 300,
  'citrus_fruit': 500,
  'apples': 500,
  'bananas': 500,
  'berries_grapes': 300,
  'other_fruit': 300,
  'potatoes': 1000,
  
  // Meat (typical portions)
  'beef_herd': 400,
  'beef_dairy': 400,
  'lamb_mutton': 400,
  'pig_meat': 500,
  'poultry_meat': 500,
  
  // Seafood
  'shrimps_farmed': 200,
  'fish_farmed': 300,
  
  // Dairy
  'cheese': 400,
  'milk': 1000,         // 1L
  'eggs': 600,          // 10 stuks
  
  // Oils
  'olive_oil': 500,
  'sunflower_oil': 1000,
  'rapeseed_oil': 1000,
  'soybean_oil': 1000,
  'palm_oil': 500,
  
  // Grains/cereals
  'rice': 1000,
  'wheat_rye': 800,     // bread
  'oatmeal': 500,
  'maize': 500,
  'barley': 500,
  
  // Legumes/nuts
  'tofu': 400,
  'peas': 450,
  'other_pulses': 400,
  'groundnuts': 250,
  'nuts': 200,
  'soymilk': 1000,
  
  // Sugars
  'cane_sugar': 1000,
  'beet_sugar': 1000,
  'dark_chocolate': 200,
  
  // Beverages
  'coffee': 500,
  'wine': 750,
  'beer': 500,          // single or half-liter can
  'spirits': 700,
  'tea': 100,
  'soft_drinks': 1500,
  
  // Processed
  'sauces_condiments': 500,
  'ready_meals': 400,
  'soup': 500,
  'candy_sweets': 300,
  'ice_cream': 500,
  'baked_goods': 400,
  'desserts': 400,
  'spreads': 400,
  'snacks': 250,
  'baby_food': 400
}

/**
 * Get the weight in grams for a product, using:
 * 1. Parsed unit_size from product data (most accurate)
 * 2. Category default weight (fallback for loose produce etc.)
 * @param {string|null} unitSize - unit_size string from DB, e.g. "500 g"
 * @param {string|null} co2Category - matched CO2 category key
 * @returns {{ weightGrams: number|null, source: string }}
 */
function getProductWeight(unitSize, co2Category) {
  // Try parsing the unit_size first
  const parsed = parseWeightGrams(unitSize)
  if (parsed !== null) {
    return { weightGrams: parsed, source: 'unit_size' }
  }
  
  // Fall back to category default
  if (co2Category && CATEGORY_DEFAULT_WEIGHTS[co2Category]) {
    return { weightGrams: CATEGORY_DEFAULT_WEIGHTS[co2Category], source: 'category_default' }
  }
  
  // No weight data at all — use a generic fallback (400g ≈ average grocery item)
  return { weightGrams: 400, source: 'generic_default' }
}

// ── OWID Emission Factors ──
// Source: Poore & Nemecek (2018) via Our World in Data — global averages
// Includes all supply chain stages + land use change
const OWID_EMISSIONS = {
  'beef_herd': 99.48, 'beef_dairy': 33.30, 'lamb_mutton': 39.72,
  'pig_meat': 12.31, 'poultry_meat': 9.87,
  'shrimps_farmed': 26.87, 'fish_farmed': 13.63,
  'cheese': 23.88, 'milk': 3.15, 'eggs': 4.67,
  'palm_oil': 7.32, 'soybean_oil': 6.32, 'olive_oil': 5.42,
  'rapeseed_oil': 3.77, 'sunflower_oil': 3.60,
  'rice': 4.45, 'wheat_rye': 1.57, 'barley': 1.18, 'maize': 1.70, 'oatmeal': 2.48,
  'groundnuts': 3.23, 'other_pulses': 1.79, 'peas': 0.98, 'nuts': 0.43, 'tofu': 3.16,
  'berries_grapes': 1.53, 'citrus_fruit': 0.39, 'bananas': 0.86, 'apples': 0.43,
  'other_fruit': 1.05,
  'tomatoes': 2.09, 'brassicas': 0.51, 'onions_leeks': 0.50, 'potatoes': 0.46,
  'root_vegetables': 0.43, 'other_vegetables': 0.53, 'cassava': 1.32,
  'cane_sugar': 3.20, 'beet_sugar': 1.81,
  'coffee': 28.53, 'dark_chocolate': 46.65, 'wine': 1.79, 'beer': 1.20,
  'spirits': 2.50, 'tea': 1.00, 'soft_drinks': 0.80, 'soy_milk': 0.98,
  'sauces_condiments': 2.00, 'ready_meals': 4.50, 'soup': 2.00,
  'candy_sweets': 1.80, 'ice_cream': 3.50, 'baked_goods': 1.80,
  'spreads': 2.50, 'desserts': 3.00, 'baby_food': 3.00, 'snacks': 2.50,
}

// ── Multi-Source Emission Model ──
// Combines Agribalyse (primary LCA) + OWID (primary global) with OWID as validation.
// Structure per category:
//   primary: [{name, value}]  — LCA data sources used for the estimate
//   validation: {name, min, max} — independent range for cross-checking
//
// The 'mean' is the simple average of primary sources.
// OWID is used BOTH as a primary source AND for validation range.
// Agribalyse provides a tighter European-specific estimate.

/**
 * @typedef {Object} EmissionSource
 * @property {"Agribalyse"|"OWID"} name
 * @property {number} value - kgCO2e per kg
 */

/**
 * @typedef {Object} ValidationSource
 * @property {"OWID"} name
 * @property {number} min
 * @property {number} max
 */

/**
 * @typedef {Object} IngredientEmission
 * @property {EmissionSource[]} primary
 * @property {ValidationSource} [validation]
 */

/**
 * Compute the mean of primary emission sources.
 * @param {EmissionSource[]} sources
 * @returns {number}
 */
function computePrimaryMean(sources) {
  if (!sources || sources.length === 0) return 0
  return sources.reduce((sum, s) => sum + s.value, 0) / sources.length
}

/**
 * Compute the min/max range across primary sources.
 * @param {EmissionSource[]} sources
 * @returns {{ min: number, max: number }}
 */
function computePrimaryRange(sources) {
  if (!sources || sources.length === 0) return { min: 0, max: 0 }
  const values = sources.map(s => s.value)
  return { min: Math.min(...values), max: Math.max(...values) }
}

/**
 * Validate a mean estimate against an independent OWID range.
 * @param {number} mean
 * @param {ValidationSource} [validation]
 * @returns {{ valid: boolean, deviation: number }}
 */
function validateAgainstOWID(mean, validation) {
  if (!validation) return { valid: true, deviation: 0 }
  const withinRange = mean >= validation.min && mean <= validation.max
  return {
    valid: withinRange,
    deviation: mean < validation.min
      ? validation.min - mean
      : mean > validation.max
        ? mean - validation.max
        : 0
  }
}

/**
 * @typedef {Object} IngredientResult
 * @property {number} mean
 * @property {number} min
 * @property {number} max
 * @property {boolean} valid
 * @property {number} deviation
 * @property {EmissionSource[]} sources
 */

/**
 * Compute the emission result for a single ingredient category.
 * @param {IngredientEmission} ingredient
 * @returns {IngredientResult}
 */
function computeIngredient(ingredient) {
  const mean = computePrimaryMean(ingredient.primary)
  const { min, max } = computePrimaryRange(ingredient.primary)
  const validation = validateAgainstOWID(mean, ingredient.validation)
  return {
    mean,
    min,
    max,
    valid: validation.valid,
    deviation: validation.deviation,
    sources: ingredient.primary
  }
}

/**
 * Compute a product-level footprint from weighted ingredient portions.
 * @param {Array<{ingredient: IngredientEmission, fraction: number}>} portions
 * @returns {{ mean: number, min: number, max: number, valid: boolean }}
 */
function computeProduct(portions) {
  let mean = 0, min = 0, max = 0, valid = true
  for (const item of portions) {
    const result = computeIngredient(item.ingredient)
    mean += result.mean * item.fraction
    min  += result.min  * item.fraction
    max  += result.max  * item.fraction
    if (!result.valid) valid = false
  }
  return { mean, min, max, valid }
}

// Build MULTI_SOURCE_EMISSIONS: one entry per category with Agribalyse + OWID
const MULTI_SOURCE_EMISSIONS = {}

// Get all category keys from both sources
const allCategories = new Set([
  ...Object.keys(OWID_EMISSIONS),
  ...Object.keys(AGRIBALYSE_EMISSIONS)
])

for (const cat of allCategories) {
  const agri = AGRIBALYSE_EMISSIONS[cat]
  const owid = OWID_EMISSIONS[cat]
  
  // Primary: Agribalyse is the LCA source. OWID is validation-only unless
  // it's the only data we have for a category (e.g. beef_herd).
  const primary = []
  if (agri) {
    primary.push({ name: 'Agribalyse', value: agri.mean })
  } else if (owid != null) {
    // No Agribalyse data — fall back to OWID as primary
    primary.push({ name: 'OWID', value: owid })
  }
  
  // Validation: use OWID value as a single-point range (±50% to account for
  // methodological differences between global averages and European LCA)
  let validation = undefined
  if (owid != null) {
    validation = {
      name: 'OWID',
      min: owid * 0.5,
      max: owid * 1.5
    }
  }
  
  // Also incorporate Agribalyse min/max into the range if available
  let rangeMin, rangeMax
  if (agri && owid != null) {
    rangeMin = Math.min(agri.min, owid)
    rangeMax = Math.max(agri.max, owid)
  } else if (agri) {
    rangeMin = agri.min
    rangeMax = agri.max
  } else {
    rangeMin = owid
    rangeMax = owid
  }
  
  MULTI_SOURCE_EMISSIONS[cat] = {
    primary,
    validation,
    rangeMin,
    rangeMax,
    n: agri ? agri.n : 0
  }
}

/**
 * Get multi-source emission data for a category.
 * Returns { mean, min, max, valid, deviation, sources } or null.
 * @param {string} category
 * @returns {IngredientResult | null}
 */
function getEmission(category) {
  const entry = MULTI_SOURCE_EMISSIONS[category]
  if (!entry) return null
  return {
    ...computeIngredient(entry),
    rangeMin: entry.rangeMin,
    rangeMax: entry.rangeMax
  }
}

// CO2_EMISSIONS_DATA: backward-compatible single-value lookup.
// Uses the multi-source mean (average of Agribalyse + OWID where both exist).
const CO2_EMISSIONS_DATA = {}
for (const cat of allCategories) {
  const entry = MULTI_SOURCE_EMISSIONS[cat]
  CO2_EMISSIONS_DATA[cat] = computePrimaryMean(entry.primary)
}

// Dutch to English category keyword mappings
// Maps Dutch product keywords to CO2 categories
const PRODUCT_CATEGORY_KEYWORDS = {
  // Beef products
  'beef_herd': [
    'biefstuk', 'ribeye', 'entrecote', 'ossenhaas', 'bavette',
    'tournedos', 't-bone', 'tenderloin', 'rosbief', 'sukade',
    'rundertartaar', 'runderfilet', 'rund', 'beef', 'angus'
  ],
  'beef_dairy': [
    // Processed beef products often from dairy cattle
    'gehakt', 'hamburger', 'balkenbrij', 'rundvlees', 'stoofvlees',
    'draadjesvlees'
  ],
  
  // Lamb
  'lamb_mutton': [
    'lam', 'lamsvlees', 'lamsrack', 'lamskotelet', 'lamsschouder',
    'lamsbout', 'schaap', 'schapenvlees', 'lamb', 'mutton'
  ],
  
  // Pork
  'pig_meat': [
    'varken', 'ham', 'bacon', 'spek', 'worst', 'rookworst',
    'braadworst', 'knakworst', 'frankfurter', 'salami', 'chorizo',
    'karbonade', 'schnitzel', 'varkenshaas', 'spareribs', 'procureur',
    'lever', 'pate', 'gehaktbal', 'frikandel', 'frikadel',
    'pork', 'sausage', 'cervelaat', 'osseworst', 'rookvlees',
    'filet americain', 'casselerrib'
  ],
  
  // Poultry
  'poultry_meat': [
    'kip', 'kipfilet', 'kippenborst', 'kippenpoot', 'kippenbout',
    'kipgehakt', 'kipnuggets', 'kalkoen', 'eend', 'eendenborst',
    'chicken', 'turkey', 'duck', 'poultry', 'gevogelte'
  ],
  
  // Seafood
  'shrimps_farmed': [
    'garnaal', 'garnalen', 'shrimp', 'scampi', 'gamba',
    'noordzeegarnaal', 'hollandse garnaal', 'prawn'
  ],
  'fish_farmed': [
    'zalm', 'forel', 'tilapia', 'pangasius', 'zeebaars',
    'dorade', 'salmon', 'trout', 'vis', 'fish',
    'tonijn', 'tuna', 'makreel', 'haring', 'sardine',
    'kabeljauw', 'cod', 'heek', 'schol', 'bot',
    'kibbeling', 'lekkerbekje', 'visstick'
  ],
  
  // Dairy
  'cheese': [
    'kaas', 'cheese', 'gouda', 'edammer', 'brie', 'camembert',
    'mozzarella', 'parmezaan', 'parmesan', 'cheddar', 'feta',
    'geitenkaas', 'schapenkaas', 'roomkaas', 'smeerkaas',
    'cottage cheese', 'ricotta', 'mascarpone', 'gorgonzola',
    'blauwe kaas', 'blue cheese', 'manchego', 'pecorino'
  ],
  'milk': [
    'melk', 'milk', 'slagroom', 'koffiemelk',
    'yoghurt', 'yogurt', 'kwark', 'vla', 'custard',
    'karnemelk', 'buttermilk', 'creme fraiche', 'zure room',
    'boter', 'butter', 'margarine', 'roomboter',
    'zuivel', 'drinkyoghurt', 'optimel', 'chocomel',
    'wei', 'whey', 'weipoeder', 'lactose', 'caseïne', 'caseine',
    'room', 'magere melk', 'volle melk', 'halfvolle melk'
  ],
  'eggs': [
    'ei', 'eieren', 'eggs', 'omelet', 'roerei', 'gebakken ei',
    'hardgekookt', 'zachtgekookt',
    'vrije-uitloopei', 'vrije-uitloopeieren', 'uitloopei', 'uitloopeieren',
    'scharrelei', 'scharreleieren', 'biologisch ei',
    'eigeel', 'eiwit', 'eipoeder', 'ei-ingrediënt'
  ],
  
  // Oils
  'palm_oil': ['palmolie', 'palm oil', 'palmvet'],
  'soybean_oil': ['sojaolie', 'soybean oil', 'soja-olie'],
  'olive_oil': ['olijfolie', 'olive oil', 'olijven', 'olijf', 'kalamata', 'zwarte olijven', 'groene olijven'],
  'rapeseed_oil': ['raapzaadolie', 'koolzaadolie', 'rapeseed oil', 'canola'],
  'sunflower_oil': ['zonnebloemolie', 'sunflower oil'],
  
  // Grains
  'rice': ['rijst', 'rice', 'risotto', 'basmati', 'jasmine', 'sushi'],
  'wheat_rye': [
    'brood', 'bread', 'toast', 'croissant', 'stokbrood', 'baguette',
    'wrap', 'tortilla', 'pita', 'naan', 'bagel',
    'pasta', 'spaghetti', 'macaroni', 'penne', 'fusilli', 'tagliatelle',
    'lasagne', 'ravioli', 'gnocchi', 'couscous', 'tortelloni', 'tortellini',
    'meel', 'flour', 'tarwebloem', 'zelfrijzend bakmeel',
    'crackers', 'beschuit',
    'tarwe', 'wheat', 'rogge', 'rye', 'bloem',
    'durumtarwe', 'durumtarwegriesmeel', 'griesmeel', 'semolina',
    'spelt', 'tarwemeel', 'tarwezetmeel', 'gluten'
  ],
  'barley': ['gerst', 'barley', 'gort'],
  'maize': ['mais', 'corn', 'polenta', 'tortilla chips', 'nachos'],
  'oatmeal': ['haver', 'oat', 'havermout', 'oatmeal', 'muesli', 'granola'],
  
  // Legumes
  'groundnuts': ['pinda', 'peanut', 'pindakaas', 'peanut butter'],
  'other_pulses': [
    'bonen', 'beans', 'kidney', 'zwarte bonen', 'witte bonen',
    'linzen', 'lentils', 'kikkererwten', 'chickpeas', 'hummus',
    'falafel', 'tempeh'
  ],
  'peas': ['erwten', 'peas', 'doperwten', 'spliterwten', 'peultjes'],
  'nuts': [
    'noten', 'nuts', 'amandelen', 'almonds', 'walnoten', 'walnuts',
    'cashew', 'hazelnoten', 'hazelnuts', 'pistache', 'pistachio',
    'pecannoten', 'macadamia', 'paranoten',
    'sesam', 'sesamzaad', 'tahin', 'tahini', 'sesampasta'
  ],
  'tofu': [
    'tofu', 'tahoe', 'tempeh', 'seitan',
    'plantaardig', 'plantaardige', 'plant-based', 'vegan schnitzel',
    'vegan burger', 'vegan gehakt', 'vegaburger', 'vegetarische schnitzel',
    'beyond meat', 'impossible', 'vivera', 'garden gourmet', 'terra',
    'vega stuk', 'vega schnitzel', 'vega burger', 'vega gehakt',
    'sojaprotein', 'soja-eiwit', 'tarwe-eiwit', 'erwtenprotein'
  ],
  
  // Fruits
  'berries_grapes': [
    'aardbei', 'aardbeien', 'strawberry',
    'framboos', 'frambozen', 'raspberry',
    'bosbes', 'bosbessen', 'blueberry',
    'braam', 'bramen', 'braambessen', 'blackberry',
    'druif', 'druiven', 'grape', 'pitloze druiven',
    'bes', 'bessen', 'berry',
    'rozijn', 'raisin', 'krent', 'krenten',
    'rode bessen', 'zwarte bessen', 'kruisbessen'
  ],
  'citrus_fruit': [
    'sinaasappel', 'sinaasappelen', 'sinaasappels',
    'handsinaasappel', 'handsinaasappelen', 'bloedsinaasappel',
    'orange', 'citroen', 'citroenen', 'lemon', 'limoen', 'lime',
    'grapefruit', 'mandarijn', 'mandarijnen', 'tangerine',
    'clementine', 'clementines', 'pompelmoes'
  ],
  'bananas': ['banaan', 'bananen', 'banana', 'plantain', 'bakbanaan', 'bakbananen'],
  'apples': [
    'appel', 'appels', 'appelen', 'apple',
    'peer', 'peren', 'pear',
    'jonagold', 'elstar', 'braeburn', 'fuji', 'gala',
    'golden delicious', 'granny smith', 'goudrenet', 'goudrenetten', 'goudreinette', 'goudreinetten',
    'conference', 'stoofpeer', 'stoofperen'
  ],
  'other_fruit': [
    'mango', 'ananas', 'pineapple', 'meloen', 'melon', 'watermeloen',
    'kiwi', 'papaya', 'passievrucht', 'passion fruit', 'lychee', 'lychees',
    'granaatappel', 'pomegranate', 'vijg', 'vijgen', 'fig', 'dadel', 'dadels', 'date',
    'pruim', 'pruimen', 'plum', 'kers', 'kersen', 'cherry',
    'abrikoos', 'abrikozen', 'apricot',
    'perzik', 'perziken', 'peach', 'nectarine', 'nectarines',
    'kokos', 'coconut',
    'kaki', 'sharon', 'sharonfruit', 'rabarber',
    'guave', 'physalis', 'pitahaya', 'drakenvrucht'
  ],
  
  // Vegetables
  'tomatoes': [
    'tomaat', 'tomaten', 'tomato', 'tomatenpuree', 'passata',
    'trostomaat', 'trostomaten', 'cherrytomaat', 'cherrytomaten',
    'cocktailtomaat', 'cocktailtomaatjes', 'tomaatje', 'tomaatjes',
    'kerstomaat', 'kerstomaten', 'vleestomaat', 'vleestomaten',
    'san marzano', 'pomodori'
  ],
  'brassicas': [
    'broccoli', 'bloemkool', 'cauliflower', 'kool', 'cabbage',
    'spruitjes', 'brussels sprouts', 'boerenkool', 'kale',
    'spinazie', 'spinach', 'andijvie', 'paksoi', 'chinese kool'
  ],
  'onions_leeks': [
    'ui', 'uien', 'onion', 'prei', 'leek', 'sjalot', 'shallot',
    'knoflook', 'garlic', 'bieslook', 'chive', 'lente-ui', 'spring onion',
    'bosui', 'bosuitjes'
  ],
  'potatoes': [
    'aardappel', 'potato', 'friet', 'fries', 'patat',
    'puree', 'mash', 'chips', 'aardappelpuree', 'rösti',
    'zoete aardappel'
  ],
  'root_vegetables': [
    'wortel', 'carrot', 'pastinaak', 'parsnip', 'knolselderij',
    'celeriac', 'biet', 'beet', 'radijs', 'radish', 'raap', 'turnip',
    'gember', 'gemberwortel', 'ginger',
    'winterpeen', 'winterwortel'
  ],
  'other_vegetables': [
    'sla', 'lettuce', 'salade', 'salad', 'komkommer', 'cucumber',
    'paprika', 'pepper', 'courgette', 'zucchini', 'aubergine', 'eggplant',
    'pompoen', 'pumpkin', 'asperge', 'asparagus', 'champignon', 'mushroom',
    'venkel', 'fennel', 'artisjok', 'artichoke', 'avocado',
    'maïskolf', 'groente', 'vegetable', 'groentemix',
    'selderij', 'bleekselderij',
    // Leafy greens & salad vegetables
    'rucola', 'veldsla', 'witlof', 'ijsbergsla',
    // Compound produce names (to beat false-positive processed food matches)
    'snackkomkommer', 'snackgroente', 'snoepgroente', 'snackpaprika',
    'roerbakgroente', 'wokgroente',
    // Other vegetables & produce
    'romanesco', 'bataat', 'peper', 'jalapeño', 'pepertje',
    'peterselie', 'dille', 'kervel'
  ],
  
  // Sugar
  'cane_sugar': ['rietsuiker', 'cane sugar', 'ruwe suiker', 'muscovado'],
  'beet_sugar': ['suiker', 'sugar', 'kristalsuiker', 'poedersuiker', 'basterdsuiker'],
  
  // Beverages & Other
  'coffee': ['koffie', 'coffee', 'espresso', 'cappuccino', 'latte'],
  'dark_chocolate': ['chocola', 'chocolate', 'cacao', 'cocoa', 'hagelslag', 'chocopasta', 'nutella'],
  'wine': [
    'wijn', 'wine', 'prosecco', 'champagne', 'port', 'sherry',
    'cabernet', 'sauvignon', 'merlot', 'syrah', 'shiraz', 'pinot',
    'chardonnay', 'tempranillo', 'malbec', 'riesling', 'grenache',
    'carménère', 'carmenere', 'rioja', 'bordeaux', 'burgundy',
    'chablis', 'chianti', 'barolo', 'sangiovese', 'zinfandel'
  ],
  'beer': ['bier', 'pils', 'radler', 'witbier', 'ipa', 'weizen', 'heineken', 'amstel', 'grolsch', 'hertog jan', 'palm bier', 'palm speciale', 'jupiler', 'duvel'],
  'spirits': ['jenever', 'vodka', 'rum', 'whisky', 'whiskey', 'gin', 'likeur', 'baileys', 'tequila', 'cognac', 'glühwein', 'advocaat'],
  'tea': ['thee', 'tea', 'rooibos', 'kamille', 'munt thee', 'groene thee', 'earl grey'],
  'soft_drinks': [
    'frisdrank', 'cola', 'sinas', 'limonade', 'cassis', 'rivella',
    'energy drink', 'red bull', 'tonic', 'bitter lemon', 'fanta', 'sprite',
    'pepsi', '7up', '7-up', 'fernandes', 'raak', 'roosvicee',
    'dubbelfris', 'ice tea', 'fuze', 'spa', 'mineraalwater', 'bronwater',
    'sourcy', 'bar le duc', 'chaudfontaine'
  ],
  'soy_milk': ['sojamelk', 'soy milk', 'sojadrink', 'havermelk', 'oat milk', 'amandelmelk', 'almond milk', 'plantaardig melk', 'rijstmelk', 'kokomelk', 'alpro'],
  
  // Sauces, Condiments & Spices
  'sauces_condiments': [
    'saus', 'sauce', 'mayonaise', 'mayo', 'mosterd', 'mustard',
    'fritessaus', 'barbecuesaus', 'ketchup', 'currysaus',
    'satésaus', 'pesto', 'jus', 'dressing', 'vinaigrette',
    'piccalilly', 'tzatziki', 'hoisin', 'tabasco', 'sriracha',
    'sambal', 'chilisaus', 'cocktailsaus', 'oestersaus', 'sojasaus',
    'ketjap', 'worcestershire', 'bearnaise', 'tartaar saus',
    'azijn', 'balsamico', 'kruiden', 'specerijen',
    'kaneel', 'nootmuskaat', 'komijn', 'kerrie', 'paprikapoeder',
    'oregano', 'basilicum', 'tijm', 'rozemarijn', 'zout', 'zeezout', 'joodzout'
  ],
  
  // Ready meals & Soups
  'ready_meals': [
    'maaltijd', 'magnetron', 'pizza', 'nasi', 'bami',
    'noodles', 'ramen', 'dim sum', 'loempia', 'spring roll',
    'bapao', 'tosti', 'wereldgerecht', 'stamppot',
    'ovenschotel', 'roerbakschotel', 'wokschotel',
    'maaltijdsalade', 'bentobox'
  ],
  'soup': [
    'soep', 'soup', 'bouillon', 'cup-a-soup', 'soepstengel'
  ],
  
  // Baked goods & Baking ingredients
  'baked_goods': [
    'stroopwafel', 'speculaas', 'brownie', 'muffin', 'cake',
    'donut', 'pannenkoek', 'poffertjes', 'wafel', 'waffle',
    'petit beurre', 'digestive', 'taart', 'vlaai',
    'punt', 'tompouce', 'eclair', 'moorkop', 'appelflap',
    'saucijzenbroodje', 'worstenbroodje', 'frikandelbroodje',
    'panko', 'paneermeel', 'maizena', 'gelatine', 'bakpoeder',
    'vanillesuiker', 'gist', 'tapioca', 'koekje', 'koekjes', 'koek',
    'biscuit', 'gevulde koek', 'ontbijtkoek'
  ],
  
  // Candy & Sweets
  'candy_sweets': [
    'drop', 'snoep', 'zuurtjes', 'toffee', 'kauwgom',
    'haribo', 'mentos', 'tic tac', 'pepermunt', 'winegum',
    'lollipop', 'marshmallow', 'lakritze', 'fruittella'
  ],
  
  // Ice cream
  'ice_cream': [
    'ijs', 'ijsje', 'magnum', 'cornetto', 'raket',
    'sorbet', 'gelato', 'ijstaart'
  ],
  
  // Desserts
  'desserts': [
    'pudding', 'panna cotta', 'tiramisu', 'mousse',
    'griesmeelpudding', 'toetje', 'dessert', 'crème', 'creme dessert'
  ],
  
  // Spreads
  'spreads': [
    'jam', 'confituur', 'marmelade', 'honing', 'honey',
    'stroop', 'sandwichspread', 'smeerkaas', 'leverworst'
  ],
  
  // Snacks
  'snacks': [
    'chips', 'nootjes', 'borrelnoot', 'popcorn', 'pretzel',
    'kroepoek', 'fuet', 'zoute sticks', 'paprika chips',
    'biologisch chips', 'pringles', 'doritos', 'cheetos',
    'bittergarnituur', 'bitterballen', 'kaassoufflé',
    'kroket', 'nasischijf', 'snack', 'ringz', 'wokkels'
  ],
  
  // Baby food
  'baby_food': [
    'baby', 'flesvoeding', 'nutrilon', 'bambix', 'olvarit',
    'babyvoeding', 'opvolgmelk'
  ]
}

// Score thresholds (kg CO2/kg to 0-10 score)
// Lower CO2 = higher score
const SCORE_THRESHOLDS = [
  { maxCO2: 1.0, score: 10 },   // < 1 kg CO2/kg = score 10 (excellent)
  { maxCO2: 2.0, score: 9 },    // 1-2 kg = score 9
  { maxCO2: 4.0, score: 8 },    // 2-4 kg = score 8
  { maxCO2: 6.0, score: 7 },    // 4-6 kg = score 7
  { maxCO2: 10.0, score: 6 },   // 6-10 kg = score 6
  { maxCO2: 15.0, score: 5 },   // 10-15 kg = score 5
  { maxCO2: 25.0, score: 4 },   // 15-25 kg = score 4
  { maxCO2: 40.0, score: 3 },   // 25-40 kg = score 3
  { maxCO2: 60.0, score: 2 },   // 40-60 kg = score 2
  { maxCO2: 100.0, score: 1 },  // 60-100 kg = score 1
  { maxCO2: Infinity, score: 0 } // > 100 kg = score 0 (worst)
]

/**
 * Get CO2 emissions category from product name
 * @param {string} productName - The product name (in Dutch or English)
 * @returns {string|null} - Category key or null if not matched
 */
// Non-food items that should be excluded from CO2 scoring
const NON_FOOD_KEYWORDS = [
  // Household cleaning
  'afwasmiddel', 'allesreiniger', 'schoonmaak', 'wasmiddel', 'wasverzachter',
  'vlekken', 'toiletpapier', 'keukenpapier', 'zakdoekjes', 'vaatwas',
  'handzeep', 'douchegel', 'shampoo', 'conditioner', 'deodorant',
  'tandpasta', 'tandenborstel', 'mondwater', 'scheermesje', 'maandverband',
  'luier', 'batterij', 'vuilniszak', 'aluminiumfolie', 'bakpapier',
  'huishoudfolie', 'waxinelicht', 'dreft', 'persil', 'robijn',
  'swiffer', 'bleekmiddel', 'bleekwater', 'dikbleek', 'ontkalker', 'wc-blok', 'vaatdoek',
  'spons', 'handschoen', 'prullenbak', 'stofzuig',
  'wasdoek', 'waslijn', 'wasknijper', 'schuurspons', 'poetsdoek', 'strijkwater',
  'geurverspreider', 'geurstokjes', 'luchtverfrisser', 'geurkaars',
  'vuilniszakken', 'pedaalemmerzak', 'kattenbak', 'kattenbakvulling',
  // Health & personal care
  'vitamine', 'paracetamol', 'ibuprofen', 'pleister', 'hoestdrank',
  'keelpastille', 'neusspray', 'davitamon', 'magnesium', 'ijzertablet',
  'zonnebrand', 'bodylotion', 'gezichtscreme', 'gezichtscr',
  'tablet 200mg', 'tablet 400mg', 'tablet 500mg', 'capsule',
  'oogdruppel', 'oordruppel', 'wondverband', 'verband',
  'dagcreme', 'nachtcreme', 'haargel', 'haarspray', 'haarlak',
  'scheerschuim', 'aftershave', 'parfum', 'eau de toilette',
  'tampons', 'inlegkruisjes', 'washandjes', 'wattenstaafjes', 'wattenschijfjes',
  'douchecrème', 'badschuim', 'handcreme', 'lipbalsem',
  'haarkleuring', 'nagellak', 'make-up', 'mascara', 'foundation',
  // Pet food & care
  'hondenvoer', 'hondenbrok', 'hondenstick', 'kattenvoer', 'kattenbrok',
  'kattensnack', 'whiskas', 'pedigree', 'vogelvoer', 'dierenvoer',
  // Baby non-food
  'luiers', 'babydoekjes', 'billendoekjes',
  // Kitchen/household items
  'vershoudfolie', 'diepvrieszak', 'cadeaupapier', 'kaars', 'aansteker',
  'paperclip', 'elastiek', 'plakband', 'tape'
]

/**
 * Check if product is a non-food item (should be excluded from CO2 scoring)
 */
function isNonFood(productName) {
  if (!productName) return false
  const lower = productName.toLowerCase()
  return NON_FOOD_KEYWORDS.some(kw => lower.includes(kw))
}

// Fallback category mapping: broad food-type keywords → generic CO2 category
const FALLBACK_CATEGORIES = [
  // Meat / animal keywords
  { keywords: ['vlees', 'meat', 'filet', 'biefstuk', 'steak'], category: 'pig_meat' },
  // Dairy keywords  
  { keywords: ['zuivel', 'dairy', 'room', 'cream'], category: 'milk' },
  // Fruit keywords
  { keywords: ['fruit', 'vruchten', 'fruitsalade', 'vruchtensap'], category: 'other_fruit' },
  // Vegetable keywords
  { keywords: ['groente', 'groenten', 'vegetable', 'salade', 'sla'], category: 'other_vegetables' },
  // Grain/bread keywords
  { keywords: ['graan', 'grain', 'ontbijt', 'breakfast', 'cereal', 'muesli'], category: 'wheat_rye' },
  // Oil keywords
  { keywords: ['olie', 'oil'], category: 'olive_oil' },
  // Juice/drink keywords
  { keywords: ['sap', 'juice', 'drank', 'drink', 'smoothie', 'vruchtendrank'], category: 'soft_drinks' },
  // Fish keywords
  { keywords: ['vis', 'fish', 'zeevruchten', 'seafood'], category: 'fish_farmed' },
  // Legume keywords
  { keywords: ['bonen', 'linzen', 'peulvrucht', 'pulse'], category: 'other_pulses' },
  // Nut keywords
  { keywords: ['noten', 'noot', 'nut'], category: 'nuts' },
  // Snack fallback
  { keywords: ['snack', 'tussendoor', 'borrel'], category: 'snacks' },
  // Sugar/sweet fallback (not 'zoet' - too many false positives like 'zoete appeltjes')
  { keywords: ['sweet', 'suiker', 'sugar', 'snoep', 'candy'], category: 'beet_sugar' },
]

// Category priority - higher priority wins when keywords from multiple categories match
// Processed/composite categories should beat raw ingredient categories
const CATEGORY_PRIORITY = {
  // Highest priority: processed food categories (product type > ingredient)
  'ready_meals': 10,
  'soup': 10,
  'snacks': 9,
  'baked_goods': 9,
  'candy_sweets': 9,
  'ice_cream': 9,
  'desserts': 9,
  'sauces_condiments': 8,
  'spreads': 8,
  'baby_food': 8,
  // Medium: specific food types
  'beer': 7,
  'spirits': 7,
  'tea': 7,
  'soft_drinks': 7,
  'coffee': 7,
  'wine': 7,
  'dark_chocolate': 7,
  // Default priority for raw ingredients/foods
  // (everything else gets priority 5)
}

function getCategoryPriority(category) {
  return CATEGORY_PRIORITY[category] || 5
}

function getCO2Category(productName) {
  if (!productName) return null
  // Decode URI-encoded characters (e.g. Carme%CC%81ne%CC%80re → Carménère)
  let decoded = productName
  try { decoded = decodeURIComponent(productName) } catch(e) { /* not URI-encoded */ }
  const lower = decoded.toLowerCase()
  
  // First: exclude non-food items
  if (isNonFood(productName)) return '__non_food__'
  
  // Second: try exact keyword matches (most specific)
  let bestMatch = null
  let bestMatchLength = 0
  let bestPriority = 0
  
  for (const [category, keywords] of Object.entries(PRODUCT_CATEGORY_KEYWORDS)) {
    for (const keyword of keywords) {
      // Match whole words or word boundaries
      // For very short keywords (≤3 chars), require word boundary on BOTH sides
      // to prevent false positives like 'ui' matching inside 'uitloopei'
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const regex = keyword.length <= 3
        ? new RegExp(`\\b${escaped}\\b`, 'i')
        : new RegExp(`\\b${escaped}`, 'i')
      if (regex.test(lower)) {
        const priority = getCategoryPriority(category)
        // A much longer keyword match (>2x) is likely more specific and should win
        // even against higher-priority categories (e.g. 'ijsbergsla' > 'ijs')
        const newIsMuchLonger = keyword.length >= bestMatchLength * 2
        const currentIsMuchLonger = bestMatch && bestMatchLength >= keyword.length * 2
        if (newIsMuchLonger ||
            (!currentIsMuchLonger && (priority > bestPriority || (priority === bestPriority && keyword.length > bestMatchLength)))) {
          bestMatch = category
          bestMatchLength = keyword.length
          bestPriority = priority
        }
      }
    }
  }
  
  if (bestMatch) return bestMatch
  
  // Third: try fallback broad categories
  for (const fb of FALLBACK_CATEGORIES) {
    for (const kw of fb.keywords) {
      if (lower.includes(kw)) {
        return fb.category
      }
    }
  }
  
  return null
}

// ============================================================================
// INGREDIENT-BASED CO2 SCORING
// ============================================================================
// EU law requires ingredients listed in descending order by weight.
// We parse the ingredient list, match each ingredient to a CO2 category,
// and compute a weighted-average CO2 using estimated ingredient proportions.

/**
 * Parse an ingredient string into individual ingredient entries.
 * Dutch ingredient lists use commas to separate, with parentheses for sub-ingredients.
 * Example: "TARWEBLOEM, water, 13% tomaten, mozzarella (MELK), basilicum, olijfolie"
 * 
 * @param {string} ingredientText - Raw ingredient text from the product page
 * @returns {Array<{name: string, percentage: number|null, position: number}>}
 */
function parseIngredients(ingredientText) {
  if (!ingredientText || typeof ingredientText !== 'string') return []
  
  // Collapse newlines to spaces first (scraped text often has line breaks)
  let text = ingredientText.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
  
  // Remove all occurrences of "Ingrediënten" / "Ingredients" headers/labels
  // (scraped text often has "Ingrediënten  Ingrediënten: ...")
  text = text
    .replace(/ingredi[ëe]nten\s*[:;]?\s*/gi, '')
    .replace(/ingredients\s*[:;]?\s*/gi, '')
    .trim()
  
  // Remove trailing allergen/nutritional notes
  // "Allergie-informatie Bevat:...", "Kan bevatten:...", "Waarvan toegevoegde..."
  text = text
    .replace(/\s*allergie-informatie\b.*/si, '')
    .replace(/\s*(Kan bevatten|Bevat|Allergenen)\s*[:].*/si, '')
    .replace(/\s*voedingswaarde\b.*/si, '')
    .replace(/\s*\.?\s*waarvan toegevoegde\b.*/si, '')
    .trim()
  
  // Remove product claims that aren't ingredients:
  // "Vrij van melk en soja" (Free from milk and soy)
  // "*Van biologische landbouw" (From organic agriculture)
  // "**Op basis van ..." footnotes
  text = text
    .replace(/\s*\.?\s*vrij van\b.*/si, '')  // "Vrij van melk en soja."
    .replace(/\s*\.?\s*\*+\s*van\s+(biologische|duurzame|gecertificeerde)\b.*/si, '') // "*Van biologische landbouw"
    .replace(/\s*\.?\s*\*+\s*[A-Z].*/s, '')  // Generic footnote markers "*From..."
    .replace(/\s*\.?\s*bevat geen\b.*/si, '')  // "Bevat geen ..."
    .trim()
  
  // Remove trailing period
  text = text.replace(/\.\s*$/, '')
  
  // Split by commas, but not commas inside parentheses/brackets
  const parts = []
  let depth = 0
  let current = ''
  
  for (const ch of text) {
    if (ch === '(' || ch === '[') {
      depth++
      current += ch
    } else if (ch === ')' || ch === ']') {
      depth = Math.max(0, depth - 1)
      current += ch
    } else if (ch === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) parts.push(current.trim())
  
  // Parse each part: extract percentage if present, clean up the name
  // Some Dutch labels use sections like "Deeg 55% (TARWEBLOEM, EIEREN, water)"
  // where the real ingredients are inside parentheses. We expand these.
  const GENERIC_SECTIONS = new Set([
    'deeg', 'vulling', 'saus', 'coating', 'glazuur', 'crème', 'creme',
    'ragout', 'marinade', 'broodkruim', 'panering', 'topping', 'beleg',
    'garnering', 'deksel', 'bodem', 'massa'
  ])
  
  const ingredients = []
  for (let i = 0; i < parts.length; i++) {
    let part = parts[i]
    if (!part) continue
    
    // Extract percentage: "13% tomaten" or "tomaten 13%" or "tomaten (13%)"
    let percentage = null
    const pctMatch = part.match(/(\d+[\.,]?\d*)\s*%/) 
    if (pctMatch) {
      percentage = parseFloat(pctMatch[1].replace(',', '.'))
      part = part.replace(pctMatch[0], '').trim()
    }
    
    // Check if this is a generic section with sub-ingredients in parentheses
    // e.g. "Deeg (TARWEBLOEM, EIEREN, water)" → expand sub-ingredients
    const parenMatch = part.match(/^(\w[\w\s-]*?)\s*\((.+)\)\s*$/)
    if (parenMatch) {
      const sectionName = parenMatch[1].trim().toLowerCase()
      const subIngredientText = parenMatch[2]
      
      if (GENERIC_SECTIONS.has(sectionName)) {
        // Expand: split sub-ingredients by comma and add them individually
        const subParts = subIngredientText.split(',').map(s => s.trim()).filter(Boolean)
        const sectionWeight = percentage || null
        
        for (let j = 0; j < subParts.length; j++) {
          let subPart = subParts[j]
          // Extract sub-percentage if any
          let subPct = null
          const subPctMatch = subPart.match(/(\d+[\.,]?\d*)\s*%/)
          if (subPctMatch) {
            subPct = parseFloat(subPctMatch[1].replace(',', '.'))
            subPart = subPart.replace(subPctMatch[0], '').trim()
          }
          
          const subName = subPart
            .replace(/\([^)]*\)/g, '')
            .replace(/\[[^\]]*\]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase()
          
          if (subName.length < 2) continue
          
          // If section had a percentage and sub-ingredient has one, combine
          // Otherwise estimate based on position within section
          let effectivePct = subPct
          if (sectionWeight && !subPct) {
            // Estimate: first sub-ingredient gets most of section weight
            const decay = Math.pow(0.6, j)
            effectivePct = null // Will be estimated by position later
          }
          
          ingredients.push({
            name: subName,
            percentage: effectivePct,
            position: ingredients.length
          })
        }
        continue // Skip adding the generic section itself
      }
    }
    
    // Remove sub-ingredient parenthetical notes: "mozzarella (MELK, zout)" → "mozzarella"
    const name = part
      .replace(/\([^)]*\)/g, '')   // Remove parenthetical sub-ingredients
      .replace(/\[[^\]]*\]/g, '')  // Remove bracketed notes
      .replace(/[*#†‡§]+/g, '')   // Remove footnote markers: "HAVER*" → "HAVER"
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
    
    if (name.length < 2) continue  // Skip single-letter entries
    
    ingredients.push({
      name,
      percentage,
      position: i  // 0-based position (first = most by weight)
    })
  }
  
  return ingredients
}

/**
 * Estimate weight proportions for ingredients based on EU labeling rules.
 * EU law: ingredients are listed in descending order by weight.
 * If specific percentages are given, use those. Otherwise estimate using 
 * a decreasing geometric series, constrained by:
 *   1. Ordering: undeclared ingredients after a declared % must be ≤ that %
 *   2. Each subsequent undeclared ingredient ≤ previous undeclared ingredient
 *   3. Nutritional hints: oil ≤ fat content, salt ≤ declared salt
 * 
 * @param {Array} ingredients - Parsed ingredients from parseIngredients()
 * @param {Object} nutritionHints - Optional {fatPct, saltPct} from label
 * @returns {Array<{name: string, category: string|null, co2PerKg: number|null, weightFraction: number}>}
 */
function estimateIngredientWeights(ingredients, nutritionHints = null) {
  if (!ingredients || ingredients.length === 0) return []
  
  const n = ingredients.length
  
  // First pass: collect known percentages, match CO2 categories, and get multi-source data
  const enriched = ingredients.map(ing => {
    const category = getCO2Category(ing.name)
    const co2PerKg = (category && category !== '__non_food__' && CO2_EMISSIONS_DATA[category]) 
      ? CO2_EMISSIONS_DATA[category] 
      : null
    const emission = (category && category !== '__non_food__') ? getEmission(category) : null
    return {
      ...ing,
      category,
      co2PerKg,
      emission  // { mean, min, max, rangeMin, rangeMax, valid, deviation, sources }
    }
  })
  
  // Second pass: determine the ceiling for each position.
  // EU law: ingredients are in descending weight order.
  // If ingredient i has a declared percentage P, all ingredients at position > i must be ≤ P.
  // If ingredient i has no declared percentage, it must be ≤ previous ingredient's weight.
  let ceiling = 100 // Maximum possible weight for current position
  const ceilings = []
  for (let i = 0; i < enriched.length; i++) {
    if (enriched[i].percentage != null) {
      ceiling = enriched[i].percentage
    }
    ceilings.push(ceiling)
  }
  
  // Apply nutritional caps to specific ingredient types
  // Oil/fat ingredients can't exceed the total fat content
  // Salt can't exceed the declared salt content
  // Protein sources can't exceed protein content (with conversion factor)
  // Sugar ingredients can't exceed sugar content
  // Grain/starch can't exceed total carbs
  const OIL_CATEGORIES = new Set(['olive_oil', 'rapeseed_oil', 'sunflower_oil', 'soybean_oil', 'palm_oil'])
  const OIL_KEYWORDS = ['olie', 'oil', 'boter', 'butter', 'margarine', 'room', 'cream', 'slagroom', 'crème']
  const SALT_KEYWORDS = ['zout', 'salt', 'zeezout', 'joodzout', 'natriumchloride']
  
  // Protein-rich ingredients: meat (~20-25% protein), dairy (~3-25%), legumes (~8-25%), eggs (~13%)
  // We use a conversion: if label says X g protein, max meat weight ≈ X/0.20 = 5*X
  // But simpler: protein-rich ingredients can't contribute more protein than the label shows
  const PROTEIN_CATEGORIES = new Set([
    'beef', 'lamb', 'pork', 'poultry', 'fish', 'shrimp', 'cheese', 'eggs',
    'tofu', 'nuts', 'groundnuts', 'soymilk'
  ])
  const PROTEIN_KEYWORDS = [
    'vlees', 'meat', 'kip', 'chicken', 'rund', 'beef', 'varken', 'pork',
    'vis', 'fish', 'zalm', 'salmon', 'tonijn', 'tuna', 'garnaal', 'shrimp',
    'ei', 'egg', 'eieren', 'kaas', 'cheese', 'kwark', 'yoghurt',
    'tofu', 'tempeh', 'soja', 'soy', 'linzen', 'lentils', 'kikkererwt', 'chickpea',
    'bonen', 'beans', 'noten', 'nuts', 'amandel', 'almond', 'cashew',
    'pinda', 'peanut', 'walnoot', 'walnut', 'erwt', 'pea',
    'melk', 'milk', 'wei', 'whey', 'caseïne', 'casein'
  ]
  // Typical protein content by ingredient type (g protein per 100g ingredient)
  // Now sourced from USDA FoodData Central via usda_ingredient_profiles.js
  // Fallback values only used when USDA profile not found
  const PROTEIN_DENSITY_FALLBACK = {
    beef: 0.17, lamb: 0.20, pork: 0.21, poultry: 0.22, fish: 0.20, shrimp: 0.20,
    cheese: 0.25, eggs: 0.13, milk: 0.03,
    tofu: 0.16, nuts: 0.20, groundnuts: 0.26, soymilk: 0.03,
  }
  
  // Sugar ingredients: sugar, siroop, honing, glucose, fructose, etc.
  const SUGAR_KEYWORDS = [
    'suiker', 'sugar', 'siroop', 'syrup', 'stroop', 'honing', 'honey',
    'glucose', 'fructose', 'dextrose', 'maltose', 'lactose', 'saccharose',
    'agave', 'maltodextrine', 'isoglucose'
  ]
  const SUGAR_CATEGORIES = new Set(['cane_sugar', 'beet_sugar'])
  
  // Starch/grain/flour ingredients  
  const CARB_KEYWORDS = [
    'meel', 'flour', 'bloem', 'tarwe', 'wheat', 'rijst', 'rice',
    'mais', 'corn', 'maize', 'haver', 'oat', 'gerst', 'barley',
    'rogge', 'rye', 'griesmeel', 'semolina', 'aardappel', 'potato',
    'zetmeel', 'starch', 'pasta', 'couscous', 'bulgur', 'quinoa',
    'boekweit', 'buckwheat', 'spelt'
  ]
  const CARB_CATEGORIES = new Set([
    'wheat', 'rice', 'maize', 'oatmeal', 'potatoes', 'cassava', 'bread'
  ])
  
  // Fiber-rich ingredients
  const FIBER_KEYWORDS = [
    'vezels', 'fiber', 'zemelen', 'bran', 'psyllium', 'inuline', 'inulin',
    'cellulose', 'pectine', 'pectin'
  ]
  
  // Trace ingredients: always present in tiny amounts (< 2%), regardless of product
  // These get a hard ceiling even without nutritional data
  const TRACE_KEYWORDS = [
    'vitamine', 'vitamin', 'riboflavine', 'thiamine', 'niacine', 'foliumzuur',
    'kaliumjodide', 'niacinamide', 'pyridoxine', 'cobalamine', 'biotine',
    'aroma', 'kleurstof', 'emulgator', 'verdikkingsmiddel', 'stabilisator',
    'antioxidant', 'conserveermiddel', 'zuurteregelaar', 'gist',
    'lecithine', 'pectine', 'carrageen', 'xanthaangom', 'guargom',
    'e1', 'e2', 'e3', 'e4', 'e5',  // E-numbers
  ]
  const SALT_MAX_DEFAULT = 3  // Salt is rarely > 3% in any food
  const TRACE_MAX = 2         // Trace ingredients are always < 2%
  
  // Apply trace-ingredient caps (these work even without nutritional data)
  for (let i = 0; i < enriched.length; i++) {
    if (enriched[i].percentage != null) continue // Skip declared percentages
    const lower = enriched[i].name.toLowerCase()
    
    // Cap salt at SALT_MAX_DEFAULT (unless nutritional data gives a tighter bound)
    if (SALT_KEYWORDS.some(k => lower.includes(k))) {
      ceilings[i] = Math.min(ceilings[i], SALT_MAX_DEFAULT)
    }
    
    // Cap trace ingredients 
    if (TRACE_KEYWORDS.some(k => lower.includes(k))) {
      ceilings[i] = Math.min(ceilings[i], TRACE_MAX)
    }
  }
  
  if (nutritionHints) {
    for (let i = 0; i < enriched.length; i++) {
      if (enriched[i].percentage != null) continue // Skip declared percentages
      const lower = enriched[i].name.toLowerCase()
      const cat = enriched[i].category
      
      // ---- FAT cap: oil/fat ingredients can't exceed total fat ----
      // Enhanced: uses USDA FoodData Central profiles for accurate saturated fat fractions.
      // E.g., rapeseed oil is 6.6% saturated → 0.2g sat fat means ~3.0g oil.
      if (nutritionHints.fatPct != null) {
        const isOil = OIL_CATEGORIES.has(cat) || OIL_KEYWORDS.some(k => lower.includes(k))
        if (isOil) {
          let oilCap = nutritionHints.fatPct // Default: cap at total fat
          
          // If we know the saturated fat, calculate more precise oil content
          if (nutritionHints.saturatedFatPct != null && nutritionHints.saturatedFatPct > 0) {
            // Look up saturated fat fraction from USDA profiles
            const satFraction = getOilSaturatedFraction(lower, cat)
            
            if (satFraction && satFraction > 0) {
              // Estimated oil weight = saturated_fat_in_product / saturated_fraction_of_oil
              // But we can't assume ALL saturated fat comes from this one ingredient,
              // so we use it as a tighter upper bound alongside total fat.
              const estOilFromSat = nutritionHints.saturatedFatPct / satFraction
              // Also check via total fat (oil is ~100% fat)
              const estOilFromTotal = nutritionHints.fatPct
              // Use the tighter of the two estimates
              oilCap = Math.min(estOilFromSat, estOilFromTotal)
            }
          }
          
          ceilings[i] = Math.min(ceilings[i], oilCap)
        }
      }
      
      // ---- SALT cap: salt ingredients can't exceed declared salt ----
      if (nutritionHints.saltPct != null) {
        if (SALT_KEYWORDS.some(k => lower.includes(k))) {
          ceilings[i] = Math.min(ceilings[i], nutritionHints.saltPct)
        }
      }
      
      // ---- PROTEIN cap: protein-rich ingredients capped by protein content ----
      // Uses USDA profiles for accurate protein density per ingredient.
      if (nutritionHints.proteinPct != null) {
        const isProteinSource = PROTEIN_CATEGORIES.has(cat) || PROTEIN_KEYWORDS.some(k => lower.includes(k))
        if (isProteinSource) {
          // Look up protein density from USDA profiles first, then fallback
          const usdaDensity = getProteinDensity(lower, cat)
          const density = usdaDensity || (cat && PROTEIN_DENSITY_FALLBACK[cat]) || 0.18
          // Max weight = label_protein / density (protein from this ingredient can't exceed total)
          const maxWeight = nutritionHints.proteinPct / density
          ceilings[i] = Math.min(ceilings[i], maxWeight)
        }
      }
      
      // ---- SUGAR cap: sugar ingredients can't exceed declared sugars ----
      if (nutritionHints.sugarsPct != null) {
        if (SUGAR_CATEGORIES.has(cat) || SUGAR_KEYWORDS.some(k => lower.includes(k))) {
          // Use USDA profile for actual sugar density, or default ~100%
          const profile = getIngredientProfile(lower, cat)
          const sugarDensity = (profile && profile.sugars > 0) ? profile.sugars / 100 : 0.95
          ceilings[i] = Math.min(ceilings[i], nutritionHints.sugarsPct / sugarDensity)
        }
      }
      
      // ---- CARBS cap: grain/starch ingredients capped by total carbs ----
      if (nutritionHints.carbsPct != null) {
        if (CARB_CATEGORIES.has(cat) || CARB_KEYWORDS.some(k => lower.includes(k))) {
          // Use USDA profile for actual carb density, or default ~70%
          const profile = getIngredientProfile(lower, cat)
          const carbDensity = (profile && profile.carbs > 0) ? profile.carbs / 100 : 0.65
          const maxWeight = nutritionHints.carbsPct / carbDensity
          ceilings[i] = Math.min(ceilings[i], maxWeight)
        }
      }
      
      // ---- FIBER cap: fiber ingredients capped by declared fiber ----
      if (nutritionHints.fiberPct != null) {
        if (FIBER_KEYWORDS.some(k => lower.includes(k))) {
          ceilings[i] = Math.min(ceilings[i], nutritionHints.fiberPct * 1.5) // Fiber sources vary 30-90%
        }
      }
    }
  }
  
  // Propagate descending order through ceilings:
  // Each undeclared ingredient's ceiling ≤ previous ingredient's ceiling.
  // This ensures the iterative allocation respects EU ordering law AND
  // nutritional caps propagate forward (e.g., oil capped at 1.5% means
  // everything after oil is also ≤ 1.5%).
  for (let i = 1; i < enriched.length; i++) {
    if (enriched[i].percentage == null) {
      const prevCeiling = enriched[i - 1].percentage != null 
        ? enriched[i - 1].percentage 
        : ceilings[i - 1]
      ceilings[i] = Math.min(ceilings[i], prevCeiling)
    }
  }
  
  // Calculate weight fractions
  let totalDeclared = 0
  for (const ing of enriched) {
    if (ing.percentage != null) {
      totalDeclared += ing.percentage
    }
  }
  
  const remainingWeight = Math.max(0, 100 - totalDeclared)
  
  // ── NUTRITION-BASED FLOORS ──
  // When an ingredient is the sole/dominant source of a macro nutrient, its
  // weight can be inferred directly from the nutrition label.  We compute
  // "floors" (minimum weights) that the geometric allocation must respect.
  // Example: if there's 29 g fat and the only oil is kokosolie (100% fat),
  //          then kokosolie must be at least 29%.
  //
  // Only applied for unambiguous nutrient→ingredient mappings:
  //   - FAT → oil/fat ingredients (oils are ~100% fat, very reliable)
  //   - SALT → salt ingredients (salt ≈ 100% salt, very reliable)
  // Protein/carb floors are NOT applied because ingredient names like
  // "aardappeleiwit" (potato protein isolate, ~75% protein) can match
  // wrong USDA profiles like raw potato (2% protein), causing wild errors.
  const floors = new Array(n).fill(0)
  
  if (nutritionHints) {
    const oilIndices = []
    const saltIndices = []
    
    for (let i = 0; i < enriched.length; i++) {
      if (enriched[i].percentage != null) continue
      const lower = enriched[i].name.toLowerCase()
      const cat = enriched[i].category
      
      if (OIL_CATEGORIES.has(cat) || OIL_KEYWORDS.some(k => lower.includes(k)))
        oilIndices.push(i)
      if (SALT_KEYWORDS.some(k => lower.includes(k)))
        saltIndices.push(i)
    }
    
    // FAT floor: if there's exactly one undeclared oil and we know total fat,
    // that oil must weigh ≥ (remaining_fat) / (fat_per_100g_of_oil / 100).
    // Subtract fat contributed by ingredients with declared percentages.
    if (oilIndices.length === 1 && nutritionHints.fatPct != null && nutritionHints.fatPct > 0) {
      const idx = oilIndices[0]
      const lower = enriched[idx].name.toLowerCase()
      const cat = enriched[idx].category
      const profile = getIngredientProfile(lower, cat)
      const fatDensity = profile ? profile.fat / 100 : 1.0 // oils are ~100% fat
      if (fatDensity > 0) {
        // Subtract fat from ingredients with known percentages
        let fatFromDeclared = 0
        for (const ing of enriched) {
          if (ing.percentage != null) {
            const ingProfile = getIngredientProfile(ing.name, ing.category)
            if (ingProfile) fatFromDeclared += ing.percentage * (ingProfile.fat / 100)
          }
        }
        const remainingFat = Math.max(0, nutritionHints.fatPct - fatFromDeclared)
        const minOil = remainingFat / fatDensity
        floors[idx] = Math.max(floors[idx], Math.min(minOil, ceilings[idx]))
      }
    }
    
    // SALT floor: if there's exactly one salt source
    if (saltIndices.length === 1 && nutritionHints.saltPct != null && nutritionHints.saltPct > 0) {
      const idx = saltIndices[0]
      floors[idx] = Math.max(floors[idx], Math.min(nutritionHints.saltPct, ceilings[idx]))
    }
  }
  
  // Assign undeclared ingredients using iterative geometric decay with capping.
  // When a cap reduces an ingredient's share, the excess flows back to uncapped
  // ingredients (especially the first/largest ones like water).
  const DECAY = 0.65
  const undeclaredIndices = []
  for (let i = 0; i < enriched.length; i++) {
    if (enriched[i].percentage == null) {
      undeclaredIndices.push(i)
    }
  }
  
  const rawWeights = new Array(n).fill(0)
  
  // Set declared ingredients first
  for (let i = 0; i < enriched.length; i++) {
    if (enriched[i].percentage != null) {
      rawWeights[i] = enriched[i].percentage
    }
  }
  
  // Pre-allocate floors: fix ingredients at their floor value and remove from budget
  const allocated = new Array(undeclaredIndices.length).fill(0)
  const fixed = new Array(undeclaredIndices.length).fill(false)
  let budget = remainingWeight
  
  for (let j = 0; j < undeclaredIndices.length; j++) {
    const idx = undeclaredIndices[j]
    if (floors[idx] > 0) {
      allocated[j] = floors[idx]
      fixed[j] = true
      budget -= floors[idx]
    }
  }
  budget = Math.max(0, budget)
  
  // Iterative allocation: distribute remaining budget using geometric decay,
  // cap at ceilings, redistribute excess. Converges in a few iterations.
  for (let iter = 0; iter < 10 && budget > 0.01; iter++) {
    // Compute geometric weights for unfixed ingredients
    const unfixedJs = []
    for (let j = 0; j < undeclaredIndices.length; j++) {
      if (!fixed[j]) unfixedJs.push(j)
    }
    if (unfixedJs.length === 0) break
    
    // Use original list position (j) for decay to respect ingredient ordering
    const geoW = unfixedJs.map(j => Math.pow(DECAY, j))
    const geoT = geoW.reduce((s, w) => s + w, 0)
    
    let excess = 0
    for (let k = 0; k < unfixedJs.length; k++) {
      const j = unfixedJs[k]
      const idx = undeclaredIndices[j]
      const share = geoT > 0 ? (geoW[k] / geoT) * budget : 0
      const maxAllowed = ceilings[idx]
      
      if (allocated[j] + share > maxAllowed) {
        excess += (allocated[j] + share) - maxAllowed
        allocated[j] = maxAllowed
        fixed[j] = true
      } else {
        allocated[j] += share
      }
    }
    budget = excess
  }
  
  // Write allocated values to rawWeights
  for (let j = 0; j < undeclaredIndices.length; j++) {
    rawWeights[undeclaredIndices[j]] = allocated[j]
  }
  
  // Convert raw percentages to fractions (0-1 scale)
  // Don't normalize — declared percentages stay exactly as declared
  return enriched.map((ing, i) => ({
    ...ing,
    weightFraction: rawWeights[i] / 100
  }))
}

/**
 * Extract nutritional values from raw text OR return structured nutrition JSON.
 * Values per 100g/100ml = direct weight percentages.
 * Used to constrain ingredient weight estimates:
 *   fat     → caps oil/butter/margarine ingredients
 *   protein → caps meat/dairy/legume ingredients
 *   carbs   → caps grain/flour/starch/sugar ingredients
 *   sugars  → caps sugar ingredient specifically
 *   fiber   → caps legume/whole grain ingredients
 *   salt    → caps salt ingredient
 *   saturated_fat → helps distinguish palm oil/butter from sunflower oil
 * 
 * @param {string} text - Raw scraped text that may contain "Voedingswaarde" section
 * @param {Object|null} nutritionJson - Pre-parsed structured nutrition from DB
 * @returns {Object|null} - { fatPct, saltPct, proteinPct, carbsPct, sugarsPct, fiberPct, saturatedFatPct, energyKcal }
 */
function extractNutritionHints(text, nutritionJson = null) {
  // If we have pre-parsed structured JSON from the scraper, use it directly
  if (nutritionJson && typeof nutritionJson === 'object') {
    const hints = {}
    let found = false
    if (nutritionJson.fat != null) { hints.fatPct = nutritionJson.fat; found = true }
    if (nutritionJson.salt != null) { hints.saltPct = nutritionJson.salt; found = true }
    if (nutritionJson.protein != null) { hints.proteinPct = nutritionJson.protein; found = true }
    if (nutritionJson.carbs != null) { hints.carbsPct = nutritionJson.carbs; found = true }
    if (nutritionJson.sugars != null) { hints.sugarsPct = nutritionJson.sugars; found = true }
    if (nutritionJson.fiber != null) { hints.fiberPct = nutritionJson.fiber; found = true }
    if (nutritionJson.saturated_fat != null) { hints.saturatedFatPct = nutritionJson.saturated_fat; found = true }
    if (nutritionJson.unsaturated_fat != null) { hints.unsaturatedFatPct = nutritionJson.unsaturated_fat; found = true }
    if (nutritionJson.energy_kcal != null) { hints.energyKcal = nutritionJson.energy_kcal; found = true }
    return found ? hints : null
  }

  if (!text) return null
  
  // Find the "Voedingswaarde" / "Nutritional" / "Nutrition" section.
  // If no header found, check if the text itself looks like nutrition data
  // (e.g. nutrition_text from the DB often starts with "Energie ...kcal")
  let section = text
  const voedingMatch = text.match(/voedingswaarde|nutrition/i)
  if (voedingMatch) {
    section = text.slice(voedingMatch.index)
  } else if (!/\b(?:kcal|kJ|vet|fat|eiwit|protein|koolhydra|carbohydrate)\b/i.test(text)) {
    // Text doesn't look like nutrition data at all
    return null
  }
  
  const hints = {}
  let found = false
  
  // Helper: try to match a nutrient value in grams
  function matchGrams(patterns) {
    for (const p of patterns) {
      const m = section.match(p)
      if (m) return parseFloat(m[1].replace(',', '.'))
    }
    return null
  }
  
  // Fat (total) — \bvet(?:ten?)?\b matches 'Vet', 'Vette', 'Vetten'
  const fat = matchGrams([/\bvet(?:ten?)?\b\s*(\d+[.,]?\d*)\s*g/i, /\bfat\b\s*(\d+[.,]?\d*)\s*g/i])
  if (fat != null) { hints.fatPct = fat; found = true }
  
  // Saturated fat
  const satFat = matchGrams([
    /waarvan\s+verzadigd(?:e?\s+vetzuren?)?\s*(\d+[.,]?\d*)\s*g/i,
    /(?:of\s+which\s+)?saturates?\s*(\d+[.,]?\d*)\s*g/i
  ])
  if (satFat != null) { hints.saturatedFatPct = satFat; found = true }
  
  // Carbohydrates
  const carbs = matchGrams([/\bkoolhydraten\b\s*(\d+[.,]?\d*)\s*g/i, /\bcarbohydrate\b\s*(\d+[.,]?\d*)\s*g/i])
  if (carbs != null) { hints.carbsPct = carbs; found = true }
  
  // Sugars
  const sugars = matchGrams([
    /waarvan\s+suikers?\s*(\d+[.,]?\d*)\s*g/i,
    /(?:of\s+which\s+)?sugars?\s*(\d+[.,]?\d*)\s*g/i
  ])
  if (sugars != null) { hints.sugarsPct = sugars; found = true }
  
  // Fiber — (?:voedings)?vezels? matches both 'Vezel(s)' and 'Voedingsvezel'
  const fiber = matchGrams([/(?:voedings)?vezels?\b\s*(\d+[.,]?\d*)\s*g/i, /\bfib(?:re|er)\b\s*(\d+[.,]?\d*)\s*g/i])
  if (fiber != null) { hints.fiberPct = fiber; found = true }
  
  // Protein
  const protein = matchGrams([/\beiwitten?\b\s*(\d+[.,]?\d*)\s*g/i, /\bprotein\b\s*(\d+[.,]?\d*)\s*g/i])
  if (protein != null) { hints.proteinPct = protein; found = true }
  
  // Salt
  const salt = matchGrams([/\bzout\b\s*(\d+[.,]?\d*)\s*g/i, /\bsalt\b\s*(\d+[.,]?\d*)\s*g/i])
  if (salt != null) { hints.saltPct = salt; found = true }
  
  // Energy
  const energyMatch = section.match(/(\d+[.,]?\d*)\s*kcal/i)
  if (energyMatch) { hints.energyKcal = parseFloat(energyMatch[1].replace(',', '.')); found = true }
  
  // Derive unsaturated fat from total fat - saturated fat (when parsed from text)
  if (hints.fatPct != null && hints.saturatedFatPct != null) {
    hints.unsaturatedFatPct = Math.round((hints.fatPct - hints.saturatedFatPct) * 100) / 100
  }
  
  return found ? hints : null
}

/**
 * Calculate a weighted-average CO2/kg from an ingredient list.
 * Only considers the top N ingredients (default 10) for efficiency and relevance.
 * 
 * @param {string} ingredientText - Raw ingredient text from the product page
 * @param {number} maxIngredients - Max ingredients to consider (default 10)
 * @returns {Object} - { co2PerKg, category, matched, method: 'ingredients', ingredients: [...] }
 */
function getCO2FromIngredients(ingredientText, nutritionText = null, nutritionJson = null, maxIngredients = 10) {
  // Get nutritional hints: prefer structured JSON, supplement with text parsing
  // JSON may be incomplete (e.g. missing fat/fiber due to scraper regex bugs),
  // so we merge: JSON fields take priority, text fills in gaps.
  let nutritionHints = null
  const jsonHints = extractNutritionHints(null, nutritionJson)
  const textHints = extractNutritionHints(nutritionText) || extractNutritionHints(ingredientText)
  
  if (jsonHints && textHints) {
    // Merge: JSON wins where present, text fills gaps
    nutritionHints = { ...textHints, ...jsonHints }
  } else {
    nutritionHints = jsonHints || textHints
  }
  
  const parsed = parseIngredients(ingredientText)
  if (parsed.length === 0) {
    return { co2PerKg: null, category: null, matched: false, method: 'ingredients' }
  }
  
  // Only use top N ingredients (most important by weight)
  const topIngredients = parsed.slice(0, maxIngredients)
  const weighted = estimateIngredientWeights(topIngredients, nutritionHints)
  
  // Calculate weighted average CO2 with multi-source uncertainty
  let totalCO2 = 0
  let totalCO2Min = 0
  let totalCO2Max = 0
  let totalWeight = 0
  let allValid = true
  let dominantCategory = null
  let dominantCO2Contribution = 0
  
  for (const ing of weighted) {
    if (ing.co2PerKg != null && ing.weightFraction > 0) {
      const co2Contribution = ing.co2PerKg * ing.weightFraction
      totalCO2 += co2Contribution
      totalWeight += ing.weightFraction
      
      // Accumulate uncertainty range from multi-source data
      if (ing.emission) {
        totalCO2Min += ing.emission.rangeMin * ing.weightFraction
        totalCO2Max += ing.emission.rangeMax * ing.weightFraction
        if (!ing.emission.valid) allValid = false
      } else {
        totalCO2Min += co2Contribution
        totalCO2Max += co2Contribution
      }
      
      // Track the category with highest CO2 contribution (not just weight)
      if (co2Contribution > dominantCO2Contribution) {
        dominantCO2Contribution = co2Contribution
        dominantCategory = ing.category
      }
    }
  }
  
  if (totalWeight === 0) {
    return { co2PerKg: null, category: null, matched: false, method: 'ingredients' }
  }
  
  // Sum of contributions = total CO2 per kg of product
  // We use totalCO2 directly (not divided by totalWeight) because unmatched
  // ingredients (water, salt, additives, vitamins) have near-zero CO2.
  const avgCO2 = totalCO2
  
  return {
    co2PerKg: Math.round(avgCO2 * 100) / 100,
    co2Min: Math.round(totalCO2Min * 100) / 100,
    co2Max: Math.round(totalCO2Max * 100) / 100,
    co2Valid: allValid,
    category: dominantCategory,
    matched: true,
    method: 'ingredients',
    ingredientBreakdown: weighted
      .filter(i => i.co2PerKg != null)
      .map(i => ({
        name: i.name,
        category: i.category,
        co2PerKg: i.co2PerKg,
        weightFraction: Math.round(i.weightFraction * 1000) / 1000,
        sources: i.emission ? i.emission.sources : null,
        co2Min: i.emission ? i.emission.rangeMin : i.co2PerKg,
        co2Max: i.emission ? i.emission.rangeMax : i.co2PerKg
      })),
    matchedIngredients: weighted.filter(i => i.co2PerKg != null).length,
    totalIngredients: weighted.length
  }
}

/**
 * Get CO2 emissions for a product - with ingredient-based fallback/override.
 * Priority: 
 *   1. If ingredients are available → use weighted ingredient analysis
 *   2. Otherwise → use product name keyword matching
 * 
 * @param {string} productName - Product name
 * @param {string|null} ingredientText - Optional ingredient list text
 * @returns {Object} - { co2PerKg, category, matched, method }
 */
// Categories where the product name should take precedence over ingredients.
// For these, the processing/production (fermentation, aging, roasting, etc.)
// is a major CO2 contributor that raw ingredients don't capture.
// e.g. "rode druif" → berries (1.53) but wine from those grapes → wine (1.79)
const NAME_OVERRIDE_CATEGORIES = new Set([
  'wine', 'beer', 'spirits',       // Fermentation, distillation, glass bottles
  'coffee', 'tea',                  // Roasting, drying, long-distance transport
  'dark_chocolate',                 // Cacao processing, fermentation
  'cheese',                         // Aging, high milk-to-cheese ratio
])

function getCO2Emissions(productName, ingredientText = null, nutritionText = null, nutritionJson = null) {
  // First: exclude non-food items by name
  if (isNonFood(productName)) {
    return {
      co2PerKg: null,
      category: '__non_food__',
      matched: false,
      isNonFood: true,
      method: 'non_food'
    }
  }
  
  // Check if the product name matches a processed category where
  // the name-based CO2 is more accurate than ingredient analysis
  const nameCategory = getCO2Category(productName)
  if (nameCategory && NAME_OVERRIDE_CATEGORIES.has(nameCategory) && CO2_EMISSIONS_DATA[nameCategory]) {
    const nameEmission = getEmission(nameCategory)
    return {
      co2PerKg: CO2_EMISSIONS_DATA[nameCategory],
      co2Min: nameEmission ? nameEmission.rangeMin : CO2_EMISSIONS_DATA[nameCategory],
      co2Max: nameEmission ? nameEmission.rangeMax : CO2_EMISSIONS_DATA[nameCategory],
      co2Valid: nameEmission ? nameEmission.valid : true,
      category: nameCategory,
      matched: true,
      isNonFood: false,
      method: 'name'
    }
  }
  
  // Try ingredient-based scoring (most accurate for composite products)
  if (ingredientText && typeof ingredientText === 'string' && ingredientText.length > 5) {
    const ingredientResult = getCO2FromIngredients(ingredientText, nutritionText, nutritionJson)
    if (ingredientResult.matched) {
      return {
        ...ingredientResult,
        isNonFood: false
      }
    }
  }
  
  // Fall back to product name matching
  const category = getCO2Category(productName)
  
  if (!category || !CO2_EMISSIONS_DATA[category]) {
    return {
      co2PerKg: null,
      co2Min: null,
      co2Max: null,
      co2Valid: null,
      category: null,
      matched: false,
      isNonFood: false,
      method: 'name'
    }
  }
  
  const fallbackEmission = getEmission(category)
  return {
    co2PerKg: CO2_EMISSIONS_DATA[category],
    co2Min: fallbackEmission ? fallbackEmission.rangeMin : CO2_EMISSIONS_DATA[category],
    co2Max: fallbackEmission ? fallbackEmission.rangeMax : CO2_EMISSIONS_DATA[category],
    co2Valid: fallbackEmission ? fallbackEmission.valid : true,
    category,
    matched: true,
    isNonFood: false,
    method: 'name'
  }
}

/**
 * Convert CO2 emissions to a 0-10 sustainability score
 * Lower CO2 = higher score
 * @param {number} co2PerKg - CO2 emissions in kg CO2/kg food
 * @returns {number} - Score from 0-10
 */
function co2ToScore(co2PerKg) {
  if (co2PerKg === null || co2PerKg === undefined) return null
  
  for (const threshold of SCORE_THRESHOLDS) {
    if (co2PerKg <= threshold.maxCO2) {
      return threshold.score
    }
  }
  
  return 0
}

/**
 * Get rating label based on score
 * @param {number} score - Score 0-10
 * @returns {Object} - { label, emoji, color }
 */
function getCO2Rating(score) {
  if (score === null) {
    return { label: 'Unknown', emoji: '❓', color: '#6b7280' }
  }
  if (score >= 9) return { label: 'Excellent', emoji: '🌿', color: '#22c55e' }
  if (score >= 7) return { label: 'Good', emoji: '🌱', color: '#84cc16' }
  if (score >= 5) return { label: 'Average', emoji: '🌍', color: '#eab308' }
  if (score >= 3) return { label: 'High', emoji: '⚠️', color: '#f97316' }
  return { label: 'Very High', emoji: '🔴', color: '#ef4444' }
}

/**
 * Get human-readable category name
 */
const CATEGORY_LABELS = {
  'beef_herd': 'Rundvlees (vleesrund)',
  'beef_dairy': 'Rundvlees (zuivelrund)',
  'lamb_mutton': 'Lamsvlees',
  'pig_meat': 'Varkensvlees',
  'poultry_meat': 'Gevogelte',
  'shrimps_farmed': 'Garnalen',
  'fish_farmed': 'Vis',
  'cheese': 'Kaas',
  'milk': 'Zuivelproducten',
  'eggs': 'Eieren',
  'palm_oil': 'Palmolie',
  'soybean_oil': 'Sojaolie',
  'olive_oil': 'Olijfolie',
  'rapeseed_oil': 'Raapzaadolie',
  'sunflower_oil': 'Zonnebloemolie',
  'rice': 'Rijst',
  'wheat_rye': 'Tarwe & Rogge',
  'barley': 'Gerst',
  'maize': 'Maïs',
  'oatmeal': 'Haver',
  'groundnuts': 'Pinda\'s',
  'other_pulses': 'Peulvruchten',
  'peas': 'Erwten',
  'nuts': 'Noten',
  'tofu': 'Tofu & Plantaardig',
  'berries_grapes': 'Bessen & Druiven',
  'citrus_fruit': 'Citrusfruit',
  'bananas': 'Bananen',
  'apples': 'Appels & Peren',
  'other_fruit': 'Overig Fruit',
  'tomatoes': 'Tomaten',
  'brassicas': 'Koolsoorten',
  'onions_leeks': 'Uien & Prei',
  'potatoes': 'Aardappelen',
  'root_vegetables': 'Wortelgroenten',
  'other_vegetables': 'Overige Groenten',
  'cane_sugar': 'Rietsuiker',
  'beet_sugar': 'Bietsuiker',
  'coffee': 'Koffie',
  'dark_chocolate': 'Chocolade',
  'wine': 'Wijn',
  'soy_milk': 'Plantaardige Melk',
  'cassava': 'Cassave',
  // New categories
  'beer': 'Bier',
  'spirits': 'Sterke Drank',
  'tea': 'Thee',
  'soft_drinks': 'Frisdranken',
  'sauces_condiments': 'Sauzen & Kruiden',
  'ready_meals': 'Kant-en-klaar',
  'soup': 'Soep',
  'candy_sweets': 'Snoep & Drop',
  'ice_cream': 'IJs',
  'baked_goods': 'Gebak & Koek',
  'desserts': 'Desserts',
  'spreads': 'Broodbeleg',
  'baby_food': 'Babyvoeding',
  'snacks': 'Snacks',
  '__non_food__': 'Geen Voedingsmiddel'
}

function getCategoryLabel(category) {
  return CATEGORY_LABELS[category] || category
}

/**
 * Full evaluation of a product's CO2 footprint
 * @param {string} productName - Product name
 * @param {Object} enrichedData - Optional enriched data with is_vegan, is_organic, ingredients, etc.
 * @returns {Object} - Full evaluation result
 */
function evaluateProductCO2(productName, enrichedData = null) {
  const ingredientText = enrichedData?.ingredients || null
  const co2Data = getCO2Emissions(productName, ingredientText)
  const score = co2ToScore(co2Data.co2PerKg)
  const rating = getCO2Rating(score)
  
  // Build reasons array
  const reasons = []
  
  if (co2Data.matched) {
    reasons.push({
      type: 'co2_category',
      icon: rating.emoji,
      label: getCategoryLabel(co2Data.category),
      co2PerKg: co2Data.co2PerKg,
      delta: null  // Primary scoring, no delta
    })
  }
  
  // Add supplementary info from enriched data (not affecting score)
  if (enrichedData) {
    if (enrichedData.is_organic === true) {
      reasons.push({
        type: 'attribute',
        icon: '🌿',
        label: 'Biologisch',
        supplementary: true
      })
    }
    if (enrichedData.is_vegan === true) {
      reasons.push({
        type: 'attribute',
        icon: '🌱',
        label: 'Vegan',
        supplementary: true
      })
    } else if (enrichedData.is_vegetarian === true) {
      reasons.push({
        type: 'attribute',
        icon: '🥗',
        label: 'Vegetarisch',
        supplementary: true
      })
    }
    if (enrichedData.is_fairtrade === true) {
      reasons.push({
        type: 'attribute',
        icon: '🤝',
        label: 'Fairtrade',
        supplementary: true
      })
    }
    if (enrichedData.origin_country) {
      reasons.push({
        type: 'origin',
        icon: '📍',
        label: `Herkomst: ${enrichedData.origin_country}`,
        supplementary: true
      })
    }
  }
  
  return {
    product: productName,
    co2PerKg: co2Data.co2PerKg,
    co2Category: co2Data.category,
    co2CategoryLabel: co2Data.category ? getCategoryLabel(co2Data.category) : null,
    matched: co2Data.matched,
    score,
    rating,
    reasons,
    hasData: co2Data.matched
  }
}

/**
 * Compare a user's average CO2/kg against dietary baselines.
 * @param {number} userAvgCO2PerKg - User's weighted average CO2 per kg of food
 * @param {string} region - 'eu27' or 'netherlands' (default: 'netherlands')
 * @returns {object} Comparison result with percentage difference and label
 */
function compareToBaseline(userAvgCO2PerKg, region = 'netherlands') {
  const baseline = DIETARY_BASELINES[region]
  if (!baseline || !userAvgCO2PerKg || userAvgCO2PerKg <= 0) {
    return { baseline: null, difference: null, percentBetter: null }
  }
  
  const difference = baseline.co2PerKg - userAvgCO2PerKg  // positive = user is better
  const percentBetter = (difference / baseline.co2PerKg) * 100
  
  return {
    baseline: baseline.co2PerKg,
    baselineLabel: baseline.label,
    baselineYear: baseline.year,
    userAvgCO2PerKg,
    difference: Math.round(difference * 100) / 100,
    percentBetter: Math.round(percentBetter * 10) / 10,
    // Annual projection: if user bought all food like this, what would their yearly CO2 be?
    userProjectedAnnual: Math.round(userAvgCO2PerKg * baseline.foodKgPerDay * 365),
    baselineAnnual: baseline.co2PerYear
  }
}

// Export for use in app.js (ES modules)
export {
  CO2_EMISSIONS_DATA,
  PRODUCT_CATEGORY_KEYWORDS,
  CATEGORY_LABELS,
  NON_FOOD_KEYWORDS,
  DIETARY_BASELINES,
  CATEGORY_DEFAULT_WEIGHTS,
  getCO2Category,
  getCO2Emissions,
  getCO2FromIngredients,
  parseIngredients,
  estimateIngredientWeights,
  extractNutritionHints,
  co2ToScore,
  getCO2Rating,
  getCategoryLabel,
  evaluateProductCO2,
  isNonFood,
  compareToBaseline,
  parseWeightGrams,
  getProductWeight
}
