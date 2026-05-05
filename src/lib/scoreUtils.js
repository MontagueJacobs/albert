/**
 * Shared score display helpers.
 * 
 * Variant A (treatment): colored CO₂ scores with a distinct hue for each score
 * Variant B (control):   neutral gray CO₂ scores (same numbers, no color coding)
 */

// ─── Variant A: colored ───────────────────────────────────────

const SCORE_STYLES = {
  10: { color: '#059669', bg: 'rgba(5, 150, 105, 0.20)', subtleBg: 'rgba(5, 150, 105, 0.14)' },
  9: { color: '#16a34a', bg: 'rgba(22, 163, 74, 0.20)', subtleBg: 'rgba(22, 163, 74, 0.14)' },
  8: { color: '#65a30d', bg: 'rgba(101, 163, 13, 0.20)', subtleBg: 'rgba(101, 163, 13, 0.14)' },
  7: { color: '#84cc16', bg: 'rgba(132, 204, 22, 0.18)', subtleBg: 'rgba(132, 204, 22, 0.12)' },
  6: { color: '#ca8a04', bg: 'rgba(202, 138, 4, 0.20)', subtleBg: 'rgba(202, 138, 4, 0.14)' },
  5: { color: '#eab308', bg: 'rgba(234, 179, 8, 0.20)', subtleBg: 'rgba(234, 179, 8, 0.14)' },
  4: { color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.20)', subtleBg: 'rgba(245, 158, 11, 0.14)' },
  3: { color: '#f97316', bg: 'rgba(249, 115, 22, 0.20)', subtleBg: 'rgba(249, 115, 22, 0.14)' },
  2: { color: '#ef4444', bg: 'rgba(239, 68, 68, 0.20)', subtleBg: 'rgba(239, 68, 68, 0.14)' },
  1: { color: '#b91c1c', bg: 'rgba(185, 28, 28, 0.20)', subtleBg: 'rgba(185, 28, 28, 0.14)' }
}

function getScoreStyle(score) {
  if (score == null) return null
  const numeric = Number(score)
  if (!Number.isFinite(numeric)) return null
  const normalized = Math.min(10, Math.max(1, Math.round(numeric)))
  return SCORE_STYLES[normalized]
}

export function getScoreColor(score) {
  return getScoreStyle(score)?.color || '#6b7280'
}

export function getScoreBg(score) {
  return getScoreStyle(score)?.bg || 'rgba(107, 114, 128, 0.1)'
}

export function getScoreBgSubtle(score) {
  return getScoreStyle(score)?.subtleBg || 'rgba(107, 114, 128, 0.1)'
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
  if (score >= 7) return 'score-high'
  if (score >= 4) return 'score-medium'
  return 'score-low'
}

// ─── Confidence helpers ───────────────────────────────────────

export function getConfidenceColor(confidence) {
  if (confidence == null) return '#6b7280'
  if (confidence >= 70) return '#22c55e'
  if (confidence >= 55) return '#eab308'
  return '#ef4444'
}

export function getConfidenceBg(confidence) {
  if (confidence == null) return 'rgba(107, 114, 128, 0.1)'
  if (confidence >= 70) return 'rgba(34, 197, 94, 0.12)'
  if (confidence >= 55) return 'rgba(234, 179, 8, 0.12)'
  return 'rgba(239, 68, 68, 0.12)'
}
