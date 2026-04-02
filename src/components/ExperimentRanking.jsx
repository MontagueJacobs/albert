import { useState, useEffect } from 'react'
import { Loader2, ArrowUp, ArrowDown, Check, AlertCircle, GripVertical } from 'lucide-react'
import { useI18n } from '../i18n.jsx'

const styles = {
  container: {
    maxWidth: '700px',
    margin: '0 auto'
  },
  header: {
    textAlign: 'center',
    marginBottom: '1.25rem'
  },
  title: {
    fontSize: '1.25rem',
    fontWeight: '700',
    color: 'var(--text, #f3f4f6)',
    marginBottom: '0.5rem'
  },
  subtitle: {
    color: 'var(--text-muted, #9ca3af)',
    fontSize: '0.9rem',
    lineHeight: '1.5'
  },
  instructions: {
    background: 'rgba(59, 130, 246, 0.1)',
    border: '1px solid rgba(59, 130, 246, 0.3)',
    borderRadius: '12px',
    padding: '0.75rem 1rem',
    marginBottom: '1.25rem',
    color: 'var(--text, #f3f4f6)',
    fontSize: '0.85rem',
    lineHeight: '1.5',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem'
  },
  productList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    marginBottom: '1.25rem'
  },
  productCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.75rem',
    background: 'var(--card-bg, #1f2937)',
    borderRadius: '10px',
    border: '1px solid var(--border, #374151)',
    transition: 'all 0.2s ease',
    userSelect: 'none'
  },
  rankNumber: {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    background: 'var(--accent-bg, #374151)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: '600',
    fontSize: '0.85rem',
    color: 'var(--text, #f3f4f6)',
    flexShrink: 0
  },
  productIcon: {
    width: '44px',
    height: '44px',
    borderRadius: '8px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '1.5rem',
    background: 'var(--accent-bg, #374151)',
    flexShrink: 0
  },
  productImage: {
    width: '44px',
    height: '44px',
    borderRadius: '8px',
    objectFit: 'cover',
    background: '#374151',
    flexShrink: 0
  },
  productName: {
    flex: 1,
    fontSize: '0.9rem',
    color: 'var(--text, #f3f4f6)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  moveButtons: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px'
  },
  moveBtn: {
    padding: '4px 8px',
    background: 'var(--accent-bg, #374151)',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    color: 'var(--text-muted, #9ca3af)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.15s ease'
  },
  submitBtn: {
    width: '100%',
    padding: '1rem',
    background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
    border: 'none',
    borderRadius: '12px',
    color: 'white',
    fontWeight: '600',
    fontSize: '1rem',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    transition: 'transform 0.2s ease, box-shadow 0.2s ease'
  },
  // Results styles
  resultCorrect: {
    borderColor: 'rgba(34, 197, 94, 0.5)',
    background: 'rgba(34, 197, 94, 0.1)'
  },
  resultClose: {
    borderColor: 'rgba(234, 179, 8, 0.4)',
    background: 'rgba(234, 179, 8, 0.05)'
  },
  resultWrong: {
    borderColor: 'rgba(239, 68, 68, 0.3)',
    background: 'rgba(239, 68, 68, 0.05)'
  },
  resultInfo: {
    fontSize: '0.7rem',
    color: 'var(--text-muted, #9ca3af)',
    textAlign: 'right',
    minWidth: '70px',
    flexShrink: 0
  },
  scoreCard: {
    background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.15) 0%, rgba(22, 163, 74, 0.15) 100%)',
    border: '1px solid rgba(34, 197, 94, 0.3)',
    borderRadius: '16px',
    padding: '1.5rem',
    textAlign: 'center',
    marginBottom: '1.25rem'
  },
  scoreTitle: {
    fontSize: '1rem',
    color: 'var(--text-muted, #9ca3af)',
    marginBottom: '0.25rem'
  },
  scoreNum: {
    fontSize: '2.5rem',
    fontWeight: '700',
    color: '#22c55e'
  },
  scoreSub: {
    fontSize: '1rem',
    color: 'var(--text-muted, #9ca3af)'
  },
  nextBtn: {
    width: '100%',
    padding: '1rem',
    background: 'var(--primary, #3b82f6)',
    border: 'none',
    borderRadius: '12px',
    color: 'white',
    fontWeight: '600',
    fontSize: '1rem',
    cursor: 'pointer',
    marginTop: '1rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem'
  },
  loading: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '3rem',
    gap: '1rem',
    color: 'var(--text-muted, #9ca3af)'
  },
  error: {
    background: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    borderRadius: '12px',
    padding: '1.5rem',
    textAlign: 'center',
    color: 'var(--text, #f3f4f6)'
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '0.1rem 0.4rem',
    borderRadius: '999px',
    fontSize: '0.65rem',
    fontWeight: '500',
    marginLeft: '0.5rem',
    background: 'rgba(59, 130, 246, 0.2)',
    color: '#60a5fa'
  }
}

export default function ExperimentRanking({ 
  sessionId, 
  quizNumber, 
  title, 
  subtitle, 
  onComplete,
  showResults = false 
}) {
  const { lang } = useI18n()
  const isNl = lang === 'nl'

  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [scoreResult, setScoreResult] = useState(null)

  useEffect(() => {
    fetchItems()
  }, [sessionId, quizNumber])

  const fetchItems = async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(`/api/experiment/${sessionId}/quiz/${quizNumber}/items`)
      const data = await res.json()

      if (!res.ok) {
        if (data.error === 'not_enough_products') {
          setError(isNl 
            ? `Niet genoeg producten beschikbaar voor quiz ${quizNumber}. Importeer eerst meer aankopen.`
            : `Not enough products available for quiz ${quizNumber}. Please import more purchases first.`)
        } else {
          setError(data.error || 'Failed to load items')
        }
        return
      }

      setItems(data.items)
    } catch (e) {
      setError(isNl ? 'Kon producten niet laden' : 'Could not load products')
    } finally {
      setLoading(false)
    }
  }

  const moveItem = (index, direction) => {
    if (submitted) return
    const newIndex = index + direction
    if (newIndex < 0 || newIndex >= items.length) return
    const newItems = [...items]
    const [moved] = newItems.splice(index, 1)
    newItems.splice(newIndex, 0, moved)
    setItems(newItems)
  }

  const handleSubmit = async () => {
    try {
      setSubmitting(true)
      const res = await fetch(`/api/experiment/${sessionId}/quiz/${quizNumber}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_ranking: items })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      setScoreResult({
        score: data.score,
        maxScore: data.maxScore,
        details: data.details,
        correctOrder: data.correctOrder
      })
      setSubmitted(true)

      // Advance immediately without showing results
      // Results are shown later: in the intervention step (quiz 1&2)
      // or in the complete screen (quiz 3&4)
      if (!showResults) {
        onComplete(data.session, data)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleNext = () => {
    // Used when showResults=true and user clicks "Next"
    if (scoreResult && onComplete) {
      // We need the session - the parent will handle it via the callback
      onComplete(null, scoreResult)
    }
  }

  if (loading) {
    return (
      <div style={styles.loading}>
        <Loader2 size={32} className="spin" />
        <span>{isNl ? 'Producten laden...' : 'Loading products...'}</span>
      </div>
    )
  }

  if (error) {
    return (
      <div style={styles.error}>
        <AlertCircle size={32} style={{ color: '#ef4444', marginBottom: '0.5rem' }} />
        <p>{error}</p>
      </div>
    )
  }

  // Build display items — never show result coloring inline (results shown later)
  const displayItems = (submitted && scoreResult && showResults)
    ? items.map((item, idx) => {
        const detail = scoreResult.details?.find(d => d.id === item.id)
        return { ...item, ...detail, userRank: idx + 1 }
      })
    : items

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>{title}</h2>
        <p style={styles.subtitle}>{subtitle}</p>
      </div>

      {!submitted && (
        <div style={styles.instructions}>
          <GripVertical size={18} style={{ flexShrink: 0 }} />
          <span>
            {isNl 
              ? 'Gebruik de pijltjes om producten omhoog of omlaag te verplaatsen. #1 = hoogste CO₂.'
              : 'Use the arrows to move products up or down. #1 = highest CO₂.'}
          </span>
        </div>
      )}

      {/* Score card (only shown if showResults=true, i.e. not during experiment flow) */}
      {submitted && scoreResult && showResults && (
        <div style={styles.scoreCard}>
          <div style={styles.scoreTitle}>
            {isNl ? 'Jouw Score' : 'Your Score'}
          </div>
          <div>
            <span style={styles.scoreNum}>{scoreResult.score}</span>
            <span style={styles.scoreSub}> / {scoreResult.maxScore}</span>
          </div>
        </div>
      )}

      {/* Product list */}
      <div style={styles.productList}>
        {displayItems.map((item, index) => {
          let cardStyle = { ...styles.productCard }
          if (submitted && scoreResult && showResults) {
            if (item.distance === 0) {
              cardStyle = { ...cardStyle, ...styles.resultCorrect }
            } else if (item.distance === 1) {
              cardStyle = { ...cardStyle, ...styles.resultClose }
            } else if (item.distance >= 3) {
              cardStyle = { ...cardStyle, ...styles.resultWrong }
            }
          }

          return (
            <div key={item.id} style={cardStyle}>
              <div style={{
                ...styles.rankNumber,
                background: (submitted && showResults && item.distance === 0) ? '#22c55e' : 'var(--accent-bg, #374151)'
              }}>
                {index + 1}
              </div>

              {item.image_url ? (
                <img 
                  src={item.image_url}
                  alt={item.name}
                  style={styles.productImage}
                  onError={(e) => { e.target.style.display = 'none' }}
                />
              ) : (
                <div style={styles.productIcon}>
                  {item.image_emoji || '🛒'}
                </div>
              )}

              <div style={styles.productName}>
                {item.name}
                {item.source === 'purchased' && (
                  <span style={styles.badge}>
                    {isNl ? 'Jouw aankoop' : 'Your purchase'}
                  </span>
                )}
              </div>

              {!submitted && (
                <div style={styles.moveButtons}>
                  <button 
                    style={styles.moveBtn}
                    onClick={() => moveItem(index, -1)}
                    disabled={index === 0}
                  >
                    <ArrowUp size={16} />
                  </button>
                  <button 
                    style={styles.moveBtn}
                    onClick={() => moveItem(index, 1)}
                    disabled={index === items.length - 1}
                  >
                    <ArrowDown size={16} />
                  </button>
                </div>
              )}

              {submitted && scoreResult && showResults && (
                <div style={styles.resultInfo}>
                  {item.distance === 0 ? (
                    <span style={{ color: '#22c55e' }}>✓ {isNl ? 'Correct' : 'Correct'}</span>
                  ) : (
                    <span>
                      {isNl ? 'Werkelijk' : 'Actual'}: #{item.correctRank}
                    </span>
                  )}
                  <br />
                  <span style={{ fontSize: '0.65rem' }}>
                    {item.co2PerKg != null ? `${item.co2PerKg} kg CO₂/kg` : '?'}
                  </span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {!submitted ? (
        <button 
          style={styles.submitBtn}
          onClick={handleSubmit}
          disabled={submitting}
        >
          {submitting ? (
            <>
              <Loader2 size={20} className="spin" />
              {isNl ? 'Bezig...' : 'Submitting...'}
            </>
          ) : (
            <>
              <Check size={20} />
              {isNl ? 'Controleer mijn ranking' : 'Check my ranking'}
            </>
          )}
        </button>
      ) : showResults ? (
        <button style={styles.nextBtn} onClick={handleNext}>
          {isNl ? 'Volgende' : 'Next'} →
        </button>
      ) : null}
    </div>
  )
}
