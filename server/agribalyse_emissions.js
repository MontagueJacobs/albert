/**
 * Agribalyse v3.2 Emission Factors
 * 
 * Source: ADEME Agribalyse® v3.2 — French national LCA database for food products
 * URL: https://agribalyse.ademe.fr/
 * Data access: https://data.ademe.fr/datasets/agribalyse-31-synthese
 * License: Licence Ouverte / Open Licence (French government open data)
 * 
 * Methodology:
 *   - Life Cycle Assessment (LCA) using Environmental Footprint (EF) method
 *   - Scope: farm-to-plate (agriculture, processing, packaging, transport, retail, cooking)
 *   - Geography: France (representative for Western European production systems)
 *   - 2,451 food products aggregated into our ~50 ingredient categories
 * 
 * Values are in kgCO₂-eq per kg of food product (climate change indicator).
 * 
 * Aggregation method:
 *   Each Agribalyse product is mapped to one of our CO₂ categories by subgroup
 *   and English product name keywords. Per category, we report:
 *     - mean: arithmetic mean across all matched Agribalyse items
 *     - min / max: range (10th and 90th percentile for categories with n > 20)
 *     - n: number of Agribalyse products mapped to this category
 * 
 * Key differences vs OWID (Our World in Data):
 *   - OWID uses Poore & Nemecek (2018) global averages including land use change
 *   - Agribalyse uses French production systems (lower beef, higher vegetables due
 *     to greenhouse cultivation, lower coffee/chocolate because they stop at import)
 *   - The two datasets are complementary: Agribalyse is more specific for European
 *     consumption, OWID captures global supply chain externalities
 * 
 * Note on processed products:
 *   Agribalyse includes fully processed items (e.g. "Beef stew with vegetables"),
 *   which incorporate cooking energy and processing losses. For ingredient-level
 *   calculations, we use only the raw/minimally-processed items where possible.
 */

/**
 * Aggregated Agribalyse emission factors per ingredient category.
 * Each entry has: mean, min, max (kgCO₂e/kg), n (source items), sampleItems
 */
const AGRIBALYSE_EMISSIONS = {
  // Meat
  beef_dairy:      { mean: 28.54, min:  5.04, max: 46.00, n: 105, note: 'French avg incl. veal; mostly dairy-herd beef (dual-purpose cattle)' },
  beef_herd:       { mean: 38.70, min: 28.70, max: 99.48, n:  28, note: 'NL import-weighted: 75% EU (Agribalyse 30.9) + 9% South America (OWID 99.5) + 16% other (~40). Trade data: WWF-NL (2024). EU beef similar to Agribalyse; SA imports carry high land-use change emissions' },
  lamb_mutton:     { mean: 35.59, min: 21.60, max: 52.50, n:  40, note: 'Lamb, mutton, sheep offal' },
  pig_meat:        { mean:  7.64, min:  2.11, max: 28.90, n: 175, note: 'Includes charcuterie (ham, sausage, bacon)' },
  poultry_meat:    { mean:  5.28, min:  1.50, max: 14.60, n:  94, note: 'Chicken, turkey, duck' },

  // Seafood
  fish_farmed:     { mean:  8.21, min:  2.60, max: 18.10, n: 206, note: 'All fish + molluscs + seafood products' },
  shrimps_farmed:  { mean: 24.15, min:  7.57, max: 41.60, n:   9, note: 'Shrimp, prawn, lobster, crab' },

  // Dairy & Eggs
  cheese:          { mean: 12.00, min:  1.87, max: 23.88, n: 187, note: 'Hard/semi-hard cheese; blended: Agribalyse FR avg 5.22 underestimates due to French dairy efficiency, OWID global 23.88, literature consensus ~10-14 for Dutch supermarket cheese (Poore & Nemecek 2018)' },
  milk:            { mean:  3.22, min:  1.15, max:  5.50, n:  94, note: 'Liquid dairy: milk, yoghurt, cream, vla, custard' },
  butter:          { mean: 11.52, min:  8.60, max: 12.50, n:  12, note: 'Butter/roomboter; ~20L milk per kg → high concentration factor. Clune et al. 2017 median 9.0, OWID implied ~11-12, Agribalyse max-range dairy items 12.5' },
  margarine:       { mean:  3.30, min:  1.50, max:  5.00, n:   5, note: 'Plant-based spread; mainly sunflower/rapeseed oil + water + emulsifiers. Lower than butter due to plant oil base (Poore & Nemecek 2018)' },
  eggs:            { mean:  2.80, min:  1.23, max:  5.06, n:  43, note: 'Includes egg-based products (omelette, quiche filling)' },

  // Oils & Fats
  olive_oil:       { mean:  1.94, min:  1.63, max:  2.24, n:   2, note: 'Extra-virgin and virgin olive oil' },
  rapeseed_oil:    { mean:  2.16, min:  1.81, max:  2.50, n:   2, note: 'Rapeseed/canola oil' },
  sunflower_oil:   { mean:  4.06, min:  1.64, max: 27.40, n:  33, note: 'Includes margarines and generic vegetable oils' },
  soybean_oil:     { mean:  3.73, min:  3.73, max:  3.73, n:   1, note: 'Single Agribalyse entry' },
  palm_oil:        { mean:  5.27, min:  4.03, max:  6.65, n:   4, note: 'Palm + coconut oil' },

  // Grains & Cereals
  rice:            { mean:  1.70, min:  1.16, max:  2.86, n:  14, note: 'White, brown, basmati, risotto rice' },
  wheat_rye:       { mean:  1.80, min:  0.31, max:  7.09, n: 145, note: 'Flour, pasta, bread, pastry dough, couscous' },
  barley:          { mean:  0.52, min:  0.40, max:  0.59, n:   3, note: 'Pearl barley, barley flour' },
  maize:           { mean:  1.02, min:  0.57, max:  1.55, n:   5, note: 'Corn starch, polenta, corn flour' },
  oatmeal:         { mean:  0.95, min:  0.95, max:  0.95, n:   1, note: 'Oat flakes (single Agribalyse entry)' },

  // Legumes & Nuts
  other_pulses:    { mean:  0.70, min:  0.41, max:  1.45, n:  30, note: 'Beans, lentils, chickpeas' },
  peas:            { mean:  0.93, min:  0.54, max:  2.20, n:   6, note: 'Green peas, split peas' },
  tofu:            { mean:  2.02, min:  0.54, max:  3.93, n:  31, note: 'Includes plant-based meat alternatives' },
  groundnuts:      { mean:  4.16, min:  4.06, max:  4.20, n:   5, note: 'Peanuts, peanut butter' },
  nuts:            { mean:  3.43, min:  1.25, max:  7.39, n:  44, note: 'Almonds, walnuts, cashews, hazelnuts, seeds' },

  // Fruits
  bananas:         { mean:  1.55, min:  0.91, max:  2.20, n:   2, note: 'Fresh + dried banana' },
  citrus_fruit:    { mean:  0.83, min:  0.47, max:  1.30, n:   9, note: 'Orange, lemon, grapefruit, clementine' },
  apples:          { mean:  0.92, min:  0.39, max:  1.64, n:  17, note: 'Apple, pear, quince' },
  berries_grapes:  { mean:  1.32, min:  0.51, max:  3.24, n:  21, note: 'Strawberry, raspberry, grape, blueberry, currant' },
  other_fruit:     { mean:  1.37, min:  0.50, max: 11.60, n:  49, note: 'Mango, pineapple, melon, peach, plum, etc.' },

  // Vegetables
  tomatoes:        { mean:  2.72, min:  0.63, max: 11.20, n:  15, note: 'Fresh, canned, paste; high due to greenhouse cultivation' },
  brassicas:       { mean:  1.10, min:  0.49, max:  1.68, n:  25, note: 'Broccoli, cabbage, cauliflower, kale, Brussels sprouts' },
  onions_leeks:    { mean:  1.32, min:  0.39, max:  3.56, n:  11, note: 'Onion, leek, garlic, shallot' },
  potatoes:        { mean:  1.32, min:  0.33, max:  4.94, n:  46, note: 'Fresh, frozen, fries, mashed, crisps' },
  root_vegetables: { mean:  0.85, min:  0.38, max:  1.36, n:  19, note: 'Carrot, parsnip, beet, turnip, radish' },
  other_vegetables:{ mean:  2.39, min:  0.42, max: 11.80, n: 140, note: 'Peppers, courgette, spinach, mushroom, etc.' },

  // Sugar
  beet_sugar:      { mean:  1.18, min:  0.75, max:  1.92, n:   6, note: 'Sugar, honey, syrup (mostly beet-origin in France)' },
  cane_sugar:      { mean:  1.04, min:  1.04, max:  1.04, n:   1, note: 'Single entry (cane sugar rare in French data)' },

  // Beverages
  coffee:          { mean: 16.50, min: 10.00, max: 28.53, n:   9, note: 'Roasted ground coffee as purchased at retail (~500g packs). Agribalyse raw 2.31 = brewed coffee (98% water), not grocery product. Poore & Nemecek 2018: 16.5 for roasted beans. OWID 28.53 incl. full land-use change' },
  tea:             { mean:  0.20, min:  0.04, max:  0.42, n:   7, note: 'Brewed tea, herbal infusions' },
  wine:            { mean:  1.60, min:  1.22, max:  2.23, n:  14, note: 'Red, white, rosé, champagne' },
  beer:            { mean:  1.33, min:  1.05, max:  1.74, n:  22, note: 'All beer types' },
  spirits:         { mean:  1.23, min:  1.10, max:  1.26, n:   6, note: 'Vodka, whisky, rum, gin, pastis' },
  soft_drinks:     { mean:  1.24, min:  0.04, max: 29.10, n:  66, note: 'Juice, soda, energy drinks' },
  soy_milk:        { mean:  0.80, min:  0.38, max:  1.52, n:  11, note: 'Soy, oat, rice, almond, coconut drinks' },

  // Chocolate
  dark_chocolate:  { mean: 18.70, min:  5.32, max: 46.65, n:  39, note: 'Dark chocolate (>50% cocoa). Agribalyse raw 9.06 = mean across all chocolate incl. milk chocolate/confections (30-50% cocoa). For dark chocolate bars: Poore & Nemecek 2018 gives 18.7. OWID 46.65 incl. full land-use change' },

  // Processed categories
  sauces_condiments:{ mean: 2.96, min:  0.37, max: 13.20, n: 134, note: 'Sauces, condiments, herbs, spices, salt, cooking aids' },
  ready_meals:     { mean:  7.29, min:  0.56, max: 52.40, n: 192, note: 'Composed dishes, pizzas, sandwiches, salads, entrées' },
  soup:            { mean:  2.11, min:  0.10, max:  9.95, n:  36, note: 'All soup types' },
  candy_sweets:    { mean:  1.49, min:  0.86, max:  2.12, n:   9, note: 'Non-chocolate confectionery' },
  ice_cream:       { mean:  2.09, min:  1.00, max:  4.24, n:  25, note: 'Ice cream, sorbet, frozen desserts' },
  baked_goods:     { mean:  3.50, min:  0.82, max: 10.30, n: 196, note: 'Cakes, biscuits, breakfast cereals, pastries' },
  spreads:         { mean:  1.87, min:  1.40, max:  2.22, n:   7, note: 'Jams, preserves' },
  baby_food:       { mean:  1.75, min:  0.68, max:  8.05, n:  38, note: 'Infant formula, baby cereals, baby meals' },
}

/**
 * Get the Agribalyse emission data for a category.
 * @param {string} category - Our CO₂ category key
 * @returns {{ mean: number, min: number, max: number, n: number, note: string } | null}
 */
function getAgribalyseEmission(category) {
  return AGRIBALYSE_EMISSIONS[category] || null
}

export { AGRIBALYSE_EMISSIONS, getAgribalyseEmission }
