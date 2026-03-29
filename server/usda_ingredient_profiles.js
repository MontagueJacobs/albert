/**
 * USDA FoodData Central - Ingredient Nutritional Profiles
 * 
 * Authoritative per-100g nutritional data for common supermarket ingredients,
 * sourced from USDA FoodData Central (Foundation + SR Legacy datasets).
 * 
 * Used to:
 * 1. Replace hardcoded oil saturated fat fractions with real data
 * 2. Replace hardcoded protein densities with real data
 * 3. Enable reverse-engineering of product compositions:
 *    Given a nutrition label + ordered ingredient list, solve for
 *    ingredient percentages where the nutrition "adds up"
 * 
 * All values are per 100g of the ingredient.
 * Source: https://fdc.nal.usda.gov/ via api.data.gov
 */

const USDA_INGREDIENT_PROFILES = {
  // ============================================================
  // OILS & FATS
  // ============================================================
  'sunflower_oil': {
    fdcId: 2710192,
    description: 'Sunflower oil',
    dutchNames: ['zonnebloemolie'],
    protein: 0, fat: 100, saturated_fat: 8.99, mono_fat: 63.4, poly_fat: 20.7,
    carbs: 0, sugars: 0, fiber: 0, sodium_mg: 0, energy_kcal: 900,
  },
  'rapeseed_oil': {
    fdcId: 748278,
    description: 'Oil, canola (rapeseed)',
    dutchNames: ['koolzaadolie', 'raapzaadolie', 'canola'],
    protein: 0, fat: 100, saturated_fat: 6.61, mono_fat: 62.6, poly_fat: 25.3,
    carbs: 0, sugars: 0, fiber: 0, sodium_mg: 0, energy_kcal: 900,
  },
  'olive_oil': {
    fdcId: 2710186,
    description: 'Olive oil',
    dutchNames: ['olijfolie'],
    protein: 0, fat: 100, saturated_fat: 15.52, mono_fat: 69.7, poly_fat: 10.5,
    carbs: 0, sugars: 0, fiber: 0, sodium_mg: 2, energy_kcal: 900,
  },
  'palm_oil': {
    fdcId: 171015,
    description: 'Oil, palm',
    dutchNames: ['palmolie', 'palmvet'],
    protein: 0, fat: 100, saturated_fat: 49.3, mono_fat: 37.0, poly_fat: 9.3,
    carbs: 0, sugars: 0, fiber: 0, sodium_mg: 0, energy_kcal: 900,
  },
  'soybean_oil': {
    fdcId: 171025,
    description: 'Oil, soybean',
    dutchNames: ['sojaolie'],
    protein: 0, fat: 100, saturated_fat: 15.7, mono_fat: 22.8, poly_fat: 57.7,
    carbs: 0, sugars: 0, fiber: 0, sodium_mg: 0, energy_kcal: 900,
  },
  'coconut_oil': {
    fdcId: 171412,
    description: 'Oil, coconut',
    dutchNames: ['kokosolie', 'kokosvet', 'kokosnotolie'],
    protein: 0, fat: 100, saturated_fat: 82.5, mono_fat: 6.33, poly_fat: 1.68,
    carbs: 0, sugars: 0, fiber: 0, sodium_mg: 0, energy_kcal: 900,
  },
  'butter': {
    fdcId: 789828,
    description: 'Butter, unsalted',
    dutchNames: ['boter', 'roomboter'],
    protein: 0.85, fat: 81.5, saturated_fat: 51.4, mono_fat: 21.0, poly_fat: 3.04,
    carbs: 0.06, sugars: 0.06, fiber: 0, sodium_mg: 10, energy_kcal: 717,
  },
  'cream': {
    fdcId: 170856,
    description: 'Cream, heavy (36% fat)',
    dutchNames: ['room', 'slagroom', 'crème'],
    protein: 2.05, fat: 37.0, saturated_fat: 23.0, mono_fat: 10.7, poly_fat: 1.37,
    carbs: 2.84, sugars: 2.84, fiber: 0, sodium_mg: 38, energy_kcal: 345,
  },
  'margarine': {
    fdcId: 173577,
    description: 'Margarine, regular',
    dutchNames: ['margarine'],
    protein: 0.16, fat: 80.7, saturated_fat: 15.2, mono_fat: 33.0, poly_fat: 27.6,
    carbs: 0.7, sugars: 0, fiber: 0, sodium_mg: 751, energy_kcal: 719,
  },

  // ============================================================
  // DAIRY
  // ============================================================
  'whole_milk': {
    fdcId: 2705385,
    description: 'Milk, whole',
    dutchNames: ['volle melk', 'hele melk'],
    protein: 3.27, fat: 3.2, saturated_fat: 1.86, mono_fat: 0.81, poly_fat: 0.20,
    carbs: 4.63, sugars: 4.81, fiber: 0, sodium_mg: 38, energy_kcal: 61,
  },
  'semi_skimmed_milk': {
    fdcId: 746780,
    description: 'Milk, semi-skimmed (1.5% fat)',
    dutchNames: ['halfvolle melk'],
    protein: 3.37, fat: 1.5, saturated_fat: 0.93, mono_fat: 0.41, poly_fat: 0.06,
    carbs: 4.99, sugars: 4.99, fiber: 0, sodium_mg: 44, energy_kcal: 46,
  },
  'cheese_gouda': {
    fdcId: 170852,
    description: 'Cheese, gouda',
    dutchNames: ['kaas', 'gouda', 'goudse kaas'],
    protein: 24.9, fat: 27.4, saturated_fat: 17.6, mono_fat: 7.7, poly_fat: 0.66,
    carbs: 2.22, sugars: 2.22, fiber: 0, sodium_mg: 819, energy_kcal: 356,
  },
  'yoghurt': {
    fdcId: 170886,
    description: 'Yogurt, plain, whole milk',
    dutchNames: ['yoghurt', 'yogurt', 'kwark'],
    protein: 3.47, fat: 3.25, saturated_fat: 2.1, mono_fat: 0.89, poly_fat: 0.09,
    carbs: 4.66, sugars: 4.66, fiber: 0, sodium_mg: 46, energy_kcal: 61,
  },

  // ============================================================
  // MEATS & FISH
  // ============================================================
  'chicken_breast': {
    fdcId: 2646170,
    description: 'Chicken, breast, raw',
    dutchNames: ['kipfilet', 'kippenborst', 'kip'],
    protein: 22.5, fat: 1.93, saturated_fat: 0.35, mono_fat: 0.37, poly_fat: 0.30,
    carbs: 0, sugars: 0, fiber: 0, sodium_mg: 66, energy_kcal: 114,
  },
  'beef_ground': {
    fdcId: 174035,
    description: 'Beef, ground, raw',
    dutchNames: ['rundergehakt', 'rundvlees'],
    protein: 17.2, fat: 20.0, saturated_fat: 7.63, mono_fat: 8.76, poly_fat: 0.50,
    carbs: 0, sugars: 0, fiber: 0, sodium_mg: 66, energy_kcal: 254,
  },
  'pork': {
    fdcId: 167820,
    description: 'Pork, loin, raw',
    dutchNames: ['varkensvlees', 'varkenshaas', 'spek'],
    protein: 21.1, fat: 5.66, saturated_fat: 1.91, mono_fat: 2.41, poly_fat: 0.77,
    carbs: 0, sugars: 0, fiber: 0, sodium_mg: 52, energy_kcal: 143,
  },
  'salmon': {
    fdcId: 175168,
    description: 'Salmon, Atlantic, raw',
    dutchNames: ['zalm'],
    protein: 20.4, fat: 13.4, saturated_fat: 3.05, mono_fat: 3.77, poly_fat: 5.32,
    carbs: 0, sugars: 0, fiber: 0, sodium_mg: 44, energy_kcal: 208,
  },
  'shrimp': {
    fdcId: 175180,
    description: 'Shrimp, raw',
    dutchNames: ['garnaal', 'garnalen'],
    protein: 20.1, fat: 1.73, saturated_fat: 0.33, mono_fat: 0.25, poly_fat: 0.69,
    carbs: 0.2, sugars: 0, fiber: 0, sodium_mg: 119, energy_kcal: 106,
  },
  'eggs': {
    fdcId: 171287,
    description: 'Egg, whole, raw',
    dutchNames: ['ei', 'eieren'],
    protein: 12.6, fat: 9.51, saturated_fat: 3.13, mono_fat: 3.66, poly_fat: 1.91,
    carbs: 0.72, sugars: 0.37, fiber: 0, sodium_mg: 142, energy_kcal: 143,
  },

  // ============================================================
  // GRAINS & STARCHES
  // ============================================================
  'oats': {
    fdcId: 168872,
    description: 'Oats, whole grain',
    dutchNames: ['haver', 'havermout', 'havervlokken'],
    protein: 17.3, fat: 7.03, saturated_fat: 1.33, mono_fat: 2.38, poly_fat: 2.77,
    carbs: 66.2, sugars: 1.45, fiber: 15.4, sodium_mg: 4, energy_kcal: 389,
  },
  'wheat_flour': {
    fdcId: 789890,
    description: 'Flour, wheat, all-purpose',
    dutchNames: ['tarwebloem', 'tarwemeel', 'bloem', 'meel'],
    protein: 10.9, fat: 1.48, saturated_fat: 0.23, mono_fat: 0.13, poly_fat: 0.63,
    carbs: 77.3, sugars: 0.27, fiber: 2.4, sodium_mg: 2, energy_kcal: 366,
  },
  'rice_white': {
    fdcId: 169756,
    description: 'Rice, white, long-grain, raw',
    dutchNames: ['rijst', 'basmati', 'jasmine'],
    protein: 7.13, fat: 0.66, saturated_fat: 0.18, mono_fat: 0.21, poly_fat: 0.18,
    carbs: 80.0, sugars: 0.12, fiber: 1.3, sodium_mg: 5, energy_kcal: 365,
  },
  'potato': {
    fdcId: 170026,
    description: 'Potatoes, raw',
    dutchNames: ['aardappel', 'aardappelen', 'krieltjes'],
    protein: 2.05, fat: 0.09, saturated_fat: 0.03, mono_fat: 0.00, poly_fat: 0.04,
    carbs: 17.5, sugars: 0.82, fiber: 2.1, sodium_mg: 6, energy_kcal: 77,
  },
  'corn_starch': {
    fdcId: 169690,
    description: 'Cornstarch',
    dutchNames: ['maïszetmeel', 'zetmeel'],
    protein: 0.26, fat: 0.05, saturated_fat: 0.01, mono_fat: 0.02, poly_fat: 0.03,
    carbs: 91.3, sugars: 0, fiber: 0.9, sodium_mg: 9, energy_kcal: 381,
  },

  // ============================================================
  // SUGARS & SWEETENERS
  // ============================================================
  'sugar': {
    fdcId: 746784,
    description: 'Sugar, granulated',
    dutchNames: ['suiker', 'kristalsuiker', 'rietsuiker'],
    protein: 0, fat: 0.32, saturated_fat: 0, mono_fat: 0, poly_fat: 0,
    carbs: 99.6, sugars: 99.6, fiber: 0, sodium_mg: 1, energy_kcal: 385,
  },
  'honey': {
    fdcId: 169640,
    description: 'Honey',
    dutchNames: ['honing'],
    protein: 0.3, fat: 0, saturated_fat: 0, mono_fat: 0, poly_fat: 0,
    carbs: 82.4, sugars: 82.1, fiber: 0.2, sodium_mg: 4, energy_kcal: 304,
  },
  'glucose_syrup': {
    fdcId: 168818,
    description: 'Glucose syrup',
    dutchNames: ['glucosestroop', 'glucosesiroop', 'glucose-fructosestroop'],
    protein: 0, fat: 0, saturated_fat: 0, mono_fat: 0, poly_fat: 0,
    carbs: 76.8, sugars: 38.8, fiber: 0, sodium_mg: 58, energy_kcal: 286,
  },

  // ============================================================
  // LEGUMES & PLANT PROTEINS
  // ============================================================
  'tofu': {
    fdcId: 174291,
    description: 'Tofu, firm',
    dutchNames: ['tofu', 'tahoe'],
    protein: 15.5, fat: 8.72, saturated_fat: 1.26, mono_fat: 1.93, poly_fat: 4.92,
    carbs: 2.78, sugars: 0.62, fiber: 2.3, sodium_mg: 14, energy_kcal: 144,
  },
  'chickpeas': {
    fdcId: 173757,
    description: 'Chickpeas, raw',
    dutchNames: ['kikkererwten', 'kikkererwt'],
    protein: 20.5, fat: 6.04, saturated_fat: 0.63, mono_fat: 1.38, poly_fat: 2.73,
    carbs: 63.0, sugars: 10.7, fiber: 12.2, sodium_mg: 24, energy_kcal: 378,
  },
  'lentils': {
    fdcId: 172421,
    description: 'Lentils, raw',
    dutchNames: ['linzen'],
    protein: 25.8, fat: 1.06, saturated_fat: 0.15, mono_fat: 0.19, poly_fat: 0.53,
    carbs: 63.4, sugars: 2.03, fiber: 10.7, sodium_mg: 6, energy_kcal: 352,
  },

  // ============================================================
  // VEGETABLES & FRUITS
  // ============================================================
  'tomato': {
    fdcId: 170457,
    description: 'Tomatoes, raw',
    dutchNames: ['tomaat', 'tomaten', 'tomatenpuree', 'passata'],
    protein: 0.88, fat: 0.2, saturated_fat: 0.03, mono_fat: 0.03, poly_fat: 0.08,
    carbs: 3.89, sugars: 2.63, fiber: 1.2, sodium_mg: 5, energy_kcal: 18,
  },
  'onion': {
    fdcId: 170000,
    description: 'Onions, raw',
    dutchNames: ['ui', 'uien', 'sjalot'],
    protein: 1.1, fat: 0.1, saturated_fat: 0.04, mono_fat: 0.01, poly_fat: 0.02,
    carbs: 9.34, sugars: 4.24, fiber: 1.7, sodium_mg: 4, energy_kcal: 40,
  },
  'apple': {
    fdcId: 171688,
    description: 'Apples, raw',
    dutchNames: ['appel', 'appelen'],
    protein: 0.26, fat: 0.17, saturated_fat: 0.03, mono_fat: 0.01, poly_fat: 0.05,
    carbs: 13.8, sugars: 10.4, fiber: 2.4, sodium_mg: 1, energy_kcal: 52,
  },
  'banana': {
    fdcId: 173944,
    description: 'Bananas, raw',
    dutchNames: ['banaan', 'bananen'],
    protein: 1.09, fat: 0.33, saturated_fat: 0.11, mono_fat: 0.03, poly_fat: 0.07,
    carbs: 22.8, sugars: 12.2, fiber: 2.6, sodium_mg: 1, energy_kcal: 89,
  },

  // ============================================================
  // NUTS & SEEDS
  // ============================================================
  'peanuts': {
    fdcId: 172430,
    description: 'Peanuts, raw',
    dutchNames: ['pinda', 'pindas', 'pindakaas'],
    protein: 25.8, fat: 49.2, saturated_fat: 6.83, mono_fat: 24.4, poly_fat: 15.6,
    carbs: 16.1, sugars: 4.72, fiber: 8.5, sodium_mg: 18, energy_kcal: 567,
  },
  'almonds': {
    fdcId: 170567,
    description: 'Almonds, raw',
    dutchNames: ['amandel', 'amandelen', 'amandelmelk'],
    protein: 21.2, fat: 49.9, saturated_fat: 3.80, mono_fat: 31.6, poly_fat: 12.3,
    carbs: 21.6, sugars: 4.35, fiber: 12.5, sodium_mg: 1, energy_kcal: 579,
  },

  // ============================================================
  // COCOA & CHOCOLATE
  // ============================================================
  'cocoa_powder': {
    fdcId: 169593,
    description: 'Cocoa, unsweetened powder',
    dutchNames: ['cacao', 'cacaopoeder'],
    protein: 19.6, fat: 13.7, saturated_fat: 8.07, mono_fat: 4.57, poly_fat: 0.44,
    carbs: 57.9, sugars: 1.75, fiber: 33.2, sodium_mg: 21, energy_kcal: 228,
  },
  'cocoa_butter': {
    fdcId: 173576,
    description: 'Cocoa butter',
    dutchNames: ['cacaoboter'],
    protein: 0, fat: 100, saturated_fat: 59.7, mono_fat: 32.9, poly_fat: 3.0,
    carbs: 0, sugars: 0, fiber: 0, sodium_mg: 0, energy_kcal: 884,
  },

  // ============================================================
  // WATER & MISC
  // ============================================================
  'water': {
    fdcId: null,
    description: 'Water',
    dutchNames: ['water'],
    protein: 0, fat: 0, saturated_fat: 0, mono_fat: 0, poly_fat: 0,
    carbs: 0, sugars: 0, fiber: 0, sodium_mg: 0, energy_kcal: 0,
  },
  'salt': {
    fdcId: 173467,
    description: 'Salt, table',
    dutchNames: ['zout', 'zeezout', 'joodzout'],
    protein: 0, fat: 0, saturated_fat: 0, mono_fat: 0, poly_fat: 0,
    carbs: 0, sugars: 0, fiber: 0, sodium_mg: 38758, energy_kcal: 0,
  },
  'soy_sauce': {
    fdcId: 173477,
    description: 'Soy sauce',
    dutchNames: ['sojasaus', 'ketjap'],
    protein: 10.5, fat: 0.1, saturated_fat: 0.01, mono_fat: 0.02, poly_fat: 0.04,
    carbs: 5.57, sugars: 0.4, fiber: 0.8, sodium_mg: 5493, energy_kcal: 53,
  },
  'vinegar': {
    fdcId: 171017,
    description: 'Vinegar',
    dutchNames: ['azijn', 'wijnazijn'],
    protein: 0, fat: 0, saturated_fat: 0, mono_fat: 0, poly_fat: 0,
    carbs: 0.04, sugars: 0.04, fiber: 0, sodium_mg: 2, energy_kcal: 18,
  },
}

// ============================================================================
// LOOKUP FUNCTIONS
// ============================================================================

/**
 * Build lookup indexes for fast ingredient matching.
 * Called once at module load.
 */
const _dutchNameIndex = new Map()  // dutchName → profileKey
const _categoryIndex = new Map()   // CO2 category → profileKey

for (const [key, profile] of Object.entries(USDA_INGREDIENT_PROFILES)) {
  // Index by Dutch names  
  for (const dn of profile.dutchNames || []) {
    _dutchNameIndex.set(dn.toLowerCase(), key)
  }
  // Index by key (which matches CO2 categories in many cases)
  _categoryIndex.set(key, key)
}

/**
 * Look up the USDA nutritional profile for an ingredient.
 * Tries: CO2 category key → Dutch name substring match → null
 * 
 * @param {string} ingredientName - The ingredient name (Dutch or English)
 * @param {string|null} co2Category - The CO2 category key if already matched
 * @returns {Object|null} - The USDA profile or null
 */
function getIngredientProfile(ingredientName, co2Category = null) {
  // 1. Direct category match
  if (co2Category && USDA_INGREDIENT_PROFILES[co2Category]) {
    return USDA_INGREDIENT_PROFILES[co2Category]
  }
  
  if (!ingredientName) return null
  const lower = ingredientName.toLowerCase().trim()
  
  // 2. Exact Dutch name match
  if (_dutchNameIndex.has(lower)) {
    return USDA_INGREDIENT_PROFILES[_dutchNameIndex.get(lower)]
  }
  
  // 3. Substring match (e.g., "koolzaadolie" contains "koolzaadolie")
  let bestMatch = null
  let bestLen = 0
  for (const [dutchName, profileKey] of _dutchNameIndex.entries()) {
    if (lower.includes(dutchName) && dutchName.length > bestLen) {
      bestMatch = profileKey
      bestLen = dutchName.length
    }
  }
  if (bestMatch) {
    return USDA_INGREDIENT_PROFILES[bestMatch]
  }
  
  return null
}

/**
 * Get the saturated fat fraction (of total fat) for an oil/fat ingredient.
 * Returns null if the ingredient isn't an oil/fat or isn't in the database.
 */
function getOilSaturatedFraction(ingredientName, co2Category = null) {
  const profile = getIngredientProfile(ingredientName, co2Category)
  if (!profile || profile.fat < 10) return null // Not a fat-rich ingredient
  return profile.saturated_fat / profile.fat
}

/**
 * Get the protein density (g protein per g ingredient) for a protein source.
 * Returns null if not in database.
 */
function getProteinDensity(ingredientName, co2Category = null) {
  const profile = getIngredientProfile(ingredientName, co2Category)
  if (!profile) return null
  return profile.protein / 100 // Convert per-100g to fraction
}

/**
 * Get the carbohydrate density for a starch/grain ingredient.
 */
function getCarbDensity(ingredientName, co2Category = null) {
  const profile = getIngredientProfile(ingredientName, co2Category)
  if (!profile) return null
  return profile.carbs / 100
}

/**
 * Get the sugar density for a sweetener ingredient.
 */
function getSugarDensity(ingredientName, co2Category = null) {
  const profile = getIngredientProfile(ingredientName, co2Category)
  if (!profile) return null
  return profile.sugars / 100
}

/**
 * Estimate ingredient percentages by solving a constrained system.
 * Given:
 *   - Ordered ingredient list (descending weight, EU law)
 *   - Product nutrition label (per 100g)
 *   - USDA profiles for each ingredient
 * Find ingredient weights where the weighted nutrition sums match the label.
 * 
 * This is a simplified linear approach (not full optimization):
 * For each nutrient, the constraint is:
 *   sum(weight_i * nutrient_density_i) ≈ label_nutrient_value
 * 
 * @param {Array} ingredients - Parsed ingredients [{name, percentage, category}]
 * @param {Object} nutritionLabel - Product nutrition per 100g {fat, saturated_fat, protein, carbs, sugars, fiber, salt}
 * @returns {Array} - Ingredients with estimated percentages
 */
function reverseEngineerComposition(ingredients, nutritionLabel) {
  if (!ingredients || !nutritionLabel) return null
  
  const profiles = ingredients.map(ing => ({
    ...ing,
    profile: getIngredientProfile(ing.name, ing.category)
  }))
  
  // Count how many have USDA profiles
  const withProfiles = profiles.filter(p => p.profile != null)
  if (withProfiles.length < 2) return null // Need at least 2 known ingredients
  
  // Nutrients we can use as constraints
  const constraints = []
  if (nutritionLabel.fat != null) constraints.push({ 
    label: 'fat', value: nutritionLabel.fat, 
    getDensity: p => p.profile ? p.profile.fat / 100 : null 
  })
  if (nutritionLabel.saturated_fat != null) constraints.push({ 
    label: 'saturated_fat', value: nutritionLabel.saturated_fat, 
    getDensity: p => p.profile ? p.profile.saturated_fat / 100 : null 
  })
  if (nutritionLabel.protein != null) constraints.push({ 
    label: 'protein', value: nutritionLabel.protein, 
    getDensity: p => p.profile ? p.profile.protein / 100 : null 
  })
  if (nutritionLabel.carbs != null) constraints.push({ 
    label: 'carbs', value: nutritionLabel.carbs, 
    getDensity: p => p.profile ? p.profile.carbs / 100 : null 
  })
  if (nutritionLabel.sugars != null) constraints.push({ 
    label: 'sugars', value: nutritionLabel.sugars, 
    getDensity: p => p.profile ? p.profile.sugars / 100 : null 
  })
  if (nutritionLabel.fiber != null) constraints.push({ 
    label: 'fiber', value: nutritionLabel.fiber, 
    getDensity: p => p.profile ? p.profile.fiber / 100 : null 
  })
  
  if (constraints.length === 0) return null
  
  // For each constraint, calculate what percentage each ingredient would need
  // to fully explain the nutrient. Then use the minimum across constraints as the cap.
  const estimates = profiles.map((p, i) => {
    if (p.percentage != null) return { ...p, estimatedPct: p.percentage }
    if (!p.profile) return { ...p, estimatedPct: null }
    
    let maxFromConstraints = 100
    
    for (const constraint of constraints) {
      const density = constraint.getDensity(p)
      if (density != null && density > 0.01) {
        // This ingredient at X% would contribute X * density to the nutrient
        // It can't contribute more than the total label value
        const maxPct = constraint.value / density
        maxFromConstraints = Math.min(maxFromConstraints, maxPct)
      }
    }
    
    return { ...p, estimatedPct: maxFromConstraints }
  })
  
  return estimates.map(e => ({
    name: e.name,
    category: e.category,
    estimatedPct: e.estimatedPct != null ? Math.round(e.estimatedPct * 10) / 10 : null,
    hasProfile: e.profile != null,
    profile: e.profile ? {
      protein: e.profile.protein,
      fat: e.profile.fat,
      saturated_fat: e.profile.saturated_fat,
      carbs: e.profile.carbs,
    } : null,
  }))
}

export {
  USDA_INGREDIENT_PROFILES,
  getIngredientProfile,
  getOilSaturatedFraction,
  getProteinDensity,
  getCarbDensity,
  getSugarDensity,
  reverseEngineerComposition,
}
