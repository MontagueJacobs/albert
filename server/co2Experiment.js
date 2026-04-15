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
  { name: 'Coffee', nameNl: 'Koffie', image: '☕' },
  { name: 'Chicken Breast', nameNl: 'Kipfilet', image: '🍗' },
  { name: 'Milk', nameNl: 'Melk', image: '🥛' },
  { name: 'Rice', nameNl: 'Rijst', image: '🍚' },
  { name: 'Orange', nameNl: 'Sinaasappel', image: '🍊' },
]

const GENERIC_POOL_B = [
  { name: 'Lamb', nameNl: 'Lamsvlees', image: '🍖' },
  { name: 'Soybean Oil', nameNl: 'Sojaolie', image: '🫗' },
  { name: 'Yogurt', nameNl: 'Yoghurt', image: '🥛' },
  { name: 'Eggs', nameNl: 'Eieren', image: '🥚' },
  { name: 'Bread', nameNl: 'Brood', image: '🍞' },
  { name: 'Apple', nameNl: 'Appel', image: '🍎' },
]

// ===========================================================================
// AH-SPECIFIC PRODUCT POOLS (quiz 5 & 6)
// Recognisable Albert Heijn products spanning low → high CO2
// Pool C = quiz 5 (pre-intervention), Pool D = quiz 6 (post-intervention)
// ===========================================================================
const AH_POOL_C = [
  { name: 'Delicata Reep puur 75% cacao', nameNl: 'Delicata Reep puur 75% cacao', image: '🍫', image_url: 'https://static.ah.nl/dam/product/AHI_6930435a3935565a5461654e354e6571484535725277?revLabel=1&rendition=200x200_JPG_Q85&fileType=binary' },
  { name: 'AH Geraspte kaas',          nameNl: 'AH Geraspte kaas',          image: '🧀', image_url: 'https://static.ah.nl/dam/product/AHI_4354523130313838303239?revLabel=1&rendition=200x200_JPG_Q85&fileType=binary' },
  { name: 'AH Zonnebloemolie',         nameNl: 'AH Zonnebloemolie',         image: '🌻', image_url: 'https://static.ah.nl/dam/product/AHI_4354523130323034303136?revLabel=1&rendition=200x200_JPG_Q85&fileType=binary' },
  { name: 'AH Terra Biologische tofu', nameNl: 'AH Terra Biologische tofu', image: '🧈', image_url: 'https://static.ah.nl/dam/product/AHI_75575961636c4571525461785a58486e576970774467?revLabel=1&rendition=200x200_JPG_Q85&fileType=binary' },
  { name: 'AH Kristalsuiker',          nameNl: 'AH Kristalsuiker',          image: '🍬', image_url: 'https://static.ah.nl/dam/product/AHI_43545239383337393137?revLabel=1&rendition=200x200_JPG_Q85&fileType=binary' },
  { name: 'AH Terra Sojadrink ongezoet', nameNl: 'AH Terra Sojadrink ongezoet', image: '🥛', image_url: 'https://static.ah.nl/dam/product/AHI_4354523130313832393437?revLabel=1&rendition=200x200_JPG_Q85&fileType=binary' },
]

const AH_POOL_D = [
  { name: 'AH Garnalen',               nameNl: 'AH Garnalen',               image: '🦐', image_url: 'https://static.ah.nl/dam/product/AHI_637665684378504c516d613644566a636b6554784541?revLabel=1&rendition=200x200_JPG_Q85&fileType=binary' },
  { name: 'AH Roomboter ongezouten',   nameNl: 'AH Roomboter ongezouten',   image: '🧈', image_url: 'https://static.ah.nl/dam/product/AHI_4354523130313032323032?revLabel=1&rendition=200x200_JPG_Q85&fileType=binary' },
  { name: 'AH Smeuïge pindakaas',     nameNl: 'AH Smeuïge pindakaas',     image: '🥜', image_url: 'https://static.ah.nl/dam/product/AHI_47745967326d487a52362d416c34366f6d7367514577?revLabel=1&rendition=200x200_JPG_Q85&fileType=binary' },
  { name: 'AH Margarine',              nameNl: 'AH Margarine',              image: '🧈', image_url: 'https://static.ah.nl/dam/product/AHI_4354523130303734363834?revLabel=1&rendition=200x200_JPG_Q85&fileType=binary' },
  { name: 'AH Rietsuiker',             nameNl: 'AH Rietsuiker',             image: '🍬', image_url: 'https://static.ah.nl/dam/product/AHI_546a4757394b424e52704734627245437059566a6b41?revLabel=1&rendition=200x200_JPG_Q85&fileType=binary' },
  { name: 'AH Haverdrink ongezoet',    nameNl: 'AH Haverdrink ongezoet',    image: '🥛', image_url: 'https://static.ah.nl/dam/product/AHI_43545239393536393239?revLabel=1&rendition=200x200_JPG_Q85&fileType=binary' },
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
 * Demographics questions (asked after consent, before experiment)
 */
export const DEMOGRAPHICS_QUESTIONS = [
  { id: 'demo_age', type: 'number' },
  { id: 'demo_gender', type: 'select', options: ['man', 'woman', 'non_binary', 'prefer_not_to_say'] },
  { id: 'demo_education', type: 'select', options: ['secondary', 'mbo', 'hbo', 'university', 'other'] },
  { id: 'demo_diet', type: 'select', options: ['omnivore', 'flexitarian', 'vegetarian', 'vegan', 'other'] },
  { id: 'demo_shopping_frequency', type: 'select', options: ['daily', '2_3_per_week', 'weekly', 'less_than_weekly'] }
]

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
    id: 'ref_reflection',
    text: 'What did you learn from this study?',
    textNl: 'Wat heeft u geleerd van dit onderzoek?',
    type: 'open'
  },
  {
    id: 'ref_surprise',
    text: 'Did any of the results about your purchases surprise you? If yes, how?',
    textNl: 'Hebben de resultaten over uw aankopen u verrast? Zo ja, hoe?',
    type: 'open'
  },
  {
    id: 'ref_system_feedback',
    text: 'What did you like or dislike about the ranking system?',
    textNl: 'Wat vond u goed of minder goed aan het rangschikkingssysteem?',
    type: 'open'
  },
  {
    id: 'ref_trust_comparison',
    text: 'How does this system compare to eco-labels you have seen before?',
    textNl: 'Hoe verhoudt dit systeem zich tot keurmerken die u eerder heeft gezien?',
    type: 'open'
  },
  {
    id: 'ref_improvement',
    text: 'What would you improve about this tool?',
    textNl: 'Wat zou u verbeteren aan deze tool?',
    type: 'open'
  }
]

/**
 * Steps in the V2 experiment flow (ordered, linear)
 */
export const EXPERIMENT_STEPS = [
  'consent',
  'demographics',
  'scrape',
  'pre_questionnaire',
  'pre_quiz_general',
  'pre_quiz_ah',
  'pre_quiz_personal',
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
 * Pre-questionnaire: closed Likert questions (awareness & self-perception)
 */
export const PRE_QUESTIONNAIRE_QUESTIONS = [
  {
    id: 'pre_q1',
    text_nl: 'Ik beschouw mijn voedselkeuzes als milieuvriendelijk.',
    text_en: 'I consider my food choices to be environmentally sustainable.',
    type: 'likert'
  },
  {
    id: 'pre_q2',
    text_nl: 'Ik heb vertrouwen in mijn kennis over de milieu-impact van voedselproducten.',
    text_en: 'I feel confident in my knowledge of the environmental impact of food products.',
    type: 'likert'
  },
  {
    id: 'pre_q3',
    text_nl: 'Ik vertrouw op keurmerken bij het maken van aankoopbeslissingen voor voedsel.',
    text_en: 'I trust eco-labels when making food purchasing decisions.',
    type: 'likert'
  },
  {
    id: 'pre_q4',
    text_nl: 'Keurmerken zijn gemakkelijk te begrijpen.',
    text_en: 'Eco-labels are easy to understand.',
    type: 'likert'
  },
  {
    id: 'pre_q5',
    text_nl: 'Ik vind het gemakkelijk om producten te vergelijken op basis van hun milieu-impact.',
    text_en: 'I find it easy to compare products based on their environmental impact.',
    type: 'likert'
  },
  {
    id: 'pre_q6',
    text_nl: 'Ik houd actief rekening met de milieu-impact bij het kopen van voedsel.',
    text_en: 'I actively consider environmental impact when buying food.',
    type: 'likert'
  }
]

/**
 * Post-questionnaire: closed Likert questions (post-intervention self-assessment)
 */
export const POST_QUESTIONNAIRE_QUESTIONS = [
  {
    id: 'post_q1',
    text_nl: 'Ik heb een beter begrip van de milieu-impact van voedselproducten na dit onderzoek.',
    text_en: 'I have a better understanding of the environmental impact of food products after this study.',
    type: 'likert'
  },
  {
    id: 'post_q2',
    text_nl: 'Het rangschikkingssysteem in dit onderzoek was duidelijk en gemakkelijk te begrijpen.',
    text_en: 'The ranking system used in this study was clear and easy to understand.',
    type: 'likert'
  },
  {
    id: 'post_q3',
    text_nl: 'Ik vertrouw het CO₂-rangschikkingssysteem dat in dit onderzoek is gepresenteerd.',
    text_en: 'I trust the CO₂ ranking system presented in this study.',
    type: 'likert'
  },
  {
    id: 'post_q4',
    text_nl: 'Ik vind dit rangschikkingssysteem duidelijker dan bestaande keurmerken.',
    text_en: 'I find this ranking system clearer than existing eco-labels.',
    type: 'likert'
  },
  {
    id: 'post_q5',
    text_nl: 'De feedback over mijn persoonlijke aankopen was nuttig.',
    text_en: 'The feedback on my personal purchases was useful.',
    type: 'likert'
  },
  {
    id: 'post_q6',
    text_nl: 'Ik zou dit soort informatie gebruiken bij het maken van toekomstige voedselkeuzes.',
    text_en: 'I would use this type of information when making future food choices.',
    type: 'likert'
  },
  {
    id: 'post_q7',
    text_nl: 'De quizzen hebben me geholpen om te leren over de milieu-impact van voedsel.',
    text_en: 'The quizzes helped me learn about the environmental impact of food.',
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
