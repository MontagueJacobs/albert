/**
 * CO2 Experiment scoring and item management
 * 
 * Handles:
 * - Distance-based ranking accuracy scoring (sum of |position differences|, normalized 0-100)
 * - Generic product pool for quiz 1 & 3 (well-known items with known CO2 values)
 * - Item deduplication across quizzes
 * - A/B variant assignment
 */

import {
  getCO2Emissions,
  co2ToScore,
  isNonFood,
  getProductWeight
} from './co2Emissions.js'

// ===========================================================================
// GENERIC PRODUCT POOLS
// Well-known grocery items with reliable CO2/kg data, split into two pools
// Pool A = quiz 1 (pre-intervention), Pool B = quiz 3 (post-intervention)
// Each pool has items spanning low → high CO2 for meaningful ranking
// ===========================================================================
const GENERIC_POOL_A = [
  { name: 'Ground Beef', nameNl: 'Rundergehakt', image: '🥩' },
  { name: 'Chicken Breast', nameNl: 'Kipfilet', image: '🍗' },
  { name: 'Cheese', nameNl: 'Kaas', image: '🧀' },
  { name: 'Milk', nameNl: 'Melk', image: '🥛' },
  { name: 'Rice', nameNl: 'Rijst', image: '🍚' },
  { name: 'Bread', nameNl: 'Brood', image: '🍞' },
  { name: 'Potato', nameNl: 'Aardappel', image: '🥔' },
]

const GENERIC_POOL_B = [
  { name: 'Lamb', nameNl: 'Lamsvlees', image: '🍖' },
  { name: 'Pork', nameNl: 'Varkensvlees', image: '🥓' },
  { name: 'Butter', nameNl: 'Boter', image: '🧈' },
  { name: 'Eggs', nameNl: 'Eieren', image: '🥚' },
  { name: 'Banana', nameNl: 'Banaan', image: '🍌' },
  { name: 'Lentils', nameNl: 'Linzen', image: '🫘' },
  { name: 'Chocolate', nameNl: 'Chocolade', image: '🍫' },
]

// ===========================================================================
// AH-SPECIFIC PRODUCT POOLS (quiz 5 & 6)
// Recognisable Albert Heijn products spanning low → high CO2
// Pool C = quiz 5 (pre-intervention), Pool D = quiz 6 (post-intervention)
// ===========================================================================
const AH_POOL_C = [
  { name: 'AH Rundergehakt',           nameNl: 'AH Rundergehakt',           image: '🥩', image_url: 'https://static.ah.nl/dam/product/AHI_4354523130303937393037?revLabel=1&rendition=200x200_JPG_Q85&fileType=binary' },
  { name: 'AH Scharrel kipfilet',      nameNl: 'AH Scharrel kipfilet',      image: '🍗', image_url: 'https://static.ah.nl/dam/product/AHI_43545239393132353833?revLabel=1&rendition=200x200_JPG_Q85&fileType=binary' },
  { name: 'AH Geraspte kaas',          nameNl: 'AH Geraspte kaas',          image: '🧀', image_url: 'https://static.ah.nl/dam/product/AHI_4354523130313838303239?revLabel=1&rendition=200x200_JPG_Q85&fileType=binary' },
  { name: 'AH Halfvolle melk',         nameNl: 'AH Halfvolle melk',         image: '🥛', image_url: 'https://static.ah.nl/dam/product/AHI_4354523130303337393339?revLabel=1&rendition=200x200_JPG_Q85&fileType=binary' },
  { name: 'AH Spaghetti',              nameNl: 'AH Spaghetti',              image: '🍝', image_url: 'https://static.ah.nl/dam/product/AHI_43545239383939363230?revLabel=1&rendition=200x200_JPG_Q85&fileType=binary' },
  { name: 'AH Trostomaten',            nameNl: 'AH Trostomaten',            image: '🍅', image_url: 'https://static.ah.nl/dam/product/AHI_4354523130313637333535?revLabel=1&rendition=200x200_JPG_Q85&fileType=binary' },
  { name: 'AH Witte bonen',            nameNl: 'AH Witte bonen',            image: '🫘', image_url: 'https://static.ah.nl/dam/product/AHI_523161594733674e536c474a58762d6270776e534c67?revLabel=1&rendition=200x200_JPG_Q85&fileType=binary' },
]

const AH_POOL_D = [
  { name: 'AH Lamsfilet',              nameNl: 'AH Lamsfilet',              image: '🍖', image_url: 'https://static.ah.nl/dam/product/AHI_4354523130303937393430?revLabel=1&rendition=200x200_JPG_Q85&fileType=binary' },
  { name: 'AH Varkenshaas',            nameNl: 'AH Varkenshaas',            image: '🥓', image_url: 'https://static.ah.nl/dam/product/AHI_4354523130303938303033?revLabel=1&rendition=200x200_JPG_Q85&fileType=binary' },
  { name: 'AH Mozzarella',            nameNl: 'AH Mozzarella',            image: '🧀', image_url: 'https://static.ah.nl/dam/product/AHI_43545239373537333131?revLabel=1&rendition=200x200_JPG_Q85&fileType=binary' },
  { name: 'AH Scharreleieren',        nameNl: 'AH Scharreleieren',        image: '🥚', image_url: 'https://static.ah.nl/dam/product/AHI_4354523130313931353932?revLabel=1&rendition=200x200_JPG_Q85&fileType=binary' },
  { name: 'AH Broccoliroosjes',       nameNl: 'AH Broccoliroosjes',       image: '🥦', image_url: 'https://static.ah.nl/dam/product/AHI_4354523130313836313439?revLabel=1&rendition=200x200_JPG_Q85&fileType=binary' },
  { name: 'AH Havermout',             nameNl: 'AH Havermout',             image: '🥣', image_url: 'https://static.ah.nl/dam/product/AHI_4354523130313931343330?revLabel=1&rendition=200x200_JPG_Q85&fileType=binary' },
  { name: 'AH Kikkererwten',          nameNl: 'AH Kikkererwten',          image: '🫘', image_url: 'https://static.ah.nl/dam/product/AHI_38597863424b726f534f4f6b32357370696331484841?revLabel=1&rendition=200x200_JPG_Q85&fileType=binary' },
]

/**
 * Calculate CO2/kg for a product name using the existing CO2 engine
 */
export function getProductCO2(productName) {
  const co2Data = getCO2Emissions(productName)
  return {
    co2PerKg: co2Data.co2PerKg,
    category: co2Data.category,
    matched: co2Data.matched
  }
}

/**
 * Enrich a generic pool item with CO2 data
 */
function enrichPoolItem(item) {
  // Always use Dutch name for CO2 lookup (the CO2 engine uses Dutch keywords)
  const co2 = getProductCO2(item.nameNl || item.name)
  return {
    id: `generic_${(item.nameNl || item.name).toLowerCase().replace(/\s+/g, '_')}`,
    name: item.name,
    nameNl: item.nameNl,
    image_emoji: item.image,
    image_url: item.image_url || null,
    source: 'generic',
    co2PerKg: co2.co2PerKg,
    co2Category: co2.category,
    co2Matched: co2.matched
  }
}

/**
 * Get generic items for quiz 1 (pre-intervention baseline)
 * Returns items with valid CO2 data, shuffled
 */
export function getGenericQuiz1Items() {
  const items = GENERIC_POOL_A
    .map(enrichPoolItem)
    .filter(item => item.co2PerKg != null && item.co2PerKg > 0)
  
  // Shuffle
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]]
  }
  return items
}

/**
 * Get generic items for quiz 3 (post-intervention test)
 * Returns items with valid CO2 data, shuffled, no overlap with quiz 1
 */
export function getGenericQuiz3Items() {
  const items = GENERIC_POOL_B
    .map(enrichPoolItem)
    .filter(item => item.co2PerKg != null && item.co2PerKg > 0)
  
  // Shuffle
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]]
  }
  return items
}

/**
 * Get AH-specific items for quiz 5 (pre-intervention AH knowledge)
 */
export function getAHQuiz5Items() {
  const items = AH_POOL_C
    .map(enrichPoolItem)
    .filter(item => item.co2PerKg != null && item.co2PerKg > 0)
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]]
  }
  return items
}

/**
 * Get AH-specific items for quiz 6 (post-intervention AH knowledge)
 */
export function getAHQuiz6Items() {
  const items = AH_POOL_D
    .map(enrichPoolItem)
    .filter(item => item.co2PerKg != null && item.co2PerKg > 0)
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]]
  }
  return items
}

/**
 * Calculate ranking accuracy score using distance metric
 * 
 * How it works:
 * 1. Correct order = sorted by CO2/kg descending (highest CO2 first)
 * 2. For each item, calculate |user_position - correct_position|
 * 3. Sum all absolute differences = total distance
 * 4. Maximum possible distance for n items = n²/2 (roughly)
 * 5. Normalize: score = 100 * (1 - total_distance / max_distance)
 * 
 * @param {Array} userRanking - Items in user's order (index = rank)
 * @param {Array} items - Items with co2PerKg values
 * @returns {{ score: number, maxScore: number, totalDistance: number, maxDistance: number, details: Array }}
 */
export function calculateRankingScore(userRanking, items) {
  const n = userRanking.length
  if (n === 0) return { score: 0, maxScore: 100, totalDistance: 0, maxDistance: 0, details: [] }
  
  // Correct order: sorted by CO2/kg descending (highest first = rank 1)
  const correctOrder = [...items].sort((a, b) => {
    const aCO2 = a.co2PerKg ?? 0
    const bCO2 = b.co2PerKg ?? 0
    return aCO2 - bCO2  // ascending: 1 = best (lowest CO₂), 7 = worst (highest CO₂)
  })
  
  // Build map: item id → correct rank (0-indexed)
  const correctRankMap = new Map()
  correctOrder.forEach((item, idx) => {
    correctRankMap.set(item.id, idx)
  })
  
  // Calculate total absolute distance
  let totalDistance = 0
  const details = userRanking.map((item, userRank) => {
    const correctRank = correctRankMap.get(item.id) ?? userRank
    const distance = Math.abs(userRank - correctRank)
    totalDistance += distance
    
    return {
      id: item.id,
      name: item.name,
      nameNl: item.nameNl || item.name,
      userRank: userRank + 1,  // 1-indexed for display
      correctRank: correctRank + 1,
      distance,
      co2PerKg: item.co2PerKg,
      isExact: distance === 0
    }
  })
  
  // Maximum possible distance for n items
  // Worst case: reversed order. For n items, max distance = floor(n²/2)
  const maxDistance = Math.floor(n * n / 2)
  
  // Normalize to 0-100 (100 = perfect)
  const score = maxDistance > 0 
    ? Math.round(100 * (1 - totalDistance / maxDistance)) 
    : 100
  
  return {
    score: Math.max(0, score),  // Clamp to 0 minimum
    maxScore: 100,
    totalDistance,
    maxDistance,
    details,
    correctOrder: correctOrder.map((item, idx) => ({
      id: item.id,
      name: item.name,
      nameNl: item.nameNl || item.name,
      rank: idx + 1,
      co2PerKg: item.co2PerKg
    }))
  }
}

/**
 * Assign A/B test variant deterministically from bonus card
 * Uses simple hash to get consistent assignment per participant
 */
export function assignABVariant(bonusCard) {
  let hash = 0
  const str = String(bonusCard)
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32-bit integer
  }
  return Math.abs(hash) % 2 === 0 ? 'A' : 'B'
}

/**
 * Self-perception questions (Likert 1-5)
 * Asked pre-intervention to gauge self-assessment
 */
export const SELF_PERCEPTION_QUESTIONS = [
  {
    id: 'sp_knowledge',
    text: 'How well do you think you know the CO₂ impact of different food products?',
    textNl: 'Hoe goed denkt u de CO₂-impact van verschillende voedselproducten te kennen?',
    anchors: { low: 'Not at all', lowNl: 'Helemaal niet', high: 'Very well', highNl: 'Zeer goed' }
  },
  {
    id: 'sp_confidence',
    text: 'How confident are you in ranking products by their environmental impact?',
    textNl: 'Hoe zeker bent u dat u producten kunt rangschikken op milieu-impact?',
    anchors: { low: 'Not confident', lowNl: 'Niet zeker', high: 'Very confident', highNl: 'Zeer zeker' }
  },
  {
    id: 'sp_awareness',
    text: 'How often do you consider CO₂ emissions when buying groceries?',
    textNl: 'Hoe vaak houdt u rekening met CO₂-uitstoot bij het kopen van boodschappen?',
    anchors: { low: 'Never', lowNl: 'Nooit', high: 'Always', highNl: 'Altijd' }
  },
  {
    id: 'sp_comparison',
    text: 'Compared to the average person, how well do you think you understand food sustainability?',
    textNl: 'Vergeleken met de gemiddelde persoon, hoe goed begrijpt u voedselduurzaamheid?',
    anchors: { low: 'Much worse', lowNl: 'Veel slechter', high: 'Much better', highNl: 'Veel beter' }
  }
]

/**
 * Reflection questions (post-intervention)
 * Mix of yes/no and open-ended
 */
export const REFLECTION_QUESTIONS = [
  {
    id: 'ref_surprised',
    text: 'Were you surprised by any of the correct CO₂ rankings?',
    textNl: 'Was u verrast door een van de juiste CO₂-rangschikkingen?',
    type: 'yesno'
  },
  {
    id: 'ref_learned',
    text: 'Did you learn something new about the environmental impact of food?',
    textNl: 'Heeft u iets nieuws geleerd over de milieu-impact van voedsel?',
    type: 'yesno'
  },
  {
    id: 'ref_change_intent',
    text: 'Do you think this information will change how you shop for groceries?',
    textNl: 'Denkt u dat deze informatie zal veranderen hoe u boodschappen doet?',
    type: 'yesno'
  },
  {
    id: 'ref_most_surprising',
    text: 'What surprised you the most about the CO₂ impact of food products?',
    textNl: 'Wat verbaasde u het meest over de CO₂-impact van voedselproducten?',
    type: 'open'
  },
  {
    id: 'ref_feedback',
    text: 'Do you have any other thoughts or feedback about this experiment?',
    textNl: 'Heeft u nog andere gedachten of feedback over dit experiment?',
    type: 'open'
  }
]

/**
 * Steps in the V2 experiment flow (ordered, linear)
 */
export const EXPERIMENT_STEPS = [
  'consent',
  'scrape',
  'pre_quiz_general',
  'pre_quiz_ah',
  'pre_quiz_personal',
  'pre_questionnaire',
  'learning_dashboard',
  'post_quiz_general',
  'post_quiz_ah',
  'post_quiz_personal',
  'post_questionnaire',
  'post_reflection',
  'complete'
]

/**
 * Legacy steps (for backward compat with existing sessions)
 */
export const LEGACY_STEPS = [
  'intro', 'quiz1', 'quiz2', 'self_perception',
  'intervention', 'quiz3', 'quiz4', 'reflection', 'complete'
]

/**
 * Pre-questionnaire: closed Likert questions (awareness + self-perception combined)
 */
export const PRE_QUESTIONNAIRE_QUESTIONS = [
  {
    id: 'pre_q1',
    text_nl: 'Ik weet welke voedselproducten een hoge CO₂-uitstoot hebben.',
    text_en: 'I know which food products have a high CO₂ footprint.',
    type: 'likert'
  },
  {
    id: 'pre_q2',
    text_nl: 'Ik houd rekening met duurzaamheid bij het doen van boodschappen.',
    text_en: 'I consider sustainability when grocery shopping.',
    type: 'likert'
  },
  {
    id: 'pre_q3',
    text_nl: 'Ik weet wat de milieu-impact is van vlees ten opzichte van plantaardige producten.',
    text_en: 'I know the environmental impact of meat compared to plant-based products.',
    type: 'likert'
  },
  {
    id: 'pre_q4',
    text_nl: 'Ik ben bereid mijn eetgewoontes aan te passen voor het milieu.',
    text_en: 'I am willing to change my eating habits for the environment.',
    type: 'likert'
  },
  {
    id: 'pre_q5',
    text_nl: 'Ik vind het belangrijk om te weten hoeveel CO₂ mijn boodschappen veroorzaken.',
    text_en: 'I think it is important to know how much CO₂ my groceries cause.',
    type: 'likert'
  }
]

/**
 * Post-questionnaire: closed Likert questions (post-intervention self-assessment)
 */
export const POST_QUESTIONNAIRE_QUESTIONS = [
  {
    id: 'post_q1',
    text_nl: 'Ik begrijp nu beter welke producten een hoge CO₂-uitstoot hebben.',
    text_en: 'I now better understand which products have a high CO₂ footprint.',
    type: 'likert'
  },
  {
    id: 'post_q2',
    text_nl: 'Ik ben van plan om duurzamere keuzes te maken bij mijn volgende boodschappen.',
    text_en: 'I plan to make more sustainable choices in my next grocery shopping.',
    type: 'likert'
  },
  {
    id: 'post_q3',
    text_nl: 'De informatie die ik heb gezien was nuttig en begrijpelijk.',
    text_en: 'The information I saw was useful and understandable.',
    type: 'likert'
  },
  {
    id: 'post_q4',
    text_nl: 'Ik voel me nu beter in staat om duurzame keuzes te maken in de supermarkt.',
    text_en: 'I now feel better equipped to make sustainable choices in the supermarket.',
    type: 'likert'
  },
  {
    id: 'post_q5',
    text_nl: 'Dit soort informatie zou standaard beschikbaar moeten zijn bij het boodschappen doen.',
    text_en: 'This kind of information should be available by default when grocery shopping.',
    type: 'likert'
  }
]

/**
 * Get step index (0-based)
 */
export function getStepIndex(step) {
  return EXPERIMENT_STEPS.indexOf(step)
}

/**
 * Get next step
 */
export function getNextStep(currentStep) {
  const idx = EXPERIMENT_STEPS.indexOf(currentStep)
  if (idx === -1 || idx >= EXPERIMENT_STEPS.length - 1) return null
  return EXPERIMENT_STEPS[idx + 1]
}
