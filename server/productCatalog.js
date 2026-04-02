/*
 * Curated catalogue of everyday Albert Heijn grocery items with sustainability
 * heuristics. Each entry provides:
 *  - names: common labels and synonyms (nl/en) we match against
 *  - baseScore: starting point (0-10) before category adjustments
 *  - categories: sustainability flags (must map to SUSTAINABILITY_DB categories)
 *  - adjustments: additional nudges that capture nuances (e.g. high emissions)
 *  - suggestions: tailored tips we can surface in the UI
 *  - notes: short explanation presented in the score lookup tool
 */

export const PRODUCT_CATALOG = [
  {
    id: 'bananas',
    names: ['bananas', 'banana', 'bananen'],
    baseScore: 7,
    categories: ['fruit', 'imported'],
    adjustments: [],
    suggestions: [
      '🤝 Kies voor Fair Trade bananen wanneer beschikbaar.',
      '🥝 Varieer met lokaal seizoensfruit zoals appels of peren.'
    ],
    notes: 'Bananen zijn tropisch fruit met transportimpact, maar blijven relatief laag in CO₂. Fair Trade verbetert arbeidsomstandigheden.'
  },
  {
    id: 'fairtrade_bananas',
    names: ['fair trade bananas', 'fairtrade bananas', 'bananen fair trade', 'fairtrade bananen'],
    baseScore: 5,
    categories: ['fruit', 'imported', 'fair_trade'],
    adjustments: [],
    suggestions: [
      '🌍 Mooie keuze! Fair Trade ondersteunt boeren direct.',
      '🥝 Wissel af met lokaal seizoensfruit om transport te beperken.'
    ],
    notes: 'Fair Trade bananen scoren beter dankzij eerlijke handel, al blijft het transport vanuit de tropen nodig.'
  },
  {
    id: 'apples',
    names: ['apples', 'apple', 'appels', 'appel'],
    baseScore: 5,
    categories: ['fruit', 'local'],
    adjustments: [],
    suggestions: [
      '🍏 Koop seizoensrassen van Nederlandse telers voor de laagste CO₂.',
      '🍎 Bewaar koel en donker zodat ze langer meegaan.'
    ],
    notes: 'Lokaal fruit met lage emissie en goede houdbaarheid – uitstekend voor duurzame snacks.'
  },
  {
    id: 'pears',
    names: ['pears', 'peer', 'peren'],
    baseScore: 5,
    categories: ['fruit', 'local'],
    adjustments: [],
    suggestions: [
      '🍐 Combineer met noten voor een verzadigende snack.',
      '🥧 Gebruik rijpere peren in baksels om voedselverspilling te voorkomen.'
    ],
    notes: 'Nederlandse peren zijn seizoensgebonden toppers met een kleine footprint.'
  },
  {
    id: 'oranges',
    names: ['oranges', 'orange', 'sinaasappels', 'sinaasappel'],
    baseScore: 7,
    categories: ['fruit', 'imported'],
    adjustments: [],
    suggestions: [
      '🍊 Pers zelf sap en gebruik de schil in zesten voor minder verspilling.',
      '🥕 Combineer met wortel in smoothies voor extra vezels.'
    ],
    notes: 'Citrus moet reizen, maar blijft voedzaam. Kies waar mogelijk voor verzending per schip in plaats van vliegtuig.'
  },
  {
    id: 'strawberries',
    names: ['strawberries', 'strawberry', 'aardbeien', 'aardbei'],
    baseScore: 6,
    categories: ['fruit', 'imported'],
    adjustments: [
      { code: 'trait_high_emissions', delta: -1 }
    ],
    suggestions: [
      '🍓 Koop in het Nederlandse seizoen of kies diepvries voor lagere footprint.',
      '🍮 Gebruik overrijpe aardbeien in desserts of jam.'
    ],
    notes: 'Buiten het seizoen vragen aardbeien veel energie (kas of transport). Seizoensaankopen zijn aanzienlijk duurzamer.'
  },
  {
    id: 'blueberries',
    names: ['blueberries', 'blueberry', 'blauwe bessen'],
    baseScore: 6,
    categories: ['fruit', 'imported'],
    adjustments: [
      { code: 'trait_high_emissions', delta: -1 }
    ],
    suggestions: [
      '🫐 Kies voor diepvries – vaak duurzamer en net zo voedzaam.',
      '🥣 Strooi over havermout of yoghurt voor een plantaardig ontbijt.'
    ],
    notes: 'Vers ingevlogen bessen hebben een hogere CO₂-voetafdruk; diepvries uit het seizoen is een slimme swap.'
  },
  {
    id: 'potatoes',
    names: ['potatoes', 'potato', 'aardappelen', 'aardappel'],
    baseScore: 5,
    categories: ['vegetable', 'local'],
    adjustments: [],
    suggestions: [
      '🥔 Kies voor ongewassen aardappelen om langer te bewaren.',
      '🔥 Rooster met schil voor meer vezels en minder afval.'
    ],
    notes: 'Nederlandse aardappelen zijn goedkoop, lokaal en veelzijdig – een duurzame basis.'
  },
  {
    id: 'carrots',
    names: ['carrots', 'carrot', 'wortels', 'wortel', 'winterpeen'],
    baseScore: 5,
    categories: ['vegetable', 'local'],
    adjustments: [],
    suggestions: [
      '🥕 Eet rauw als snack of rooster met wat olijfolie.',
      '🥣 Gebruik de loof in pesto om verspilling te verminderen.'
    ],
    notes: 'Peen uit de buurt met lange bewaartijd en lage impact.'
  },
  {
    id: 'broccoli',
    names: ['broccoli'],
    baseScore: 5,
    categories: ['vegetable', 'local'],
    adjustments: [],
    suggestions: [
      '🥦 Stoom kort om voedingsstoffen te behouden.',
      '🥗 Gebruik de stronk in soepen of salades.'
    ],
    notes: 'Broccoli uit de regio heeft een lage footprint en zit vol micronutriënten.'
  },
  {
    id: 'spinach',
    names: ['spinach', 'spinazie'],
    baseScore: 5,
    categories: ['vegetable', 'local'],
    adjustments: [],
    suggestions: [
      '🥬 Kies voor losse bladeren of grootverpakking om plastic te besparen.',
      '🍝 Voeg toe aan pastasaus voor extra groente.'
    ],
    notes: 'Bladgroente met korte keten wanneer in Nederland geteeld.'
  },
  {
    id: 'cucumber',
    names: ['cucumber', 'komkommer'],
    baseScore: 5,
    categories: ['vegetable'],  // Removed 'local' - origin varies by season
    adjustments: [],
    suggestions: [
      '🥒 Koop onverpakt wanneer mogelijk.',
      '🥗 Voeg toe aan salades of infused water.',
      '📅 In het seizoen (apr-okt) komt dit product uit Nederland.'
    ],
    notes: 'Kas-komkommers zijn energiezuinig in het zomerseizoen. Herkomst varieert: NL in zomer, Spanje/import in winter.'
  },
  {
    id: 'cucumber_organic',
    names: ['organic cucumber', 'biologische komkommer', 'bio komkommer'],
    baseScore: 7,
    categories: ['vegetable', 'organic'],  // Removed 'local' - origin varies by season (NL Apr-Oct, Spain/imports otherwise)
    adjustments: [],
    suggestions: [
      '🥒 Bewaar in een koele kast (niet té koud) om de versheid te verlengen.',
      '🌱 Ondersteunt biologische teelt met minder pesticiden.',
      '📅 In het seizoen (apr-okt) komt dit product uit Nederland.'
    ],
    notes: 'Biologische komkommers scoren extra dankzij pesticidevrije teelt. Herkomst varieert per seizoen.'
  },
  {
    id: 'lettuce',
    names: ['lettuce', 'sla', 'kropsla'],
    baseScore: 5,
    categories: ['vegetable', 'local'],
    adjustments: [],
    suggestions: [
      '🥗 Kies voor losse kroppen i.p.v. voorgesneden zakjes om plastic te beperken.',
      '🌿 Gebruik buitenbladeren in soepen of smoothies.'
    ],
    notes: 'Lokale sla heeft lage impact, zeker wanneer onverpakt.'
  },
  {
    id: 'tomatoes',
    names: ['tomatoes', 'tomato', 'tomaten', 'tomaat'],
    baseScore: 5,
    categories: ['vegetable', 'local'],
    adjustments: [],
    suggestions: [
      '🍅 Kies voor seizoens- of buitenteelt tomaten voor de laagste impact.',
      '🍲 Verwerk overrijpe tomaten in soepen of saus.'
    ],
    notes: 'Tomaten uit Nederlandse kassen draaien steeds vaker op geothermie, waardoor de impact daalt.'
  },
  {
    id: 'cherry_tomatoes',
    names: ['cherry tomatoes', 'tros tomaten', 'cherrytomaten'],
    baseScore: 6,
    categories: ['vegetable', 'imported'],
    adjustments: [],
    suggestions: [
      '🍅 Kies voor losse bakjes of herbruikbare zakjes.',
      '🌿 Combineer met basilicum voor een snelle salade.'
    ],
    notes: 'Kleine tomaatjes komen vaker uit het buitenland; kies voor lokale varianten wanneer beschikbaar.'
  },
  {
    id: 'avocado',
    names: ['avocado', 'avocados', 'avocado\'s'],
    baseScore: 6,
    categories: ['fruit', 'imported'],
    adjustments: [
      { code: 'trait_high_emissions', delta: -2 },
      { code: 'trait_water_intensive', delta: -1 }
    ],
    suggestions: [
      '🥑 Koop kleine hoeveelheden en bewaar correct om verspilling te voorkomen.',
      '🌿 Varieer met lokale smeersels zoals kikkererwtenhummus.'
    ],
    notes: 'Avocado\'s zijn waterintensief en reizen ver. Geniet bewust en voorkom verspilling.'
  },
  {
    id: 'oat_milk',
    names: ['oat milk', 'havermelk', 'haverdrank'],
    baseScore: 7,
  categories: ['plant_based'],
    adjustments: [],
    suggestions: [
      '🥛 Plantaardige melk met lage impact – topkeuze!',
      '☕ Gebruik in cappuccino voor een romige schuimlaag.'
    ],
    notes: 'Haverdrank heeft een zeer lage uitstoot en wordt vaak lokaal geproduceerd.'
  },
  {
    id: 'soy_milk',
    names: ['soy milk', 'sojamelk', 'sojadrink', 'sojadrank'],
    baseScore: 7,
  categories: ['plant_based'],
    adjustments: [],
    suggestions: [
      '🥛 Kies bij voorkeur voor Europese sojabonen.',
      '🥣 Combineer met havermout voor een plantaardig ontbijt.'
    ],
    notes: 'Sojadrank heeft een lage impact. Europese sojabonen vermijden ontbossing.'
  },
  {
    id: 'almond_milk',
    names: ['almond milk', 'amandelmelk', 'amandeldrank'],
    baseScore: 6,
  categories: ['plant_based', 'imported'],
    adjustments: [
      { code: 'trait_water_intensive', delta: -1 }
    ],
    suggestions: [
      '🥛 Wissel af met haver- of sojamelk voor een lagere water footprint.',
      '🍪 Gebruik in baksels om zuivel te vermijden.'
    ],
    notes: 'Amandelmelk is plantaardig maar waterintensief. Kies af en toe voor haver of soja.'
  },
  {
    id: 'cow_milk',
    names: ['milk', 'melk', 'volle melk', 'halfvolle melk'],
    baseScore: 5,
    categories: ['dairy'],
    adjustments: [
      { code: 'trait_high_methane', delta: -2 }
    ],
    suggestions: [
      '🥛 Overweeg plantaardige alternatieven zoals haver- of sojamelk.',
      '🧀 Gebruik melk restjes voor pannenkoeken of pap.'
    ],
    notes: 'Koemelk levert voedingsstoffen maar heeft een hogere methaanuitstoot.'
  },
  {
    id: 'organic_milk',
    names: ['organic milk', 'biologische melk', 'bio melk'],
    baseScore: 4,
    categories: ['dairy', 'organic'],
    adjustments: [
      { code: 'trait_high_methane', delta: -2 }
    ],
    suggestions: [
      '🥛 Combineer met plantaardige varianten om impact te verminderen.',
      '🌱 Ondersteunt biologisch veehouden met strengere dierenwelzijnsnormen.'
    ],
    notes: 'Biologische zuivel scoort iets beter door strengere teelteisen, maar blijft methaan-intensief.'
  },
  {
    id: 'yoghurt',
    names: ['yoghurt', 'yogurt'],
    baseScore: 5,
    categories: ['dairy'],
    adjustments: [
      { code: 'trait_high_methane', delta: -1 }
    ],
    suggestions: [
      '🥣 Kies voor plantaardige toppings (notenen, zaden, fruit).',
      '🥛 Vervang af en toe door plantaardige yoghurt voor variatie.'
    ],
    notes: 'Zuivel maar vaak lokaal. Plantaardige alternatieven verlagen de impact.'
  },
  {
    id: 'greek_yoghurt',
    names: ['greek yoghurt', 'griekse yoghurt'],
    baseScore: 5,
    categories: ['dairy'],
    adjustments: [
      { code: 'trait_high_methane', delta: -1 }
    ],
    suggestions: [
      '🥣 Combineer met fruit en noten voor een vullend ontbijt.',
      '🥛 Wissel af met plantaardige varianten om de footprint te beperken.'
    ],
    notes: 'Extra romig maar nog steeds zuivel-gebaseerd – geniet bewust.'
  },
  {
    id: 'cheese',
    names: ['cheese', 'kaas', 'goudse kaas'],
    baseScore: 5,
    categories: ['dairy'],
    adjustments: [
      { code: 'trait_high_methane', delta: -2 }
    ],
    suggestions: [
      '🧀 Gebruik kleinere porties en combineer met plantaardige broodbeleg.',
      '🌿 Probeer eens plantaardige kaasalternatieven.'
    ],
    notes: 'Kaas vraagt veel melk en energie. Beperk porties voor een lagere impact.'
  },
  {
    id: 'butter',
    names: ['butter', 'boter', 'roomboter'],
    baseScore: 5,
    categories: ['dairy'],
    adjustments: [
      { code: 'trait_high_methane', delta: -2 }
    ],
    suggestions: [
      '🧈 Gebruik spaarzaam en wissel af met plantaardige smeersels.',
      '🍞 Kies voor volkorenbrood en beleg rijk met groente.'
    ],
    notes: 'Boter is geconcentreerde zuivelvet met hoge uitstoot.'
  },
  {
    id: 'margarine',
    names: ['margarine', 'plantaardige margarine'],
    baseScore: 6,
    categories: ['plant_based'],
    adjustments: [],
    suggestions: [
      '🌿 Controleer palmolie herkomst; kies voor RSPO of palmolievrije varianten.',
      '🍞 Combineer met groenten of hummus voor extra plantaardige voeding.'
    ],
    notes: 'Plantaardige vetten met lagere uitstoot dan boter. Let wel op palmolie.'
  },
  {
    id: 'eggs_free_range',
    names: ['free range eggs', 'vrije uitloop eieren', 'scharreleieren', 'eieren'],
    baseScore: 5,
    categories: ['egg'],
    adjustments: [
      { code: 'trait_high_methane', delta: -1 }
    ],
    suggestions: [
      '🥚 Kies voor keurmerken zoals Beter Leven 2 of 3 sterren.',
      '🥘 Verwerk restjes in frittata om verspilling te vermijden.'
    ],
    notes: 'Eieren hebben een middelmatige footprint; aandacht voor dierenwelzijn maakt verschil.'
  },
  {
    id: 'eggs_organic',
    names: ['organic eggs', 'biologische eieren'],
    baseScore: 4,
    categories: ['egg', 'organic'],
    adjustments: [
      { code: 'trait_high_methane', delta: -1 }
    ],
    suggestions: [
      '🥚 Gebruik samen met veel groente voor een gebalanceerde maaltijd.',
      '🌱 Biologische houders hebben meer ruimte en biologisch voer.'
    ],
    notes: 'Biologische eieren scoren beter op dierenwelzijn maar houden een dierlijke footprint.'
  },
  {
    id: 'tofu',
    names: ['tofu'],
    baseScore: 7,
    categories: ['plant_based', 'plant_protein'],
    adjustments: [],
    suggestions: [
      '🥬 Marineer goed voor extra smaak.',
      '🍜 Gebruik in roerbak of curry als vleesvervanger.'
    ],
    notes: 'Tofu is eiwitrijk, plantaardig en heeft een zeer lage CO₂-voetafdruk.'
  },
  {
    id: 'tempeh',
    names: ['tempeh'],
    baseScore: 7,
    categories: ['plant_based', 'plant_protein'],
    adjustments: [],
    suggestions: [
      '🍛 Bak krokant met ketjap en gember.',
      '🥗 Snijd in blokjes voor salades met bite.'
    ],
    notes: 'Gefermenteerde sojabonen met veel vezels en minimale impact.'
  },
  {
    id: 'plant_based_burger',
    names: ['plant based burger', 'veggie burger', 'plantaardige burger'],
    baseScore: 7,
    categories: ['plant_based', 'processed', 'plant_protein'],
    adjustments: [],
    suggestions: [
      '🍔 Kies varianten met peulvruchten en weinig verzadigd vet.',
      '🥕 Serveer met veel groente en volkoren brood.'
    ],
    notes: 'Plantaardige burgers scoren beter dan vlees, maar let op het zout- en vetgehalte.'
  },
  {
    id: 'veggie_sausage',
    names: ['veggie sausage', 'plantaardige worst', 'vegetarische worst'],
    baseScore: 7,
    categories: ['plant_based', 'processed', 'plant_protein'],
    adjustments: [
      { code: 'trait_high_salt', delta: -1 }
    ],
    suggestions: [
      '🌭 Combineer met groenterijke bijgerechten.',
      '🌿 Kies varianten met betere Nutri-Score waar mogelijk.'
    ],
    notes: 'Nog steeds bewerkt en soms zout, maar aanzienlijk duurzamer dan vleesworst.'
  },
  {
    id: 'beef_steak',
    names: ['beef steak', 'rundvlees', 'biefstuk'],
    baseScore: 6,
    categories: ['meat'],
    adjustments: [
      { code: 'trait_high_methane', delta: -2 },
      { code: 'trait_high_emissions', delta: -2 }
    ],
    suggestions: [
      '🥩 Beperk porties en kies voor vlees met Beter Leven keurmerk.',
      '🥦 Combineer met extra groente of plantaardige alternatieven.'
    ],
    notes: 'Rundvlees heeft de hoogste klimaatimpact – spaarzaam gebruiken of vervangen.'
  },
  {
    id: 'minced_beef',
    names: ['gehakt', 'rundergehakt', 'minced beef'],
    baseScore: 6,
    categories: ['meat'],
    adjustments: [
      { code: 'trait_high_methane', delta: -2 },
      { code: 'trait_high_emissions', delta: -2 }
    ],
    suggestions: [
      '🍝 Meng met linzen of champignons voor 50/50 gehakt en lagere footprint.',
      '🌯 Gebruik volkoren wraps en veel groente voor balans.'
    ],
    notes: 'Zelfs gemengd vlees blijft emissie-intensief. Meng met peulvruchten voor winst.'
  },
  {
    id: 'chicken_breast',
    names: ['chicken breast', 'kipfilet', 'kip'],
    baseScore: 6,
    categories: ['meat'],
    adjustments: [
      { code: 'trait_high_emissions', delta: -1 }
    ],
    suggestions: [
      '🍗 Kies voor beter leven keurmerken voor beter dierenwelzijn.',
      '🥗 Vervang regelmatig door tofu of tempeh om impact te verlagen.'
    ],
    notes: 'Kip heeft lagere emissies dan rund, maar plantaardige alternatieven scoren nog beter.'
  },
  {
    id: 'pork_chop',
    names: ['pork chop', 'varkensvlees', 'karbonade'],
    baseScore: 6,
    categories: ['meat'],
    adjustments: [
      { code: 'trait_high_emissions', delta: -1 }
    ],
    suggestions: [
      '🥩 Kies voor Beter Leven 2 of 3 sterren voor betere levensstandaarden.',
      '🥕 Combineer met veel groente voor balans.'
    ],
    notes: 'Varkensvlees heeft een middelhoge uitstoot – beperk porties.'
  },
  {
    id: 'salmon',
    names: ['salmon', 'zalm'],
    baseScore: 6,
    categories: ['seafood', 'imported'],
    adjustments: [
      { code: 'trait_high_emissions', delta: -1 }
    ],
    suggestions: [
      '🐟 Kies voor ASC- of MSC-gecertificeerde zalm.',
      '🥦 Vervang af en toe door peulvruchten voor lagere impact.'
    ],
    notes: 'Zalm is voedzaam maar mede door voer en transport niet klimaatneutraal.'
  },
  {
    id: 'tuna_canned',
    names: ['tuna', 'tonijn', 'blik tonijn', 'canned tuna'],
    baseScore: 5,
    categories: ['seafood'],
    adjustments: [
      { code: 'trait_high_emissions', delta: -1 }
    ],
    suggestions: [
      '🐟 Kies voor MSC-keurmerk en vangst met geringe bijvangst.',
      '🥗 Gebruik met veel groente in salades.'
    ],
    notes: 'Tonijn heeft druk op bestanden; kies MSC en gebruik met mate.'
  },
  {
    id: 'shrimp',
    names: ['shrimp', 'garnalen'],
    baseScore: 6,
    categories: ['seafood', 'imported'],
    adjustments: [
      { code: 'trait_high_emissions', delta: -2 }
    ],
    suggestions: [
      '🦐 Kies voor ASC-gecertificeerde Europese garnalen.',
      '🥗 Vervang vaker door plantaardige opties zoals kikkererwten.'
    ],
    notes: 'Garnalenkweek is energie-intensief; beter als luxe product.'
  },
  {
    id: 'chocolate',
    names: ['chocolate', 'chocolade', 'chocolate bar'],
    baseScore: 5,
    categories: ['snack', 'processed'],
    adjustments: [
      { code: 'trait_high_sugar', delta: -1 }
    ],
    suggestions: [
      '🍫 Kies voor kleinere porties en deel met anderen.',
      '🤝 Ga voor Fair Trade of Tony\'s Chocolonely voor betere ketens.'
    ],
    notes: 'Chocolade is energie- en suikerintensief. Fair Trade en kleine porties helpen.'
  },
  {
    id: 'chocolate_fairtrade',
    names: ['fair trade chocolate', 'fairtrade chocolade', 'tony\'s chocolade'],
    baseScore: 5,
    categories: ['snack', 'processed', 'fair_trade'],
    adjustments: [
      { code: 'trait_high_sugar', delta: -1 }
    ],
    suggestions: [
      '🍫 Mooie keuze – let nog steeds op portiegrootte.',
      '☕ Combineer met een kop thee i.p.v. suikerhoudende frisdrank.'
    ],
    notes: 'Eerlijke chocolade helpt boeren, al blijft suiker de beperkende factor.'
  },
  {
    id: 'chips',
    names: ['chips', 'crisps', 'aardappelschips'],
    baseScore: 4,
    categories: ['snack', 'processed'],
    adjustments: [
      { code: 'trait_high_salt', delta: -1 }
    ],
    suggestions: [
      '🥔 Kies ovengebakken varianten of maak zelf chips in de oven.',
      '🥕 Serveer met groentesticks om te variëren.'
    ],
    notes: 'Chips zijn sterk bewerkt en zout – geniet met mate.'
  },
  {
    id: 'soda',
    names: ['soda', 'frisdrank', 'cola'],
    baseScore: 4,
    categories: ['beverage', 'processed'],
    adjustments: [
      { code: 'trait_high_sugar', delta: -1 }
    ],
    suggestions: [
      '🥤 Schakel over op bruiswater met fruit voor minder suiker.',
      '🍋 Voeg citroen of munt toe voor smaak zonder calorieën.'
    ],
    notes: 'Suikerhoudende frisdrank heeft lage voedingswaarde en vraagt veel vervoer.'
  },
  {
    id: 'sparkling_water',
    names: ['sparkling water', 'bruiswater', 'spa rood'],
    baseScore: 6,
    categories: ['beverage'],
    adjustments: [],
    suggestions: [
      '💧 Gebruik een herbruikbare fles of sodastream om vervoer en plastic te beperken.',
      '🍋 Voeg citroen of komkommer toe voor smaak.'
    ],
    notes: 'Mineraalwater zonder suiker; hergebruikbare flessen maken het nóg duurzamer.'
  },
  {
    id: 'pasta',
    names: ['pasta', 'spaghetti', 'penne'],
    baseScore: 5,
    categories: ['grain', 'processed'],
    adjustments: [],
    suggestions: [
      '🍝 Kies voor volkoren varianten voor meer vezels.',
      '🥦 Combineer met groenterijke sauzen om het gerecht te verduurzamen.'
    ],
    notes: 'Pasta heeft een matige footprint; volkorenvarianten leveren meer voedingswaarde.'
  },
  {
    id: 'rice',
    names: ['rice', 'rijst'],
    baseScore: 5,
    categories: ['grain', 'imported'],
    adjustments: [
      { code: 'trait_high_methane', delta: -1 }
    ],
    suggestions: [
      '🍚 Kies voor gecertificeerde rijst met lagere watervoetafdruk (bijv. PlanetProof).',
      '🫘 Combineer met peulvruchten en veel groente.'
    ],
    notes: 'Natrijstteelt stoot methaan uit; kies voor duurzame certificering of alternatieven zoals quinoa.'
  },
  {
    id: 'quinoa',
    names: ['quinoa'],
    baseScore: 6,
    categories: ['grain', 'imported', 'plant_protein'],
    adjustments: [],
    suggestions: [
      '🥗 Kies bij voorkeur Europese quinoa (bijv. Nederlandse teelt).',
      '🍲 Combineer met bonen en groenten voor een complete maaltijd.'
    ],
    notes: 'Quinoa is voedzaam en vaak eerlijk verhandeld; let op herkomst om lokale boeren te steunen.'
  },
  {
    id: 'lentils',
    names: ['lentils', 'linzen'],
    baseScore: 7,
    categories: ['plant_based', 'legume', 'plant_protein'],
    adjustments: [],
    suggestions: [
      '🫘 Gebruik als basis voor soepen, curries of salades.',
      '🍛 Combineer met volkoren granen voor volledige eiwitten.'
    ],
    notes: 'Linzen zijn peulvruchten met hoge voedingswaarde en lage footprint – topkeuze.'
  },
  {
    id: 'chickpeas',
    names: ['chickpeas', 'kikkererwten'],
    baseScore: 7,
    categories: ['plant_based', 'legume', 'plant_protein'],
    adjustments: [],
    suggestions: [
      '🥙 Maak zelf hummus of falafel als vleesvrij alternatief.',
      '🥗 Voeg crunch toe door kikkererwten te roosteren.'
    ],
    notes: 'Kikkererwten leveren eiwitten en vezels met minimale impact.'
  },
  {
    id: 'frozen_pizza',
    names: ['frozen pizza', 'diepvriespizza'],
    baseScore: 4,
    categories: ['processed'],
    adjustments: [
      { code: 'trait_high_salt', delta: -1 }
    ],
    suggestions: [
      '🍕 Voeg extra groente toe en kies voor vegetarische varianten.',
      '🥗 Serveer met een slaatje om het gerecht te balanceren.'
    ],
    notes: 'Kant-en-klare pizza is handig maar bevat weinig groente en veel zout.'
  },
  {
    id: 'ready_meal',
    names: ['ready meal', 'magnetronmaaltijd', 'kant en klare maaltijd'],
    baseScore: 4,
    categories: ['processed'],
    adjustments: [
      { code: 'trait_high_salt', delta: -1 }
    ],
    suggestions: [
      '🍽️ Voeg extra groente toe of kies voor koelverse varianten met Nutri-Score A/B.',
      '🥗 Maak zelf een batch-kook recept voor een gezonder alternatief.'
    ],
    notes: 'Handig maar vaak zout en minder voedzaam; maak thuis een upgrade met verse groente.'
  }
]

export function normalizeProductName(value = '') {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // Strip diacritics (é→e, è→e, etc.)
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export const CATALOG_INDEX = PRODUCT_CATALOG.map((entry) => {
  const normalizedNames = entry.names.map((name) => normalizeProductName(name))
  return {
    ...entry,
    normalizedNames
  }
})