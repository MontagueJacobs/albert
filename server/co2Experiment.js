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
  { name: 'Rundergehakt', nameNl: 'Rundergehakt', image: '🥩' },
  { name: 'Kipfilet', nameNl: 'Kipfilet', image: '🍗' },
  { name: 'Zalm', nameNl: 'Zalm', image: '🐟' },
  { name: 'Kaas', nameNl: 'Kaas', image: '🧀' },
  { name: 'Melk', nameNl: 'Melk', image: '🥛' },
  { name: 'Rijst', nameNl: 'Rijst', image: '🍚' },
  { name: 'Tomaat', nameNl: 'Tomaat', image: '🍅' },
  { name: 'Brood', nameNl: 'Brood', image: '🍞' },
  { name: 'Appel', nameNl: 'Appel', image: '🍎' },
  { name: 'Aardappel', nameNl: 'Aardappel', image: '🥔' },
]

const GENERIC_POOL_B = [
  { name: 'Lamsvlees', nameNl: 'Lamsvlees', image: '🍖' },
  { name: 'Varkensvlees', nameNl: 'Varkensvlees', image: '🥓' },
  { name: 'Garnalen', nameNl: 'Garnalen', image: '🦐' },
  { name: 'Boter', nameNl: 'Boter', image: '🧈' },
  { name: 'Eieren', nameNl: 'Eieren', image: '🥚' },
  { name: 'Pasta', nameNl: 'Pasta', image: '🍝' },
  { name: 'Banaan', nameNl: 'Banaan', image: '🍌' },
  { name: 'Wortel', nameNl: 'Wortel', image: '🥕' },
  { name: 'Linzen', nameNl: 'Linzen', image: '🫘' },
  { name: 'Chocolade', nameNl: 'Chocolade', image: '🍫' },
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
  const co2 = getProductCO2(item.name)
  return {
    id: `generic_${item.name.toLowerCase().replace(/\s+/g, '_')}`,
    name: item.name,
    nameNl: item.nameNl,
    image_emoji: item.image,
    image_url: null,
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
    return bCO2 - aCO2
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
 * Steps in the experiment flow (ordered)
 */
export const EXPERIMENT_STEPS = [
  'intro',
  'quiz1',
  'quiz2',
  'self_perception',
  'intervention',
  'quiz3',
  'quiz4',
  'reflection',
  'complete'
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
