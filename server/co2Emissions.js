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
  'beer': 1.20,
  'spirits': 2.50,
  'tea': 1.00,
  'soft_drinks': 0.80,
  'soy_milk': 0.98,
  
  // Processed / Mixed categories (estimated averages)
  'sauces_condiments': 2.00,
  'ready_meals': 4.50,        // Weighted average of mixed ingredients
  'soup': 2.00,
  'candy_sweets': 1.80,       // Sugar-based
  'ice_cream': 3.50,          // Dairy-based
  'baked_goods': 1.80,        // Flour + sugar based
  'spreads': 2.50,            // Varies widely
  'desserts': 3.00,           // Dairy-based
  'baby_food': 3.00,          // Dairy-based average
  'snacks': 2.50              // Mixed snack average
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
    'zuivel', 'drinkyoghurt', 'optimel', 'chocomel'
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
    'lasagne', 'ravioli', 'gnocchi', 'couscous', 'tortelloni', 'tortellini',
    'meel', 'flour', 'tarwebloem', 'zelfrijzend bakmeel',
    'crackers', 'beschuit'
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
  'bananas': ['banaan', 'bananen', 'banana', 'plantain'],
  'apples': ['appel', 'apple', 'peer', 'pear'],
  'other_fruit': [
    'mango', 'ananas', 'pineapple', 'meloen', 'melon', 'watermeloen',
    'kiwi', 'papaya', 'passievrucht', 'passion fruit', 'lychee',
    'granaatappel', 'pomegranate', 'vijg', 'fig', 'dadel', 'date',
    'pruim', 'plum', 'kers', 'cherry', 'abrikoos', 'apricot',
    'perzik', 'peach', 'nectarine', 'kokos', 'coconut'
  ],
  
  // Vegetables
  'tomatoes': ['tomaat', 'tomato', 'tomatenpuree', 'passata'],
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
    'maïskolf', 'groente', 'vegetable', 'groentemix',
    'selderij', 'bleekselderij'
  ],
  
  // Sugar
  'cane_sugar': ['rietsuiker', 'cane sugar', 'ruwe suiker', 'muscovado'],
  'beet_sugar': ['suiker', 'sugar', 'kristalsuiker', 'poedersuiker', 'basterdsuiker'],
  
  // Beverages & Other
  'coffee': ['koffie', 'coffee', 'espresso', 'cappuccino', 'latte'],
  'dark_chocolate': ['chocola', 'chocolate', 'cacao', 'cocoa', 'hagelslag', 'chocopasta', 'nutella'],
  'wine': ['wijn', 'wine', 'prosecco', 'champagne', 'port', 'sherry'],
  'beer': ['bier', 'pils', 'radler', 'witbier', 'ipa', 'weizen', 'heineken', 'amstel', 'grolsch', 'hertog jan', 'palm', 'jupiler', 'duvel'],
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
    'oregano', 'basilicum', 'tijm', 'rozemarijn', 'zout'
  ],
  
  // Ready meals & Soups
  'ready_meals': [
    'maaltijd', 'magnetron', 'pizza', 'nasi', 'bami',
    'noodles', 'ramen', 'dim sum', 'loempia', 'spring roll',
    'bapao', 'tosti', 'wereldgerecht', 'stamppot',
    'ovenschotel', 'wokgroente', 'roerbak',
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
  'swiffer', 'bleek', 'ontkalker', 'wc-blok', 'vaatdoek',
  'spons', 'handschoen', 'prullenbak', 'stofzuig',
  // Health
  'vitamine', 'paracetamol', 'ibuprofen', 'pleister', 'hoestdrank',
  'keelpastille', 'neusspray', 'davitamon', 'magnesium', 'ijzertablet',
  'zonnebrand', 'bodylotion', 'gezichtscreme',
  // Pet food
  'hondenvoer', 'hondenbrok', 'hondenstick', 'kattenvoer', 'kattenbrok',
  'kattensnack', 'whiskas', 'pedigree', 'vogelvoer', 'dierenvoer'
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
  // Sugar/sweet fallback
  { keywords: ['zoet', 'sweet', 'suiker', 'sugar', 'snoep', 'candy'], category: 'beet_sugar' },
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
  const lower = productName.toLowerCase()
  
  // First: exclude non-food items
  if (isNonFood(productName)) return '__non_food__'
  
  // Second: try exact keyword matches (most specific)
  let bestMatch = null
  let bestMatchLength = 0
  let bestPriority = 0
  
  for (const [category, keywords] of Object.entries(PRODUCT_CATEGORY_KEYWORDS)) {
    for (const keyword of keywords) {
      // Match whole words or word boundaries
      const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i')
      if (regex.test(lower)) {
        const priority = getCategoryPriority(category)
        // Prefer higher priority categories, then longer keyword matches
        if (priority > bestPriority || (priority === bestPriority && keyword.length > bestMatchLength)) {
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

/**
 * Get CO2 emissions for a product
 * @param {string} productName - Product name
 * @returns {Object} - { co2PerKg, category, matched }
 */
function getCO2Emissions(productName) {
  const category = getCO2Category(productName)
  
  // Non-food items
  if (category === '__non_food__') {
    return {
      co2PerKg: null,
      category: '__non_food__',
      matched: false,
      isNonFood: true
    }
  }
  
  if (!category || !CO2_EMISSIONS_DATA[category]) {
    return {
      co2PerKg: null,
      category: null,
      matched: false,
      isNonFood: false
    }
  }
  
  return {
    co2PerKg: CO2_EMISSIONS_DATA[category],
    category,
    matched: true,
    isNonFood: false
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
  getCO2Category,
  getCO2Emissions,
  co2ToScore,
  getCO2Rating,
  getCategoryLabel,
  evaluateProductCO2,
  isNonFood,
  compareToBaseline
}
