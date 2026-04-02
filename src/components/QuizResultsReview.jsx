import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useI18n } from '../i18n.jsx'

/**
 * Displays the detailed results of a completed quiz ranking.
 * Shows score, colored cards (correct/close/wrong), correct positions, and CO2 values.
 * Used in the intervention step (quiz 1 & 2 results) and the complete screen (quiz 3 & 4 results).
 */

const styles = {
  wrapper: {
    marginBottom: '1.5rem'
  },
  toggle: {
    width: '100%',
    padding: '0.9rem 1rem',
    background: 'var(--bg-card, #1e293b)',
    border: '1px solid var(--border, #334155)',
    borderRadius: '12px',
    color: 'var(--text, #f3f4f6)',
    fontSize: '0.95rem',
    fontWeight: '600',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.5rem',
    transition: 'border-color 0.2s'
  },
  toggleLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem'
  },
  scorePill: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '0.2rem 0.6rem',
    borderRadius: '999px',
    fontSize: '0.8rem',
    fontWeight: '700',
    background: 'rgba(34, 197, 94, 0.15)',
    color: '#22c55e'
  },
  body: {
    marginTop: '0.75rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.4rem'
  },
  card: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.6rem 0.75rem',
    borderRadius: '10px',
    border: '1px solid var(--border, #374151)',
    background: 'var(--card-bg, #1f2937)',
    fontSize: '0.85rem'
  },
  cardCorrect: {
    borderColor: 'rgba(34, 197, 94, 0.5)',
    background: 'rgba(34, 197, 94, 0.1)'
  },
  cardClose: {
    borderColor: 'rgba(234, 179, 8, 0.4)',
    background: 'rgba(234, 179, 8, 0.05)'
  },
  cardWrong: {
    borderColor: 'rgba(239, 68, 68, 0.3)',
    background: 'rgba(239, 68, 68, 0.05)'
  },
  rank: {
    width: '26px',
    height: '26px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: '600',
    fontSize: '0.8rem',
    color: 'var(--text, #f3f4f6)',
    flexShrink: 0
  },
  icon: {
    width: '36px',
    height: '36px',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '1.2rem',
    background: 'var(--accent-bg, #374151)',
    flexShrink: 0
  },
  image: {
    width: '36px',
    height: '36px',
    borderRadius: '6px',
    objectFit: 'cover',
    background: '#374151',
    flexShrink: 0
  },
  name: {
    flex: 1,
    color: 'var(--text, #f3f4f6)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  info: {
    fontSize: '0.7rem',
    color: 'var(--text-muted, #9ca3af)',
    textAlign: 'right',
    minWidth: '70px',
    flexShrink: 0
  },
  correctLabel: {
    marginTop: '0.75rem',
    fontSize: '0.8rem',
    color: 'var(--text-muted, #9ca3af)',
    fontWeight: '500'
  }
}

export default function QuizResultsReview({ quizData, quizLabel, defaultOpen = false }) {
  const { lang } = useI18n()
  const isNl = lang === 'nl'
  const [open, setOpen] = useState(defaultOpen)

  if (!quizData || quizData.score == null) return null

  const { score, maxScore = 100, details = [], correctOrder = [], user_ranking = [] } = quizData
  // items from the quiz data for images/emojis
  const itemsMap = new Map()
  if (quizData.items) {
    quizData.items.forEach(item => itemsMap.set(item.id, item))
  }

  // Build display from details (user's ordering with distance info)
  // details has: id, name, userRank, correctRank, distance, co2PerKg, isExact
  const displayItems = details.length > 0
    ? [...details].sort((a, b) => a.userRank - b.userRank)
    : []

  return (
    <div style={styles.wrapper}>
      <button 
        style={{
          ...styles.toggle,
          borderColor: open ? 'rgba(59, 130, 246, 0.4)' : undefined
        }}
        onClick={() => setOpen(!open)}
      >
        <div style={styles.toggleLeft}>
          <span>{quizLabel}</span>
          <span style={styles.scorePill}>{score}/{maxScore}</span>
        </div>
        {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>

      {open && displayItems.length > 0 && (
        <div style={styles.body}>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #9ca3af)', marginBottom: '0.25rem' }}>
            {isNl ? 'Jouw rangschikking (met correctie):' : 'Your ranking (with corrections):'}
          </div>

          {displayItems.map((item, idx) => {
            const orig = itemsMap.get(item.id)
            let cardStyle = { ...styles.card }
            if (item.distance === 0) {
              cardStyle = { ...cardStyle, ...styles.cardCorrect }
            } else if (item.distance === 1) {
              cardStyle = { ...cardStyle, ...styles.cardClose }
            } else if (item.distance >= 3) {
              cardStyle = { ...cardStyle, ...styles.cardWrong }
            }

            return (
              <div key={item.id} style={cardStyle}>
                <div style={{
                  ...styles.rank,
                  background: item.distance === 0 ? '#22c55e' : 'var(--accent-bg, #374151)'
                }}>
                  {item.userRank}
                </div>

                {orig?.image_url ? (
                  <img src={orig.image_url} alt={item.name} style={styles.image} onError={e => { e.target.style.display = 'none' }} />
                ) : (
                  <div style={styles.icon}>
                    {orig?.image_emoji || '🛒'}
                  </div>
                )}

                <div style={styles.name}>
                  {item.name}
                </div>

                <div style={styles.info}>
                  {item.distance === 0 ? (
                    <span style={{ color: '#22c55e' }}>✓ {isNl ? 'Correct' : 'Correct'}</span>
                  ) : (
                    <span>
                      {isNl ? 'Werkelijk' : 'Actual'}: #{item.correctRank}
                    </span>
                  )}
                  <br />
                  <span style={{ fontSize: '0.6rem' }}>
                    {item.co2PerKg != null ? `${item.co2PerKg} kg CO₂/kg` : ''}
                  </span>
                </div>
              </div>
            )
          })}

          {/* Show the correct order below */}
          {correctOrder.length > 0 && (
            <>
              <div style={styles.correctLabel}>
                {isNl ? '✅ Juiste volgorde (hoogste → laagste CO₂):' : '✅ Correct order (highest → lowest CO₂):'}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text, #d1d5db)', lineHeight: '1.6' }}>
                {correctOrder.map((item, idx) => (
                  <span key={item.id}>
                    {idx + 1}. {item.name} <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>({item.co2PerKg} kg)</span>
                    {idx < correctOrder.length - 1 && <span style={{ margin: '0 0.25rem' }}>·</span>}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
