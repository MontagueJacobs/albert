import { useState, useEffect } from 'react'
import { Loader2, ArrowUp, ArrowDown, Check, AlertCircle, Trophy, Target } from 'lucide-react'
import { useI18n } from '../i18n.jsx'
import { useBonusCard } from '../lib/bonusCardContext.jsx'

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
    background: 'var(--card-bg, #1f2937)',
    borderRadius: '10px',
    border: '1px solid var(--border, #374151)',
    transition: 'all 0.2s ease'
  },
  productCardHighlight: {
    borderColor: '#3b82f6',
    boxShadow: '0 0 0 2px rgba(59, 130, 246, 0.3)'
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
  productImage: {
    width: '48px',
    height: '48px',
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
    background: 'var(--card-bg, #1f2937)',
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
    background: 'var(--accent-bg, #374151)',
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
    // Sort products by actual score (highest = worst for environment) 
    // Note: In our system, LOWER scores = WORSE for environment
    // So we sort ascending (lowest first = worst carbon footprint)
    const correctOrder = [...products].sort((a, b) => a.actual_score - b.actual_score)
    
    let score = 0
    const maxScore = products.length
    
    const resultItems = products.map((product, userRank) => {
      const actualRank = correctOrder.findIndex(p => p.id === product.id)
      const isCorrect = userRank === actualRank
      const difference = Math.abs(userRank - actualRank)
      
      // Award points based on how close the guess is
      // Perfect match = 1 point, 1 off = 0.5 points, 2+ off = 0 points
      if (isCorrect) {
        score += 1
      } else if (difference === 1) {
        score += 0.5
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
            ? 'Sorteer deze producten van HOOGSTE naar LAAGSTE CO₂-uitstoot. Sleep producten omhoog of omlaag met de pijltjes. Het product bovenaan heeft volgens jou de hoogste milieu-impact.'
            : 'Sort these products from HIGHEST to LOWEST carbon footprint. Move products up or down using the arrows. The product at the top should have the highest environmental impact according to you.'}
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
            {isNl ? 'Vergelijking met werkelijke scores:' : 'Comparison with actual scores:'}
          </h3>
        </div>
      )}

      <div style={styles.productList}>
        {(submitted ? results?.results : products).map((product, index) => (
          <div 
            key={product.id} 
            style={{
              ...styles.productCard,
              ...(submitted && product.isCorrect ? styles.resultCorrect : {}),
              ...(submitted && !product.isCorrect ? styles.resultWrong : {})
            }}
          >
            <div style={{
              ...styles.rankNumber,
              background: submitted 
                ? (product.isCorrect ? '#22c55e' : '#374151')
                : 'var(--accent-bg, #374151)'
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
              <div style={{...styles.productImage, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.5rem'}}>
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
                <span style={{ fontSize: '0.7rem' }}>
                  Score: {product.actual_score}
                </span>
              </div>
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
