/**
 * Agribalyse v3.2 Emission Factors
 * 
 * Source: ADEME Agribalyse® v3.2 — French national LCA database for food products
 * URL: https://agribalyse.ademe.fr/
 * Data access: https://data.ademe.fr/datasets/agribalyse-31-synthese
 * Snapshot used in this repo: ./agribalyse_raw.json
 * License: Licence Ouverte / Open Licence (French government open data)
 * Recommended attribution: "Source ADEME, données AGRIBALYSE (simplified dataset
 * agribalyse-31-synthese), version/snapshot date as documented in DATA_SOURCES.md"
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
  beet_sugar:      { mean:  1.81, min:  1.20, max:  2.50, n:   6, note: 'Beet sugar — using OWID (Poore & Nemecek 2018) value; Agribalyse French mean was 1.18 but beet is locally produced in EU' },
  cane_sugar:      { mean:  3.20, min:  2.00, max:  4.50, n:   1, note: 'Cane sugar — using OWID (Poore & Nemecek 2018) value; Agribalyse had only n=1 (1.04) which omits tropical land-use change' },
  starches:        { mean:  1.54, min:  0.74, max:  2.25, n:  12, note: 'Starches/flours/fecula-like ingredients from Agribalyse matching amidon/fecule/starch terms. Used for ingredients such as zetmeel and modified starches.' },
  syrups_glucose:  { mean:  1.38, min:  0.13, max:  5.63, n:  25, note: 'Syrups and glucose/dextrose-like ingredients from Agribalyse entries matching sirop/glucose/dextrose/maltodextr terms.' },
  emulsifiers_gums:{ mean:  3.73, min:  2.20, max:  5.40, n:   3, note: 'Food emulsifiers and hydrocolloids (e.g., lecithin/gums/pectin-like terms) from Agribalyse ingredient matches; sparse data so uncertainty remains higher.' },

  // Beverages
  coffee:          { mean: 16.50, min: 10.00, max: 28.53, n:   9, note: 'Roasted ground/instant coffee as purchased at retail. Agribalyse brewed coffee is mostly water and not comparable to dry grocery coffee; Poore & Nemecek 2018 gives 16.5 for roasted beans. OWID 28.53 incl. full land-use change is retained as validation/range, not the primary estimate' },
  tea:             { mean:  0.20, min:  0.04, max:  0.42, n:   7, note: 'Brewed tea, herbal infusions' },
  wine:            { mean:  1.60, min:  1.22, max:  2.23, n:  14, note: 'Red, white, rosé, champagne' },
  beer:            { mean:  1.33, min:  1.05, max:  1.74, n:  22, note: 'All beer types' },
  spirits:         { mean:  1.23, min:  1.10, max:  1.26, n:   6, note: 'Vodka, whisky, rum, gin, pastis' },
  soft_drinks:     { mean:  1.24, min:  0.04, max: 29.10, n:  66, note: 'Juice, soda, energy drinks' },
  soy_milk:        { mean:  0.80, min:  0.38, max:  1.52, n:  11, note: 'Soy, oat, rice, almond, coconut drinks' },

  // Chocolate
  dark_chocolate:  { mean: 18.70, min:  5.32, max: 46.65, n:  39, note: 'Dark chocolate / cocoa-rich chocolate. Agribalyse raw mean across chocolate products is lower and mixes cocoa percentages; Poore & Nemecek 2018 gives 18.7 for dark chocolate bars. OWID 46.65 incl. full land-use change is retained as validation/range, not the primary estimate' },

  // Processed categories — all values from AGRIBALYSE v3.2 synthesis table directly
  sauces_condiments:{ mean: 4.052, min:  0.744, max: 23.20, n: 124, note: 'Sauces, condiments, dressings, ketchup, mayo, pesto, tapenade — Agribalyse sauce rows' },
  ready_meals:     { mean:  5.182, min:  1.270, max: 26.30, n:  40, note: 'Pizzas, lasagne, bolognese, carbonara, stews, paella — Agribalyse composed-dish rows' },
  soup:            { mean:  1.803, min:  0.100, max:  9.95, n:  45, note: 'All soup types incl. broth, bouillon, bisque — Agribalyse soup rows' },
  candy_sweets:    { mean:  1.907, min:  1.490, max:  2.18, n:   3, note: 'Jelly candy [1.490]; Nougat [2.050]; Caramelised custard [2.180] — Agribalyse confectionery rows' },
  ice_cream:       { mean:  1.866, min:  1.000, max:  2.55, n:  14, note: 'Ice cream, sorbet, frozen yogurt, ice lolly — Agribalyse frozen-dessert rows' },
  baked_goods:     { mean:  3.827, min:  1.410, max: 10.30, n:  77, note: 'Cakes, biscuits, croissants, muffins, waffles, crepes — Agribalyse baked-goods rows' },
  breakfast_cereal:{ mean:  3.224, min:  1.610, max:  6.89, n:  43, note: 'Muesli, granola, corn flakes, cereal bars — Agribalyse breakfast-cereal rows' },
  spreads:         { mean:  1.835, min:  1.400, max:  2.22, n:   6, note: 'Jam (apricot 1.69, strawberry 1.75, cherry 2.20, raspberry 2.22) — Agribalyse jam/fruit-spread rows' },
  desserts:        { mean:  5.046, min:  2.030, max: 10.70, n:   7, note: 'Cheesecake, flan, mousse, panna cotta — Agribalyse dessert rows' },
  baby_food:       { mean:  2.267, min:  0.683, max:  8.05, n:  12, note: 'Baby food jars, infant formula (powder 8.05, rehydrated 1.09), baby milk — Agribalyse baby-food rows' },
  snacks:          { mean:  1.860, min:  1.860, max:  1.860, n:   1, note: 'Crispbread, extruded and grilled [1.860] — sparse Agribalyse coverage; chips/crisps are under potatoes category' },

  // ── Single vegetables (raw / minimally processed) ────────────────────────────
  // All values exact from AGRIBALYSE v3.2 simplified dataset (agribalyse-31-synthese),
  // field: Changement_climatique (kg CO₂-eq/kg). See DATA_SOURCES.md for verification.
  tomato_raw:      { mean:  0.688, min:  0.626, max:  0.750, n:   2, note: 'Tomato, cherry, raw [0.626]; Tomato, raw [0.750]' },
  cucumber:        { mean:  0.512, min:  0.512, max:  0.512, n:   1, note: 'Cucumber, pulp and peel, raw [0.512]' },
  bell_pepper:     { mean:  0.715, min:  0.715, max:  0.715, n:   2, note: 'Sweet pepper, yellow, raw [0.715]; Sweet pepper, red, raw [0.715]' },
  courgette:       { mean:  0.498, min:  0.498, max:  0.498, n:   1, note: 'Courgette or zucchini, pulp and peel, raw [0.498]' },
  eggplant:        { mean:  0.472, min:  0.472, max:  0.472, n:   1, note: 'Eggplant, raw [0.472]' },
  spinach_leaf:    { mean:  0.423, min:  0.423, max:  0.423, n:   1, note: 'Spinach, raw [0.423]' },
  lettuce_leaf:    { mean:  0.922, min:  0.868, max:  1.030, n:   3, note: 'Lettuce, raw [0.868]; Lamb\'s lettuce, raw [0.868]; Escarole [1.030]' },
  carrot_raw:      { mean:  0.396, min:  0.396, max:  0.396, n:   1, note: 'Carrot, raw [0.396]' },
  onion_raw:       { mean:  0.421, min:  0.421, max:  0.421, n:   1, note: 'Onion, raw [0.421]' },
  garlic_fresh:    { mean:  0.383, min:  0.383, max:  0.383, n:   1, note: 'Garlic, fresh [0.383]' },
  leek_raw:        { mean:  1.046, min:  0.611, max:  1.480, n:   2, note: 'Leek, raw [0.611]; Leek, cooked [1.480]' },
  broccoli_raw:    { mean:  1.320, min:  0.951, max:  1.660, n:   5, note: 'Broccoli, raw [0.951]; cooked; puree — all Agribalyse entries' },
  cauliflower_raw: { mean:  1.210, min:  0.721, max:  1.910, n:   5, note: 'Cauliflower, raw [0.721]; cooked; au gratin' },
  kale:            { mean:  1.157, min:  0.713, max:  1.600, n:   2, note: 'Curly kale, raw [0.713]; Curly kale, cooked [1.600]' },
  celery_raw:      { mean:  1.109, min:  0.632, max:  1.620, n:   4, note: 'Celery stalk, raw; canned, drained; celery salt — Agribalyse entries' },
  asparagus:       { mean:  1.956, min:  1.510, max:  2.860, n:   5, note: 'Asparagus, white or purple, peeled, raw [1.510]; canned; boiled' },
  sweet_corn:      { mean:  1.261, min:  0.852, max:  1.810, n:   4, note: 'Sweet corn, on the cob, frozen, raw [0.852]; on the cob, cooked; canned, drained' },
  pumpkin_squash:  { mean:  0.883, min:  0.612, max:  1.510, n:  10, note: 'Pumpkin, pulp, raw [0.612]; Squash, butternut, raw; Squash, melonnette — all varieties' },
  sweet_potato:    { mean:  0.832, min:  0.334, max:  1.310, n:   3, note: 'Sweet potato, raw [0.334]; cooked; puree with cream' },
  cassava:         { mean:  0.766, min:  0.589, max:  0.942, n:   2, note: 'Cassava or manioc, roots, raw [0.589]; cooked [0.942]' },
  artichoke:       { mean:  2.040, min:  1.410, max:  2.560, n:   6, note: 'Artichoke, globe, raw; heart, canned, drained; canned, drained' },
  green_beans:     { mean:  1.868, min:  0.447, max:  7.080, n:   7, note: 'French bean, raw [0.447]; canned, drained; raw (Kenya by plane) [7.080]' },
  radish:          { mean:  0.384, min:  0.384, max:  0.384, n:   2, note: 'Radish, raw [0.384]; Radish, black, raw [0.384]' },
  turnip:          { mean:  0.663, min:  0.396, max:  1.150, n:   4, note: 'Turnip, peeled, raw [0.396]; Turnip cabbage, raw; Turnip, cooked [1.150]' },
  parsnip:         { mean:  0.917, min:  0.494, max:  1.340, n:   2, note: 'Parsnip, raw [0.494]; Parsnip, cooked [1.340]' },
  fennel_bulb:     { mean:  1.700, min:  1.020, max:  2.130, n:   3, note: 'Fennel, raw [1.020]; Fennel, boiled/cooked [1.950]; Fennel, seed [2.130]' },
  endive_witloof:  { mean:  0.571, min:  0.571, max:  0.571, n:   3, note: 'Red endive, raw [0.571]; Green endive, raw [0.571]; Curly endive, raw [0.571]' },
  beetroot_raw:    { mean:  0.778, min:  0.408, max:  1.160, n:   3, note: 'Beetroot, raw [0.408]; Beetroot, cooked [1.160]; Beetroot juice' },

  // ── Single fruits (raw) ──────────────────────────────────────────────────────
  apple_raw:       { mean:  0.408, min:  0.408, max:  0.408, n:   2, note: 'Apple, pulp and peel, raw [0.408]; Apple, pulp, raw [0.408]' },
  pear_raw:        { mean:  0.387, min:  0.387, max:  0.387, n:   1, note: 'Pear, pulp and peel, raw [0.387]' },
  banana_raw:      { mean:  0.909, min:  0.909, max:  0.909, n:   1, note: 'Banana, pulp, raw [0.909]' },
  orange_raw:      { mean:  0.678, min:  0.678, max:  0.678, n:   1, note: 'Orange, pulp, raw [0.678]' },
  lemon_raw:       { mean:  0.764, min:  0.764, max:  0.764, n:   1, note: 'Lemon, pulp, raw [0.764]' },
  lime_raw:        { mean:  0.570, min:  0.570, max:  0.570, n:   1, note: 'Lime, pulp, raw [0.570]' },
  grapefruit_raw:  { mean:  0.953, min:  0.926, max:  0.979, n:   2, note: 'Grapefruit, yellow, pulp, raw [0.926]; Grapefruit, red or pink, pulp, raw [0.979]' },
  strawberry_raw:  { mean:  0.533, min:  0.533, max:  0.533, n:   1, note: 'Strawberry, raw [0.533]' },
  raspberry_raw:   { mean:  2.143, min:  1.550, max:  3.060, n:   3, note: 'Raspberry, raw [1.550]; Raspberry, frozen, raw; Raspberry, coulis [3.060]' },
  grape_raw:       { mean:  0.510, min:  0.510, max:  0.510, n:   3, note: 'Grape, white, raw [0.510]; Grape, red, raw [0.510]; Grape, raw [0.510]' },
  blueberry_raw:   { mean:  1.056, min:  0.922, max:  1.190, n:   2, note: 'Blueberry, raw [0.922]; Blueberry, frozen, raw [1.190]' },
  cherry_raw:      { mean:  1.740, min:  1.740, max:  1.740, n:   1, note: 'Cherry, pitted, raw [1.740]' },
  peach_raw:       { mean:  1.427, min:  0.579, max:  3.660, n:   7, note: 'Nectarine, pulp and peel, raw [0.579]; Peach, canned in light syrup; Peach nectar [3.660]' },
  plum_raw:        { mean:  2.070, min:  1.030, max:  3.110, n:   2, note: 'Plum, raw [1.030]; Prune [3.110]' },
  mango_raw:       { mean:  0.728, min:  0.728, max:  0.728, n:   1, note: 'Mango, pulp, raw [0.728] — sea-freight route. Air-freight (Brazil by plane) is 11.60; not included here.' },
  pineapple_raw:   { mean:  1.251, min:  0.933, max:  1.630, n:   7, note: 'Pineapple, in pineapple juice and syrup, canned, drained; Pineapple juice entries' },
  melon_raw:       { mean:  0.939, min:  0.859, max:  0.979, n:   3, note: 'Melon, cantaloupe, pulp, raw [0.859]; Melon, honeydew, pulp, raw [0.979]' },
  kiwi_raw:        { mean:  1.000, min:  1.000, max:  1.000, n:   1, note: 'Kiwi fruit, pulp and seeds, raw [1.000]' },
  avocado_raw:     { mean:  1.550, min:  1.550, max:  1.550, n:   1, note: 'Avocado, pulp, raw [1.550]. Avocado oil is 5.840 and counted separately.' },
  apricot_raw:     { mean:  1.444, min:  0.563, max:  3.110, n:   8, note: 'Apricot; canned in light syrup; apricot nectar [3.110]' },
  fig_raw:         { mean:  0.846, min:  0.611, max:  1.080, n:   2, note: 'Fig, raw [0.611]; Fig, dried [1.080]' },
  date_dried:      { mean:  2.890, min:  2.890, max:  2.890, n:   1, note: 'Date, pulp and peel, dried [2.890]' },
  watermelon_raw:  { mean:  0.680, min:  0.680, max:  0.680, n:   1, note: 'Watermelon, pulp, raw [0.680]' },

  // ── Individual grains & pseudo-grains ────────────────────────────────────────
  wheat_flour:     { mean:  0.791, min:  0.791, max:  0.791, n:   7, note: 'Wheat flour (types 55/80/110/150, self-raising) — all 0.791 in Agribalyse' },
  rice_white_raw:  { mean:  2.010, min:  2.010, max:  2.010, n:   2, note: 'Rice, raw [2.010]; Rice, parboiled, raw [2.010]' },
  rice_brown_raw:  { mean:  1.585, min:  1.160, max:  2.010, n:   2, note: 'Rice, brown, raw [2.010]; Rice, brown, cooked, unsalted [1.160]' },
  oat_flakes:      { mean:  1.285, min:  1.010, max:  1.560, n:   2, note: 'Oat flakes, pre-cooked, raw [1.560]; Oat flakes, boiled/cooked in water [1.010]' },
  barley_raw:      { mean:  0.586, min:  0.586, max:  0.586, n:   1, note: 'Barley, whole, raw [0.586]' },
  rye_flour:       { mean:  0.688, min:  0.533, max:  0.760, n:   5, note: 'Rye flour, types 85/130/170 — range 0.533–0.760' },
  spelt_grain:     { mean:  1.080, min:  0.949, max:  1.210, n:   2, note: 'Spelt, raw [0.949]; Spelt flour [1.210]' },
  buckwheat:       { mean:  0.994, min:  0.824, max:  1.210, n:   3, note: 'Buckwheat, whole, raw [0.824]; Buckwheat flour [1.210]; Buckwheat crepe, plain' },
  quinoa:          { mean:  4.735, min:  2.730, max:  7.090, n:   4, note: 'Quinoa FR, raw [2.730]; Quinoa FR, boiled; Quinoa, raw [7.090] — imported variety higher' },
  sorghum_grain:   { mean:  0.427, min:  0.427, max:  0.427, n:   1, note: 'Sorghum, whole, raw [0.427]' },
  millet_grain:    { mean:  0.622, min:  0.310, max:  0.883, n:   3, note: 'Millet flour [0.310]; Millet, whole [0.883]; Millet, cooked, unsalted' },
  maize_flour:     { mean:  1.208, min:  0.865, max:  1.550, n:   2, note: 'Maize/corn flour [0.865]; Maize/corn starch [1.550]' },

  // ── Individual tubers & roots ────────────────────────────────────────────────
  potato_raw:      { mean:  1.093, min:  0.788, max:  1.250, n:   3, note: 'Potato, peeled, raw [0.788]; Potato, boiled/cooked in water [1.250]; Potato, peeled, baked' },
  yam_raw:         { mean:  0.652, min:  0.497, max:  0.806, n:   2, note: 'Yam or Indian potato, peeled, raw [0.497]; boiled/cooked in water [0.806]' },
  taro_raw:        { mean:  1.275, min:  0.690, max:  1.860, n:   2, note: 'Taro, tuber, raw [0.690]; Taro, tuber, cooked [1.860]' },

  // ── Individual legumes (dry/cooked) ──────────────────────────────────────────
  lentils_dry:     { mean:  0.581, min:  0.581, max:  0.581, n:   2, note: 'Lentil, blond, dried [0.581]; Lentil, green, dried [0.581]' },
  chickpeas_dry:   { mean:  0.751, min:  0.603, max:  0.899, n:   2, note: 'Chick pea, cooked [0.603]; Chick pea, dried [0.899]' },
  kidney_beans:    { mean:  0.964, min:  0.585, max:  1.450, n:   3, note: 'Red kidney bean, cooked [0.585]; dried [0.858]; canned, drained [1.450]' },

  // ── Herbs, spices & condiments ───────────────────────────────────────────────
  black_pepper:    { mean:  9.400, min:  9.400, max:  9.400, n:   1, note: 'Black pepper, powder [9.400]' },
  chili_pepper:    { mean:  0.715, min:  0.715, max:  0.715, n:   1, note: 'Chili pepper, raw [0.715]' },
  ginger_fresh:    { mean:  0.494, min:  0.494, max:  0.494, n:   1, note: 'Ginger, raw [0.494]. Ginger powder is 2.500.' },
  cinnamon_powder: { mean:  9.400, min:  9.400, max:  9.400, n:   1, note: 'Cinnamon, powder [9.400] — Agribalyse uses a single dried spice proxy for several spices' },
  cumin_seed:      { mean:  9.400, min:  9.400, max:  9.400, n:   1, note: 'Cumin, seed [9.400]' },
  paprika_dried:   { mean:  9.400, min:  9.400, max:  9.400, n:   1, note: 'Paprika [9.400]' },
  turmeric_powder: { mean:  9.400, min:  9.400, max:  9.400, n:   1, note: 'Turmeric, powder [9.400]' },
  saffron:         { mean:  9.400, min:  9.400, max:  9.400, n:   1, note: 'Saffron [9.400]' },
  coriander_seed:  { mean:  1.580, min:  1.030, max:  2.130, n:   2, note: 'Coriander, seed [1.030]; Coriander, fresh [2.130]' },
  parsley_fresh:   { mean:  2.730, min:  1.120, max:  4.340, n:   2, note: 'Parsley, fresh [1.120]; Parsley, dried [4.340]' },
  basil_fresh:     { mean:  1.730, min:  0.879, max:  2.580, n:   2, note: 'Basil, fresh [0.879]; Basil, dried [2.580]' },
  thyme_fresh:     { mean:  1.730, min:  0.879, max:  2.580, n:   2, note: 'Thyme, fresh [0.879]; Thyme, dried [2.580]' },
  rosemary_fresh:  { mean:  1.730, min:  0.879, max:  2.580, n:   2, note: 'Rosemary, fresh [0.879]; Rosemary, dried [2.580]' },
  oregano_dried:   { mean:  2.580, min:  2.580, max:  2.580, n:   1, note: 'Oregano, dried [2.580]' },
  dill_fresh:      { mean:  0.879, min:  0.879, max:  0.879, n:   1, note: 'Dill, fresh [0.879]' },
  mint_fresh:      { mean:  0.735, min:  0.735, max:  0.735, n:   1, note: 'Mint, fresh [0.735]' },
  vanilla_extract: { mean:  4.380, min:  4.380, max:  4.380, n:   2, note: 'Vanilla, alcoholic extract [4.380]; Vanilla, aqueous extract [4.380]' },
  salt_pure:       { mean:  0.632, min:  0.632, max:  0.632, n:   3, note: 'Salt, white, for human consumption (sea/igneous/rock) [0.632]; Sea salt, grey, no enrichment [0.632]' },
  vinegar:         { mean:  0.920, min:  0.841, max:  0.960, n:   3, note: 'Vinegar [0.960]; Vinegar, balsamic; Vinegar, cider [0.841]' },
  mustard:         { mean:  1.830, min:  1.590, max:  2.310, n:   3, note: 'Mustard [1.590]; Mustard, with grains; Mustard sauce prepacked [2.310]' },
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
