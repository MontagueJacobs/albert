/**
 * Shared score display helpers.
 * 
 * Variant A (treatment): colored CO₂ scores (green / yellow / red)
 * Variant B (control):   neutral gray CO₂ scores (same numbers, no color coding)
 */

// ─── Variant A: colored ───────────────────────────────────────

export function getScoreColor(score) {
  if (score == null) return '#6b7280'
  if (score >= 7) return '#22c55e'
  if (score >= 5) return '#eab308'
  return '#ef4444'
}

export function getScoreBg(score) {
  if (score == null) return 'rgba(107, 114, 128, 0.1)'
  if (score >= 7) return 'rgba(34, 197, 94, 0.2)'
  if (score >= 5) return 'rgba(234, 179, 8, 0.2)'
  return 'rgba(239, 68, 68, 0.2)'
}

export function getScoreBgSubtle(score) {
  if (score == null) return 'rgba(107, 114, 128, 0.1)'
  if (score >= 7) return 'rgba(34, 197, 94, 0.15)'
  if (score >= 5) return 'rgba(234, 179, 8, 0.15)'
  return 'rgba(239, 68, 68, 0.15)'
}

export function getScoreLabel(score) {
  if (score == null) return 'N/A'
  if (score >= 9) return 'Very Low CO₂'
  if (score >= 7) return 'Low CO₂'
  if (score >= 5) return 'Moderate CO₂'
  if (score >= 3) return 'High CO₂'
  return 'Very High CO₂'
}

// ─── Variant B: neutral ───────────────────────────────────────

const NEUTRAL_COLOR = '#6b7280'
const NEUTRAL_BG = 'rgba(107, 114, 128, 0.12)'

export function getNeutralScoreColor(_score) {
  return NEUTRAL_COLOR
}

export function getNeutralScoreBg(_score) {
  return NEUTRAL_BG
}

export function getNeutralScoreLabel(score) {
  if (score == null) return 'N/A'
  return 'CO₂ Score'
}

// ─── Variant-aware wrappers ───────────────────────────────────

export function variantScoreColor(variant, score) {
  return variant === 'B' ? getNeutralScoreColor(score) : getScoreColor(score)
}

export function variantScoreBg(variant, score) {
  return variant === 'B' ? getNeutralScoreBg(score) : getScoreBg(score)
}

export function variantScoreBgSubtle(variant, score) {
  return variant === 'B' ? getNeutralScoreBg(score) : getScoreBgSubtle(score)
}

export function variantScoreLabel(variant, score) {
  return variant === 'B' ? getNeutralScoreLabel(score) : getScoreLabel(score)
}

// PurchaseList uses CSS classes — return neutral class for variant B
export function variantScoreClass(variant, score) {
  if (variant === 'B') return 'score-neutral'
  if (score == null) return 'score-na'
  if (score <= 2) return 'score-high'
  if (score <= 4) return 'score-medium'
  return 'score-low'
}
