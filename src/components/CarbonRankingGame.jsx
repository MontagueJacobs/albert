import { useState, useEffect, useRef, useCallback } from 'react'
import { Loader2, ArrowUp, ArrowDown, Check, AlertCircle, Trophy, Target, GripVertical } from 'lucide-react'
import { useI18n } from '../i18n.jsx'
import { useBonusCard } from '../lib/bonusCardContext.jsx'

// Color for rank position: #1 (highest CO₂) = red → last (lowest CO₂) = green
function getRankColor(position, total) {
  // position is 0-based index, total is number of items
  if (total <= 1) return '#eab308'
  const t = position / (total - 1) // 0 = top (worst) → 1 = bottom (best)
  // Gradient: red → orange → yellow → lime → green
  const stops = [
    { at: 0,    r: 239, g: 68,  b: 68  }, // #ef4444 red
    { at: 0.25, r: 249, g: 115, b: 22  }, // #f97316 orange
    { at: 0.5,  r: 234, g: 179, b: 8   }, // #eab308 yellow
    { at: 0.75, r: 132, g: 204, b: 22  }, // #84cc16 lime
    { at: 1,    r: 34,  g: 197, b: 94  }, // #22c55e green
  ]
  let lo = stops[0], hi = stops[stops.length - 1]
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i].at && t <= stops[i + 1].at) { lo = stops[i]; hi = stops[i + 1]; break }
  }
  const f = lo.at === hi.at ? 0 : (t - lo.at) / (hi.at - lo.at)
  const r = Math.round(lo.r + (hi.r - lo.r) * f)
  const g = Math.round(lo.g + (hi.g - lo.g) * f)
  const b = Math.round(lo.b + (hi.b - lo.b) * f)
  return `rgb(${r},${g},${b})`
}

const styles = {
  container: {
    maxWidth: '700px',
    margin: '0 auto',
    padding: '1rem'
  },
  header: {
    textAlign: 'center',
    marginBottom: '1.5rem'
  },
  title: {
    fontSize: '1.5rem',
    fontWeight: '700',
    color: 'var(--text, #f3f4f6)',
    marginBottom: '0.5rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem'
  },
  subtitle: {
    color: 'var(--text-muted, #9ca3af)',
    fontSize: '0.95rem',
    marginBottom: '1rem'
  },
  instructions: {
    background: 'rgba(59, 130, 246, 0.1)',
    border: '1px solid rgba(59, 130, 246, 0.3)',
    borderRadius: '12px',
    padding: '1rem',
    marginBottom: '1.5rem',
    color: 'var(--text, #f3f4f6)',
    fontSize: '0.9rem',
    lineHeight: '1.5'
  },
  productList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    marginBottom: '1.5rem'
  },
  productCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.75rem',
    background: 'var(--bg-card, #1f2937)',
    borderRadius: '10px',
    border: '1px solid var(--border, #374151)',
    transition: 'all 0.2s ease',
    userSelect: 'none',
    cursor: 'grab'
  },
  productCardDragging: {
    opacity: 0.3,
    border: '1px dashed var(--border, #374151)',
    transform: 'scale(0.97)'
  },
  insertIndicator: {
    height: '3px',
    background: 'linear-gradient(90deg, transparent, #3b82f6, #3b82f6, transparent)',
    borderRadius: '2px',
    margin: '0 0.5rem',
    transition: 'opacity 0.15s ease',
    boxShadow: '0 0 8px rgba(59, 130, 246, 0.4)'
  },
  dragHandle: {
    color: 'var(--text-muted, #6b7280)',
    cursor: 'grab',
    flexShrink: 0,
    touchAction: 'none'
  },
  rankNumber: {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    background: 'var(--bg-secondary, #374151)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: '600',
    fontSize: '0.85rem',
    color: 'var(--text, #f3f4f6)',
    flexShrink: 0
  },
  productImage: {
    width: '64px',
    height: '64px',
    borderRadius: '8px',
    objectFit: 'cover',
    background: 'var(--bg-secondary, #374151)',
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
    background: 'var(--bg-secondary, #374151)',
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
  resultsContainer: {
    marginTop: '1.5rem'
  },
  scoreCard: {
    background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.15) 0%, rgba(22, 163, 74, 0.15) 100%)',
    border: '1px solid rgba(34, 197, 94, 0.3)',
    borderRadius: '16px',
    padding: '1.5rem',
    textAlign: 'center',
    marginBottom: '1.5rem'
  },
  scoreTitle: {
    fontSize: '1.1rem',
    color: 'var(--text-muted, #9ca3af)',
    marginBottom: '0.5rem'
  },
  scoreValue: {
    fontSize: '3rem',
    fontWeight: '700',
    color: '#22c55e'
  },
  scoreMax: {
    fontSize: '1.25rem',
    color: 'var(--text-muted, #9ca3af)'
  },
  resultItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.75rem',
    background: 'var(--bg-card, #1f2937)',
    borderRadius: '10px',
    marginBottom: '0.5rem',
    border: '1px solid var(--border, #374151)'
  },
  resultCorrect: {
    borderColor: 'rgba(34, 197, 94, 0.5)',
    background: 'rgba(34, 197, 94, 0.1)'
  },
  resultWrong: {
    borderColor: 'rgba(239, 68, 68, 0.3)',
    background: 'rgba(239, 68, 68, 0.05)'
  },
  actualRank: {
    fontSize: '0.75rem',
    color: 'var(--text-muted, #9ca3af)',
    marginLeft: 'auto'
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
  errorIcon: {
    color: '#ef4444',
    marginBottom: '0.5rem'
  },
  retryBtn: {
    marginTop: '1rem',
    padding: '0.75rem 1.5rem',
    background: 'var(--bg-secondary, #374151)',
    border: 'none',
    borderRadius: '8px',
    color: 'var(--text, #f3f4f6)',
    cursor: 'pointer'
  },
  doneBtn: {
    width: '100%',
    padding: '1rem',
    background: 'var(--primary, #3b82f6)',
    border: 'none',
    borderRadius: '12px',
    color: 'white',
    fontWeight: '600',
    fontSize: '1rem',
    cursor: 'pointer',
    marginTop: '1rem'
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.25rem',
    padding: '0.15rem 0.5rem',
    borderRadius: '999px',
    fontSize: '0.7rem',
    fontWeight: '500',
    marginLeft: '0.5rem'
  },
  badgePurchased: {
    background: 'rgba(59, 130, 246, 0.2)',
    color: '#60a5fa'
  },
  badgeCatalog: {
    background: 'rgba(168, 85, 247, 0.2)',
    color: '#c084fc'
  }
}

export default function CarbonRankingGame({ onComplete, onBack }) {
  const { lang } = useI18n()
  const { bonusCardNumber } = useBonusCard()
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [submitted, setSubmitted] = useState(false)
  const [results, setResults] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const isNl = lang === 'nl'

  // Drag-and-drop state
  const dragItem = useRef(null)
  const dragOverItem = useRef(null)
  const [dragIndex, setDragIndex] = useState(null)
  const [insertBeforeIndex, setInsertBeforeIndex] = useState(null)

  const handleDragStart = useCallback((e, index) => {
    dragItem.current = index
    setDragIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    if (e.target) {
      e.dataTransfer.setDragImage(e.target, e.target.offsetWidth / 2, e.target.offsetHeight / 2)
    }
  }, [])

  const handleDragOver = useCallback((e, index) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragItem.current === null) return
    const rect = e.currentTarget.getBoundingClientRect()
    const midY = rect.top + rect.height / 2
    const insertAt = e.clientY < midY ? index : index + 1
    dragOverItem.current = insertAt
    setInsertBeforeIndex(insertAt)
  }, [])

  const handleDragEnd = useCallback(() => {
    if (dragItem.current !== null && dragOverItem.current !== null) {
      const from = dragItem.current
      let to = dragOverItem.current
      if (from !== to && from !== to - 1) {
        setProducts(prev => {
          const newProducts = [...prev]
          const [moved] = newProducts.splice(from, 1)
          const adjustedTo = to > from ? to - 1 : to
          newProducts.splice(adjustedTo, 0, moved)
          return newProducts
        })
      }
    }
    dragItem.current = null
    dragOverItem.current = null
    setDragIndex(null)
    setInsertBeforeIndex(null)
  }, [])

  const handleDragLeave = useCallback((e) => {
    // Only clear if leaving the list entirely
    const related = e.relatedTarget
    if (related && e.currentTarget.contains(related)) return
  }, [])

  // Touch drag-and-drop support
  const touchStartY = useRef(null)
  const touchItemIndex = useRef(null)
  const listRef = useRef(null)

  const handleTouchStart = useCallback((e, index) => {
    touchStartY.current = e.touches[0].clientY
    touchItemIndex.current = index
    dragItem.current = index
    setDragIndex(index)
  }, [])

  const handleTouchMove = useCallback((e, index) => {
    if (touchItemIndex.current === null || !listRef.current) return
    e.preventDefault()
    const touch = e.touches[0]
    const cards = listRef.current.querySelectorAll('[data-drag-card]')
    for (let i = 0; i < cards.length; i++) {
      const rect = cards[i].getBoundingClientRect()
      if (touch.clientY >= rect.top && touch.clientY <= rect.bottom) {
        const midY = rect.top + rect.height / 2
        const insertAt = touch.clientY < midY ? i : i + 1
        dragOverItem.current = insertAt
        setInsertBeforeIndex(insertAt)
        break
      }
    }
  }, [])

  const handleTouchEnd = useCallback(() => {
    if (dragItem.current !== null && dragOverItem.current !== null) {
      const from = dragItem.current
      let to = dragOverItem.current
      if (from !== to && from !== to - 1) {
        setProducts(prev => {
          const newProducts = [...prev]
          const [moved] = newProducts.splice(from, 1)
          const adjustedTo = to > from ? to - 1 : to
          newProducts.splice(adjustedTo, 0, moved)
          return newProducts
        })
      }
    }
    touchStartY.current = null
    touchItemIndex.current = null
    dragItem.current = null
    dragOverItem.current = null
    setDragIndex(null)
    setInsertBeforeIndex(null)
  }, [])

  useEffect(() => {
    fetchProducts()
  }, [bonusCardNumber])

  const fetchProducts = async () => {
    if (!bonusCardNumber) {
      setError(isNl ? 'Geen bonuskaart gevonden' : 'No bonus card found')
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      setError(null)
      const response = await fetch(`/api/questionnaire/${bonusCardNumber}/ranking-products`)
      const data = await response.json()
      
      if (!response.ok) {
        if (data.error === 'not_enough_products') {
          setError(isNl 
            ? 'Niet genoeg producten beschikbaar. Importeer eerst meer aankopen.' 
            : 'Not enough products available. Please import more purchases first.')
        } else {
          setError(data.error || 'Failed to load products')
        }
        return
      }
      
      // Products come shuffled from API, just set them
      setProducts(data.products)
    } catch (e) {
      console.error('Error fetching products:', e)
      setError(isNl ? 'Kon producten niet laden' : 'Could not load products')
    } finally {
      setLoading(false)
    }
  }

  const moveProduct = (index, direction) => {
    if (submitted) return
    
    const newIndex = index + direction
    if (newIndex < 0 || newIndex >= products.length) return
    
    const newProducts = [...products]
    const [moved] = newProducts.splice(index, 1)
    newProducts.splice(newIndex, 0, moved)
    setProducts(newProducts)
  }

  const calculateScore = () => {
    // Sort products by CO2/kg (highest CO2 = worst for environment)
    // Products with null CO2 go to the end (least certain)
    const correctOrder = [...products].sort((a, b) => {
      const aCO2 = a.co2PerKg ?? -1
      const bCO2 = b.co2PerKg ?? -1
      return bCO2 - aCO2  // Descending: highest CO2 first
    })
    
    let score = 0
    const maxScore = products.length
    
    const resultItems = products.map((product, userRank) => {
      const actualRank = correctOrder.findIndex(p => p.id === product.id)
      const isCorrect = userRank === actualRank
      const difference = Math.abs(userRank - actualRank)
      
      // Award points only for exact position matches
      if (isCorrect) {
        score += 1
      }
      
      return {
        ...product,
        userRank: userRank + 1,
        actualRank: actualRank + 1,
        isCorrect,
        difference
      }
    })
    
    return {
      score: Math.round(score * 10) / 10,
      maxScore,
      percentage: Math.round((score / maxScore) * 100),
      results: resultItems
    }
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    
    const calculatedResults = calculateScore()
    setResults(calculatedResults)
    
    // Save results to backend
    try {
      const response = await fetch('/api/questionnaire/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bonus_card: bonusCardNumber,
          questionnaire_type: 'carbon_ranking',
          responses: {
            user_ranking: products.map((p, i) => ({ rank: i + 1, product_id: p.id, product_name: p.name })),
            score: calculatedResults.score,
            max_score: calculatedResults.maxScore,
            percentage: calculatedResults.percentage,
            detailed_results: calculatedResults.results.map(r => ({
              product_id: r.id,
              product_name: r.name,
              user_rank: r.userRank,
              actual_rank: r.actualRank,
              actual_score: r.actual_score,
              co2PerKg: r.co2PerKg,
              is_correct: r.isCorrect
            }))
          }
        })
      })
      
      if (!response.ok) {
        console.error('Failed to save ranking results')
      }
    } catch (e) {
      console.error('Error saving results:', e)
    }
    
    setSubmitted(true)
    setSubmitting(false)
  }

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>
          <Loader2 size={32} className="spin" />
          <span>{isNl ? 'Producten laden...' : 'Loading products...'}</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={styles.container}>
        <div style={styles.error}>
          <AlertCircle size={32} style={styles.errorIcon} />
          <p>{error}</p>
          <button style={styles.retryBtn} onClick={fetchProducts}>
            {isNl ? 'Opnieuw proberen' : 'Try again'}
          </button>
          {onBack && (
            <button style={{...styles.retryBtn, marginLeft: '0.5rem'}} onClick={onBack}>
              {isNl ? 'Terug' : 'Back'}
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>
          <Target size={28} />
          {isNl ? 'CO₂ Ranking Spel' : 'CO₂ Ranking Game'}
        </h2>
        <p style={styles.subtitle}>
          {isNl 
            ? 'Hoe goed ken je de milieu-impact van producten?' 
            : 'How well do you know the environmental impact of products?'}
        </p>
      </div>

      {!submitted && (
        <div style={styles.instructions}>
          <strong>{isNl ? '🎯 Opdracht:' : '🎯 Task:'}</strong><br />
          {isNl 
            ? 'Sorteer deze producten van HOOGSTE naar LAAGSTE CO₂-uitstoot (kg CO₂ per kg product). Sleep producten of gebruik de pijltjes om ze te verplaatsen. Het product bovenaan heeft volgens jou de meeste CO₂-uitstoot.'
            : 'Sort these products from HIGHEST to LOWEST CO₂ emissions (kg CO₂ per kg of product). Drag products or use the arrows to reorder them. The product at the top should have the highest CO₂ footprint.'}
        </div>
      )}

      {submitted && results && (
        <div style={styles.resultsContainer}>
          <div style={styles.scoreCard}>
            <Trophy size={40} style={{ color: '#22c55e', marginBottom: '0.5rem' }} />
            <div style={styles.scoreTitle}>
              {isNl ? 'Jouw Score' : 'Your Score'}
            </div>
            <div>
              <span style={styles.scoreValue}>{results.score}</span>
              <span style={styles.scoreMax}> / {results.maxScore}</span>
            </div>
            <div style={{ marginTop: '0.5rem', color: 'var(--text-muted)' }}>
              {results.percentage}% {isNl ? 'correct' : 'correct'}
            </div>
          </div>
          
          <h3 style={{ color: 'var(--text)', marginBottom: '1rem', fontSize: '1rem' }}>
            {isNl ? 'Vergelijking met werkelijke CO₂-uitstoot:' : 'Comparison with actual CO₂ emissions:'}
          </h3>
        </div>
      )}

      <div style={styles.productList} ref={listRef}>
        {(submitted ? results?.results : products).map((product, index) => (
          <div key={product.id}>
            {/* Insertion indicator before this item */}
            {!submitted && insertBeforeIndex === index && dragIndex !== null && dragIndex !== index && dragIndex !== index - 1 && (
              <div style={styles.insertIndicator} />
            )}
            <div 
              data-drag-card
              draggable={!submitted}
              onDragStart={!submitted ? (e) => handleDragStart(e, index) : undefined}
              onDragOver={!submitted ? (e) => handleDragOver(e, index) : undefined}
              onDragEnd={!submitted ? handleDragEnd : undefined}
              onTouchStart={!submitted ? (e) => handleTouchStart(e, index) : undefined}
              onTouchMove={!submitted ? (e) => handleTouchMove(e, index) : undefined}
              onTouchEnd={!submitted ? handleTouchEnd : undefined}
              style={{
                ...styles.productCard,
                ...(submitted && product.isCorrect ? styles.resultCorrect : {}),
                ...(submitted && !product.isCorrect ? styles.resultWrong : {}),
                ...(!submitted && dragIndex === index ? styles.productCardDragging : {})
              }}
            >
            {!submitted && (
              <div style={styles.dragHandle}>
                <GripVertical size={18} />
              </div>
            )}

            <div style={{
              ...styles.rankNumber,
              background: submitted 
                ? (product.isCorrect ? '#22c55e' : 'var(--bg-secondary, #374151)')
                : getRankColor(index, (submitted ? results?.results : products).length),
              color: '#fff'
            }}>
              {index + 1}
            </div>
            
            {product.image_url ? (
              <img 
                src={product.image_url} 
                alt={product.name}
                style={styles.productImage}
                onError={(e) => { e.target.style.display = 'none' }}
              />
            ) : (
              <div style={{...styles.productImage, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.75rem'}}>
                🛒
              </div>
            )}
            
            <div style={styles.productName}>
              {product.name}
              <span style={{
                ...styles.badge,
                ...(product.source === 'purchased' ? styles.badgePurchased : styles.badgeCatalog)
              }}>
                {product.source === 'purchased' 
                  ? (isNl ? 'Jouw aankoop' : 'Your purchase') 
                  : (isNl ? 'Catalogus' : 'Catalog')}
              </span>
            </div>

            {!submitted && (
              <div style={styles.moveButtons}>
                <button 
                  style={styles.moveBtn}
                  onClick={() => moveProduct(index, -1)}
                  disabled={index === 0}
                  title={isNl ? 'Omhoog' : 'Move up'}
                >
                  <ArrowUp size={16} />
                </button>
                <button 
                  style={styles.moveBtn}
                  onClick={() => moveProduct(index, 1)}
                  disabled={index === products.length - 1}
                  title={isNl ? 'Omlaag' : 'Move down'}
                >
                  <ArrowDown size={16} />
                </button>
              </div>
            )}

            {submitted && (
              <div style={styles.actualRank}>
                {product.isCorrect ? (
                  <span style={{ color: '#22c55e' }}>✓</span>
                ) : (
                  <span>
                    {isNl ? 'Werkelijk: #' : 'Actual: #'}{product.actualRank}
                  </span>
                )}
                <br />
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  {product.co2PerKg != null 
                    ? `${product.co2PerKg} kg CO₂/kg`
                    : (isNl ? 'Onbekend' : 'Unknown')}
                </span>
              </div>
            )}
            </div>
            {/* Insertion indicator after last item */}
            {!submitted && insertBeforeIndex === index + 1 && index === (submitted ? results?.results : products).length - 1 && dragIndex !== null && dragIndex !== index && dragIndex !== index + 1 && (
              <div style={styles.insertIndicator} />
            )}
          </div>
        ))}
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
      ) : (
        <button 
          style={styles.doneBtn}
          onClick={onComplete}
        >
          {isNl ? 'Naar Dashboard' : 'Go to Dashboard'}
        </button>
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .spin {
          animation: spin 1s linear infinite;
        }
        button:hover:not(:disabled) {
          transform: translateY(-1px);
        }
        button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  )
}
