import { useState, useEffect } from 'react'
import { X, Leaf, Apple, MapPin, ArrowRight, ExternalLink, Loader2, TrendingUp, TrendingDown, Minus, ShoppingCart } from 'lucide-react'
import { useI18n } from '../i18n.jsx'
import { useAuthenticatedFetch } from '../lib/authContext'

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: 'rgba(0, 0, 0, 0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '1rem'
  },
  modal: {
    background: 'var(--bg-card, #1e293b)',
    borderRadius: '16px',
    maxWidth: '600px',
    width: '100%',
    maxHeight: '90vh',
    overflow: 'auto',
    position: 'relative',
    animation: 'slideUp 0.2s ease-out'
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '1rem',
    padding: '1.5rem',
    borderBottom: '1px solid var(--border, #334155)'
  },
  closeButton: {
    position: 'absolute',
    top: '1rem',
    right: '1rem',
    background: 'var(--bg-hover, #334155)',
    border: 'none',
    borderRadius: '50%',
    width: '36px',
    height: '36px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    color: 'var(--text-muted)',
    transition: 'all 0.2s'
  },
  productImage: {
    width: '100px',
    height: '100px',
    borderRadius: '12px',
    objectFit: 'cover',
    background: 'var(--bg-hover, #334155)'
  },
  productInfo: {
    flex: 1
  },
  productName: {
    fontSize: '1.25rem',
    fontWeight: '600',
    color: 'var(--text, #f3f4f6)',
    marginBottom: '0.5rem'
  },
  section: {
    padding: '1.5rem',
    borderBottom: '1px solid var(--border, #334155)'
  },
  sectionTitle: {
    fontSize: '0.9rem',
    fontWeight: '600',
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: '1rem'
  },
  scoreBreakdown: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '0.75rem'
  },
  scoreItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0.75rem',
    background: 'var(--bg-hover, #334155)',
    borderRadius: '8px'
  },
  scoreLabel: {
    fontSize: '0.85rem',
    color: 'var(--text-muted)'
  },
  scoreValue: {
    fontWeight: '600',
    fontSize: '0.9rem'
  },
  mainScore: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'column',
    padding: '1.5rem',
    borderRadius: '12px',
    marginBottom: '1rem'
  },
  alternativeCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.75rem',
    background: 'var(--bg-hover, #334155)',
    borderRadius: '10px',
    marginBottom: '0.5rem',
    textDecoration: 'none',
    color: 'var(--text)',
    transition: 'transform 0.2s, box-shadow 0.2s',
    cursor: 'pointer'
  },
  altImage: {
    width: '48px',
    height: '48px',
    borderRadius: '8px',
    objectFit: 'cover',
    background: 'var(--bg, #0f172a)'
  },
  altInfo: {
    flex: 1
  },
  altName: {
    fontSize: '0.9rem',
    fontWeight: '500',
    color: 'var(--text)'
  },
  altPrice: {
    fontSize: '0.8rem',
    color: 'var(--text-muted)'
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.25rem',
    padding: '0.25rem 0.5rem',
    borderRadius: '6px',
    fontSize: '0.75rem',
    fontWeight: '500'
  },
  improvement: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.75rem',
    background: 'rgba(34, 197, 94, 0.1)',
    borderRadius: '8px',
    color: '#22c55e',
    fontSize: '0.9rem',
    marginBottom: '0.5rem'
  },
  loading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '3rem'
  }
}

function ProductDetailModal({ purchase, onClose }) {
  const { t } = useI18n()
  const authFetch = useAuthenticatedFetch()
  const [details, setDetails] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const getScoreColor = (score) => {
    if (score >= 7) return '#22c55e'
    if (score >= 5) return '#eab308'
    return '#ef4444'
  }

  const getScoreBg = (score) => {
    if (score >= 7) return 'rgba(34, 197, 94, 0.15)'
    if (score >= 5) return 'rgba(234, 179, 8, 0.15)'
    return 'rgba(239, 68, 68, 0.15)'
  }

  const getScoreLabel = (score) => {
    if (score >= 8) return 'Excellent'
    if (score >= 7) return 'Good'
    if (score >= 5) return 'Average'
    if (score >= 3) return 'Below Average'
    return 'Poor'
  }

  useEffect(() => {
    async function fetchDetails() {
      if (!purchase) return
      
      setLoading(true)
      setError(null)
      
      try {
        const res = await authFetch(`/api/product/${encodeURIComponent(purchase.product_id)}/details`)
        if (!res.ok) {
          throw new Error('Failed to load product details')
        }
        const data = await res.json()
        setDetails(data)
      } catch (err) {
        console.error('Error fetching product details:', err)
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    
    fetchDetails()
  }, [purchase, authFetch])

  if (!purchase) return null

  // Handle both possible field names for product URL
  const productUrl = purchase.product_url || purchase.url

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  return (
    <div style={styles.overlay} onClick={handleOverlayClick}>
      <div style={styles.modal}>
        <button style={styles.closeButton} onClick={onClose}>
          <X size={20} />
        </button>

        {/* Header */}
        <div style={styles.header}>
          {purchase.image_url ? (
            <a 
              href={productUrl || '#'}
              target="_blank"
              rel="noopener noreferrer"
              style={{ cursor: productUrl ? 'pointer' : 'default' }}
              onClick={(e) => !productUrl && e.preventDefault()}
            >
              <img 
                src={purchase.image_url} 
                alt={purchase.product_name}
                style={{...styles.productImage, transition: 'transform 0.2s'}}
                onError={(e) => { e.target.src = '' }}
                onMouseEnter={(e) => productUrl && (e.target.style.transform = 'scale(1.05)')}
                onMouseLeave={(e) => e.target.style.transform = 'scale(1)'}
              />
            </a>
          ) : (
            <div style={{ 
              ...styles.productImage, 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center' 
            }}>
              <ShoppingCart size={32} style={{ color: '#6b7280' }} />
            </div>
          )}
          
          <div style={styles.productInfo}>
            <div style={styles.productName}>{purchase.product_name}</div>
            
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {purchase.price > 0 && (
                <span style={{ 
                  ...styles.badge, 
                  background: 'var(--bg-hover)', 
                  color: 'var(--text)' 
                }}>
                  €{purchase.price.toFixed(2)}
                </span>
              )}
              
              {purchase.brand && (
                <span style={{ 
                  ...styles.badge, 
                  background: 'var(--bg-hover)', 
                  color: 'var(--text-muted)' 
                }}>
                  {purchase.brand}
                </span>
              )}
              
              {purchase.is_organic && (
                <span style={{ 
                  ...styles.badge, 
                  background: 'rgba(34, 197, 94, 0.2)', 
                  color: '#22c55e' 
                }}>
                  🌿 Bio
                </span>
              )}
              
              {purchase.is_vegan && (
                <span style={{ 
                  ...styles.badge, 
                  background: 'rgba(34, 197, 94, 0.2)', 
                  color: '#22c55e' 
                }}>
                  <Leaf size={12} /> Vegan
                </span>
              )}
              
              {purchase.is_fairtrade && (
                <span style={{ 
                  ...styles.badge, 
                  background: 'rgba(59, 130, 246, 0.2)', 
                  color: '#3b82f6' 
                }}>
                  🤝 Fairtrade
                </span>
              )}
            </div>
          </div>
        </div>

        {loading ? (
          <div style={styles.loading}>
            <Loader2 size={32} className="spin" style={{ color: 'var(--primary)' }} />
          </div>
        ) : error ? (
          <div style={{ ...styles.section, color: '#ef4444' }}>
            {error}
          </div>
        ) : details ? (
          <>
            {/* Main Score */}
            <div style={styles.section}>
              <div style={{ 
                ...styles.mainScore, 
                background: getScoreBg(details.score) 
              }}>
                <span style={{ 
                  fontSize: '3rem', 
                  fontWeight: '700', 
                  color: getScoreColor(details.score) 
                }}>
                  {details.score}
                </span>
                <span style={{ 
                  fontSize: '1rem', 
                  color: getScoreColor(details.score),
                  fontWeight: '500'
                }}>
                  {getScoreLabel(details.score)}
                </span>
                <span style={{ 
                  fontSize: '0.8rem', 
                  color: 'var(--text-muted)',
                  marginTop: '0.25rem'
                }}>
                  Sustainability Score
                </span>
              </div>

              {/* Score Breakdown */}
              <div style={styles.sectionTitle}>Score Breakdown</div>
              <div style={styles.scoreBreakdown}>
                {details.breakdown?.map((item, i) => (
                  <div key={i} style={styles.scoreItem}>
                    <span style={styles.scoreLabel}>{item.label}</span>
                    <span style={{ 
                      ...styles.scoreValue, 
                      color: item.positive ? '#22c55e' : item.negative ? '#ef4444' : 'var(--text)' 
                    }}>
                      {item.positive ? <TrendingUp size={14} /> : item.negative ? <TrendingDown size={14} /> : <Minus size={14} />}
                      {' '}{item.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Improvements */}
            {details.improvements && details.improvements.length > 0 && (
              <div style={styles.section}>
                <div style={styles.sectionTitle}>Why this score?</div>
                {details.improvements.map((imp, i) => (
                  <div key={i} style={{
                    ...styles.improvement,
                    background: imp.positive ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                    color: imp.positive ? '#22c55e' : '#ef4444'
                  }}>
                    {imp.positive ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                    {imp.reason}
                  </div>
                ))}
              </div>
            )}

            {/* Better Alternatives */}
            {details.alternatives && details.alternatives.length > 0 && (
              <div style={styles.section}>
                <div style={styles.sectionTitle}>
                  Better Alternatives ({details.alternatives.length})
                </div>
                
                {details.alternatives.map((alt, i) => (
                  <a 
                    key={i}
                    href={alt.url || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={styles.alternativeCard}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'translateX(4px)'
                      e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'translateX(0)'
                      e.currentTarget.style.boxShadow = 'none'
                    }}
                  >
                    {alt.image_url ? (
                      <img 
                        src={alt.image_url} 
                        alt={alt.name}
                        style={styles.altImage}
                        onError={(e) => { e.target.style.display = 'none' }}
                      />
                    ) : (
                      <div style={{ 
                        ...styles.altImage, 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center' 
                      }}>
                        <ShoppingCart size={20} style={{ color: '#6b7280' }} />
                      </div>
                    )}
                    
                    <div style={styles.altInfo}>
                      <div style={styles.altName}>{alt.name}</div>
                      {alt.price > 0 && (
                        <div style={styles.altPrice}>€{alt.price.toFixed(2)}</div>
                      )}
                    </div>
                    
                    <div style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '0.5rem' 
                    }}>
                      <span style={{ 
                        fontWeight: '700', 
                        fontSize: '1.1rem',
                        color: getScoreColor(alt.score) 
                      }}>
                        {alt.score}
                      </span>
                      <span style={{ 
                        color: '#22c55e', 
                        fontSize: '0.75rem' 
                      }}>
                        +{alt.score - details.score}
                      </span>
                      {alt.url && <ExternalLink size={14} style={{ color: 'var(--text-muted)' }} />}
                    </div>
                  </a>
                ))}
              </div>
            )}

            {/* View on AH */}
            {productUrl && (
              <div style={{ padding: '1rem 1.5rem 1.5rem' }}>
                <a 
                  href={productUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-primary"
                  style={{ width: '100%', justifyContent: 'center' }}
                >
                  View on Albert Heijn <ExternalLink size={16} />
                </a>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  )
}

export default ProductDetailModal
