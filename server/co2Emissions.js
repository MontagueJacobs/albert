/**
 * CO2 Emissions Data for Food Products
 * 
 * Data source: Our World in Data - Environmental Impacts of Food
 * https://ourworldindata.org/grapher/food-emissions-supply-chain
 * 
 * Values are in kg CO2 equivalent per kg of food product
 * These include all supply chain emissions: land use, farming, animal feed,
 * processing, transport, retail, packaging, and losses.
 */

// CO2 emissions data (kg CO2 eq per kg of food)
// Sourced from Our World in Data 2018 global averages
const CO2_EMISSIONS_DATA = {
  // Meat products (highest emissions)
  'beef_herd': 99.48,        // Beef from beef herd
  'beef_dairy': 33.30,       // Beef from dairy herd
  'lamb_mutton': 39.72,      // Lamb & Mutton
  'pig_meat': 12.31,         // Pork
  'poultry_meat': 9.87,      // Chicken, turkey
  
  // Seafood
  'shrimps_farmed': 26.87,   // Farmed shrimp
  'fish_farmed': 13.63,      // Farmed fish
  
  // Dairy & Eggs
  'cheese': 23.88,           // All cheese types
  'milk': 3.15,              // Milk
  'eggs': 4.67,              // Eggs
  
  // Oils
  'palm_oil': 7.32,
  'soybean_oil': 6.32,
  'olive_oil': 5.42,
  'rapeseed_oil': 3.77,
  'sunflower_oil': 3.60,
  
  // Grains & Cereals
  'rice': 4.45,
  'wheat_rye': 1.57,
  'barley': 1.18,
  'maize': 1.70,
  'oatmeal': 2.48,
  
  // Legumes & Nuts
  'groundnuts': 3.23,        // Peanuts
  'other_pulses': 1.79,      // Beans, lentils
  'peas': 0.98,
  'nuts': 0.43,
  'tofu': 3.16,
  
  // Fruits
  'berries_grapes': 1.53,
  'citrus_fruit': 0.39,
  'bananas': 0.86,
  'apples': 0.43,
  'other_fruit': 1.05,
  
  // Vegetables
  'tomatoes': 2.09,          // Greenhouse tomatoes have higher emissions
  'brassicas': 0.51,         // Broccoli, cabbage, cauliflower
  'onions_leeks': 0.50,
  'potatoes': 0.46,
  'root_vegetables': 0.43,   // Carrots, parsnips, etc.
  'other_vegetables': 0.53,
  'cassava': 1.32,
  
  // Sugars
  'cane_sugar': 3.20,
  'beet_sugar': 1.81,
  
  // Beverages & Other
  'coffee': 28.53,
  'dark_chocolate': 46.65,
  'wine': 1.79,
  'soy_milk': 0.98
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
    'pork', 'sausage', 'cervelaat', 'osseworst'
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
    'melk', 'milk', 'room', 'cream', 'slagroom', 'koffiemelk',
    'yoghurt', 'yogurt', 'kwark', 'vla', 'custard',
    'karnemelk', 'buttermilk', 'creme fraiche', 'zure room',
    'boter', 'butter', 'margarine', 'roomboter',
    'zuivel'  // Generic dairy
  ],
  'eggs': [
    'ei', 'eieren', 'eggs', 'omelet', 'roerei', 'gebakken ei',
    'hardgekookt', 'zachtgekookt'
  ],
  
  // Oils
  'palm_oil': ['palmolie', 'palm oil', 'palmvet'],
  'soybean_oil': ['sojaolie', 'soybean oil', 'soja-olie'],
  'olive_oil': ['olijfolie', 'olive oil'],
  'rapeseed_oil': ['raapzaadolie', 'koolzaadolie', 'rapeseed oil', 'canola'],
  'sunflower_oil': ['zonnebloemolie', 'sunflower oil'],
  
  // Grains
  'rice': ['rijst', 'rice', 'risotto', 'basmati', 'jasmine', 'sushi'],
  'wheat_rye': [
    'brood', 'bread', 'toast', 'croissant', 'stokbrood', 'baguette',
    'wrap', 'tortilla', 'pita', 'naan', 'bagel',
    'pasta', 'spaghetti', 'macaroni', 'penne', 'fusilli', 'tagliatelle',
    'lasagne', 'ravioli', 'gnocchi', 'couscous',
    'meel', 'flour', 'bloem', 'zelfrijzend',
    'crackers', 'beschuit', 'ontbijtkoek', 'koek', 'biscuit'
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
    'pecannoten', 'macadamia', 'paranoten'
  ],
  'tofu': ['tofu', 'tahoe', 'tempeh', 'seitan'],
  
  // Fruits
  'berries_grapes': [
    'aardbei', 'strawberry', 'framboos', 'raspberry', 'bosbes', 'blueberry',
    'braam', 'blackberry', 'druif', 'grape', 'bes', 'berry',
    'rozijn', 'raisin', 'krent'
  ],
  'citrus_fruit': [
    'sinaasappel', 'orange', 'citroen', 'lemon', 'limoen', 'lime',
    'grapefruit', 'mandarijn', 'tangerine', 'clementine', 'pompelmoes'
  ],
  'bananas': ['banaan', 'banana', 'plantain'],
  'apples': ['appel', 'apple', 'peer', 'pear'],
  'other_fruit': [
    'mango', 'ananas', 'pineapple', 'meloen', 'melon', 'watermeloen',
    'kiwi', 'papaya', 'passievrucht', 'passion fruit', 'lychee',
    'granaatappel', 'pomegranate', 'vijg', 'fig', 'dadel', 'date',
    'pruim', 'plum', 'kers', 'cherry', 'abrikoos', 'apricot',
    'perzik', 'peach', 'nectarine', 'kokos', 'coconut'
  ],
  
  // Vegetables
  'tomatoes': ['tomaat', 'tomato', 'tomatenpuree', 'passata', 'ketchup'],
  'brassicas': [
    'broccoli', 'bloemkool', 'cauliflower', 'kool', 'cabbage',
    'spruitjes', 'brussels sprouts', 'boerenkool', 'kale',
    'spinazie', 'spinach', 'andijvie', 'paksoi', 'chinese kool'
  ],
  'onions_leeks': [
    'ui', 'onion', 'prei', 'leek', 'sjalot', 'shallot',
    'knoflook', 'garlic', 'bieslook', 'chive', 'lente-ui', 'spring onion'
  ],
  'potatoes': [
    'aardappel', 'potato', 'friet', 'fries', 'patat',
    'puree', 'mash', 'chips', 'aardappelpuree', 'rösti'
  ],
  'root_vegetables': [
    'wortel', 'carrot', 'pastinaak', 'parsnip', 'knolselderij',
    'celeriac', 'biet', 'beet', 'radijs', 'radish', 'raap', 'turnip'
  ],
  'other_vegetables': [
    'sla', 'lettuce', 'salade', 'salad', 'komkommer', 'cucumber',
    'paprika', 'pepper', 'courgette', 'zucchini', 'aubergine', 'eggplant',
    'pompoen', 'pumpkin', 'asperge', 'asparagus', 'champignon', 'mushroom',
    'venkel', 'fennel', 'artisjok', 'artichoke', 'avocado',
    'mais', 'corn', 'maïskolf', 'groente', 'vegetable', 'groentemix'
  ],
  
  // Sugar
  'cane_sugar': ['rietsuiker', 'cane sugar', 'ruwe suiker', 'muscovado'],
  'beet_sugar': ['suiker', 'sugar', 'kristalsuiker', 'poedersuiker', 'basterdsuiker'],
  
  // Beverages & Other
  'coffee': ['koffie', 'coffee', 'espresso', 'cappuccino', 'latte'],
  'dark_chocolate': ['chocola', 'chocolate', 'cacao', 'cocoa'],
  'wine': ['wijn', 'wine'],
  'soy_milk': ['sojamelk', 'soy milk', 'sojadrink', 'havermelk', 'oat milk', 'amandelmelk', 'almond milk', 'plantaardig']
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
function getCO2Category(productName) {
  if (!productName) return null
  const lower = productName.toLowerCase()
  
  // Check each category's keywords
  for (const [category, keywords] of Object.entries(PRODUCT_CATEGORY_KEYWORDS)) {
    for (const keyword of keywords) {
      // Match whole words or word boundaries
      const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i')
      if (regex.test(lower)) {
        return category
      }
    }
  }
  
  return null
}

/**
 * Get CO2 emissions for a product
 * @param {string} productName - Product name
 * @returns {Object} - { co2PerKg, category, matched }
 */
function getCO2Emissions(productName) {
  const category = getCO2Category(productName)
  
  if (!category || !CO2_EMISSIONS_DATA[category]) {
    return {
      co2PerKg: null,
      category: null,
      matched: false
    }
  }
  
  return {
    co2PerKg: CO2_EMISSIONS_DATA[category],
    category,
    matched: true
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
  'tofu': 'Tofu & Tempeh',
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
  'cassava': 'Cassave'
}

function getCategoryLabel(category) {
  return CATEGORY_LABELS[category] || category
}

/**
 * Full evaluation of a product's CO2 footprint
 * @param {string} productName - Product name
 * @param {Object} enrichedData - Optional enriched data with is_vegan, is_organic, etc.
 * @returns {Object} - Full evaluation result
 */
function evaluateProductCO2(productName, enrichedData = null) {
  const co2Data = getCO2Emissions(productName)
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

// Export for use in app.js (ES modules)
export {
  CO2_EMISSIONS_DATA,
  PRODUCT_CATEGORY_KEYWORDS,
  CATEGORY_LABELS,
  getCO2Category,
  getCO2Emissions,
  co2ToScore,
  getCO2Rating,
  getCategoryLabel,
  evaluateProductCO2
}
