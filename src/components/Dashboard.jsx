import { useState, useEffect, useCallback } from 'react'
import { TrendingUp, Award, ShoppingCart, DollarSign, LogIn, Loader2, ChevronDown, ChevronUp, Calendar, MapPin, Leaf, Apple } from 'lucide-react'
import ProfileSuggestions from './ProfileSuggestions'
import ScoreBreakdownModal from './ScoreBreakdownModal'
import { useI18n } from '../i18n.jsx'
import { useAHUser, useAHFetch } from '../lib/ahUserContext'

// Dark mode styles
const styles = {
  card: {
    background: 'var(--bg-card, #1e293b)',
    padding: '1.5rem',
    borderRadius: '12px',
    border: '1px solid var(--border, #334155)',
    marginTop: '2rem',
    color: 'var(--text, #f3f4f6)'
  },
  heading: {
    marginBottom: '1rem',
    color: 'var(--text, #f3f4f6)'
  },
  bestPurchase: {
    color: '#22c55e',
    fontWeight: '600'
  },
  worstPurchase: {
    color: '#ef4444',
    fontWeight: '600'
  },
  tipsList: {
    paddingLeft: '1.5rem',
    color: 'var(--text-muted, #9ca3af)'
  },
  tipItem: {
    marginBottom: '0.5rem',
    color: 'var(--text, #f3f4f6)'
  },
  loginPrompt: {
    textAlign: 'center',
    padding: '3rem 2rem',
    background: 'var(--bg-card, #1e293b)',
    borderRadius: '16px',
    border: '1px solid var(--border, #334155)'
  },
  purchaseItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    padding: '1rem',
    background: 'var(--bg-secondary, #0f172a)',
    borderRadius: '8px',
    marginBottom: '0.75rem',
    border: '1px solid var(--border, #334155)'
  },
  purchaseImage: {
    width: '60px',
    height: '60px',
    borderRadius: '8px',
    objectFit: 'cover',
    background: '#374151'
  },
  purchaseDetails: {
    flex: 1,
    minWidth: 0
  },
  purchaseName: {
    fontWeight: '600',
    color: 'var(--text, #f3f4f6)',
    marginBottom: '0.25rem',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  },
  purchaseMeta: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.5rem',
    fontSize: '0.85rem',
    color: 'var(--text-muted, #9ca3af)'
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.25rem',
    padding: '0.15rem 0.5rem',
    borderRadius: '9999px',
    fontSize: '0.75rem',
    fontWeight: '500'
  },
  scoreBox: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '50px',
    padding: '0.5rem',
    borderRadius: '8px'
  }
}

function Dashboard({ syncVersion }) {
  const { t } = useI18n()
  const { ahEmail } = useAHUser()
  const ahFetch = useAHFetch()
  
  const [insights, setInsights] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  
  // Purchase history state
  const [purchases, setPurchases] = useState([])
  const [purchasesLoading, setPurchasesLoading] = useState(false)
  const [purchasePage, setPurchasePage] = useState(1)
  const [purchaseTotal, setPurchaseTotal] = useState(0)
  const [purchaseTotalPages, setPurchaseTotalPages] = useState(0)
  const [showHistory, setShowHistory] = useState(false)
  const [selectedProduct, setSelectedProduct] = useState(null)

  const fetchInsights = useCallback(async () => {
    if (!ahEmail) {
      setLoading(false)
      return
    }
    
    setLoading(true)
    try {
      const res = await ahFetch('/api/user/insights')
      if (res.ok) {
        const data = await res.json()
        setInsights(data)
      } else {
        setInsights(null)
      }
    } catch (err) {
      console.error('Failed to fetch insights:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [ahEmail, ahFetch])

  const fetchPurchaseHistory = useCallback(async (page = 1) => {
    if (!ahEmail) return
    
    setPurchasesLoading(true)
    try {
      const res = await ahFetch(`/api/user/purchases/history?page=${page}&limit=20`)
      if (res.ok) {
        const data = await res.json()
        console.log('[Dashboard] Purchase history response:', data)
        setPurchases(data.purchases || [])
        setPurchaseTotal(data.total || 0)
        setPurchaseTotalPages(data.totalPages || 0)
        setPurchasePage(data.page || 1)
      } else {
        console.error('[Dashboard] Purchase history fetch failed:', res.status, res.statusText)
        const errData = await res.json().catch(() => ({}))
        console.error('[Dashboard] Error details:', errData)
      }
    } catch (err) {
      console.error('Failed to fetch purchase history:', err)
    } finally {
      setPurchasesLoading(false)
    }
  }, [ahEmail, ahFetch])

  useEffect(() => {
    fetchInsights()
  }, [fetchInsights, syncVersion])
  
  // Fetch purchase history when expanding the section
  useEffect(() => {
    if (showHistory) {
      fetchPurchaseHistory(1)
    }
  }, [showHistory, fetchPurchaseHistory])

  // Not logged in - shouldn't happen since we're only shown when ahEmail exists
  // but keep as fallback
  if (!ahEmail) {
    return (
      <div style={styles.loginPrompt}>
        <LogIn size={64} style={{ color: 'var(--primary)', marginBottom: '1rem' }} />
        <h2 style={{ color: 'var(--text)', marginBottom: '0.5rem' }}>{t('login_required_title') || 'Connect Required'}</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
          {t('login_required_desc') || 'Connect your Albert Heijn account to view your sustainability dashboard.'}
        </p>
      </div>
    )
  }

  // Loading state
  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem' }}>
        <Loader2 size={48} className="spin" style={{ color: 'var(--primary)' }} />
        <p style={{ color: 'var(--text-muted)', marginTop: '1rem' }}>{t('loading') || 'Loading...'}</p>
      </div>
    )
  }

  // No purchases yet
  if (!insights || insights.total_purchases === 0) {
    return (
      <div className="empty-state">
        <ShoppingCart size={100} />
        <h2>{t('no_purchases_heading')}</h2>
        <p>{t('no_purchases_subtext')}</p>
      </div>
    )
  }

  const getRatingEmoji = (rating) => {
    if (!rating) return ''
    if (rating.includes('Excellent')) return '🌟'
    if (rating.includes('Good')) return '👍'
    if (rating.includes('Average')) return '😐'
    return '⚠️'
  }

  const ratingLabel = (insights.rating || '').split('!')[0]

  return (
    <div>
      <div className="stats-grid">
        <div className="stat-card">
          <h3>
            <ShoppingCart size={18} style={{ display: 'inline', marginRight: '5px' }} />
            {t('total_purchases')}
          </h3>
          <div className="value">{insights.total_purchases}</div>
        </div>

        <div className="stat-card">
          <h3>
            <TrendingUp size={18} style={{ display: 'inline', marginRight: '5px' }} />
            {t('avg_score_label')}
          </h3>
          <div className="value">{(insights.average_score || 0).toFixed(1)}{t('score_suffix')}</div>
        </div>

        <div className="stat-card">
          <h3>
            <DollarSign size={18} style={{ display: 'inline', marginRight: '5px' }} />
            {t('total_spent')}
          </h3>
          <div className="value">€{(insights.total_spent || 0).toFixed(2)}</div>
        </div>

        <div className="stat-card">
          <h3>
            <Award size={18} style={{ display: 'inline', marginRight: '5px' }} />
            {t('your_rating')}
          </h3>
          <div style={{ fontSize: '1.2rem', marginTop: '0.5rem' }}>
            {getRatingEmoji(insights.rating)} {ratingLabel}
          </div>
        </div>
      </div>

      {insights.best_purchase && (
        <div style={styles.card}>
          <h3 style={styles.heading}>{t('rating_best_worst')}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div>
              <p style={styles.bestPurchase}>🌟 {t('best_purchase')}: {insights.best_purchase}</p>
            </div>
            <div>
              <p style={styles.worstPurchase}>⚠️ {t('worst_purchase')}: {insights.worst_purchase}</p>
            </div>
          </div>
        </div>
      )}

      <div style={styles.card}>
        <h3 style={styles.heading}>{t('tips_title')}</h3>
        <ul style={styles.tipsList}>
          {(t('tips') || []).map((tip, i) => (
            <li key={i} style={styles.tipItem}>{tip}</li>
          ))}
        </ul>
      </div>

      <ProfileSuggestions />
      
      {/* Purchase History Section */}
      <div style={styles.card}>
        <button
          onClick={() => setShowHistory(!showHistory)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--text, #f3f4f6)',
            padding: 0
          }}
        >
          <h3 style={{ ...styles.heading, margin: 0 }}>
            <Calendar size={18} style={{ display: 'inline', marginRight: '8px' }} />
            {t('purchase_history') || 'Purchase History'}
            <span style={{ 
              marginLeft: '0.5rem', 
              fontSize: '0.9rem', 
              color: 'var(--text-muted)', 
              fontWeight: 'normal' 
            }}>
              ({purchaseTotal || insights?.total_purchases || 0} {t('items') || 'items'})
            </span>
          </h3>
          {showHistory ? <ChevronUp size={24} /> : <ChevronDown size={24} />}
        </button>
        
        {showHistory && (
          <div style={{ marginTop: '1rem' }}>
            {purchasesLoading ? (
              <div style={{ textAlign: 'center', padding: '2rem' }}>
                <Loader2 size={32} className="spin" style={{ color: 'var(--primary)' }} />
              </div>
            ) : purchases.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', textAlign: 'center' }}>
                {t('no_purchases') || 'No purchases found'}
              </p>
            ) : (
              <>
                {purchases.map((purchase) => (
                  <PurchaseItem 
                    key={purchase.id} 
                    purchase={purchase} 
                    onClick={() => setSelectedProduct({
                      name: purchase.product_name,
                      url: purchase.product_url || purchase.url || null,
                      image_url: purchase.image_url || null
                    })}
                  />
                ))}
                
                {/* Pagination */}
                {purchaseTotalPages > 1 && (
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'center', 
                    gap: '0.5rem', 
                    marginTop: '1rem' 
                  }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      disabled={purchasePage <= 1}
                      onClick={() => fetchPurchaseHistory(purchasePage - 1)}
                    >
                      {t('previous') || 'Previous'}
                    </button>
                    <span style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      color: 'var(--text-muted)',
                      padding: '0 1rem'
                    }}>
                      {purchasePage} / {purchaseTotalPages}
                    </span>
                    <button
                      className="btn btn-secondary btn-sm"
                      disabled={purchasePage >= purchaseTotalPages}
                      onClick={() => fetchPurchaseHistory(purchasePage + 1)}
                    >
                      {t('next') || 'Next'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
      
      {/* Score breakdown modal */}
      {selectedProduct && (
        <ScoreBreakdownModal 
          product={selectedProduct} 
          onClose={() => setSelectedProduct(null)} 
        />
      )}
    </div>
  )
}

// Helper component for individual purchase items
function PurchaseItem({ purchase, onClick }) {
  const getScoreColor = (score) => {
    if (score >= 7) return '#22c55e'
    if (score >= 5) return '#eab308'
    return '#ef4444'
  }

  const getScoreBg = (score) => {
    if (score >= 7) return 'rgba(34, 197, 94, 0.2)'
    if (score >= 5) return 'rgba(234, 179, 8, 0.2)'
    return 'rgba(239, 68, 68, 0.2)'
  }

  const getNutriScoreColor = (grade) => {
    const colors = {
      'A': '#22c55e',
      'B': '#84cc16',
      'C': '#eab308',
      'D': '#f97316',
      'E': '#ef4444'
    }
    return colors[grade] || '#9ca3af'
  }

  const formatDate = (dateString) => {
    if (!dateString) return ''
    const date = new Date(dateString)
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  return (
    <div style={{ ...styles.purchaseItem, cursor: 'pointer' }} onClick={onClick}>
      {/* Product Image */}
      {purchase.image_url ? (
        <img 
          src={purchase.image_url} 
          alt={purchase.product_name}
          style={styles.purchaseImage}
          onError={(e) => { e.target.style.display = 'none' }}
        />
      ) : (
        <div style={{ 
          ...styles.purchaseImage, 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center' 
        }}>
          <ShoppingCart size={24} style={{ color: '#6b7280' }} />
        </div>
      )}
      
      {/* Product Details */}
      <div style={styles.purchaseDetails}>
        <div style={styles.purchaseName} title={purchase.product_name}>
          {purchase.product_name}
        </div>
        
        <div style={styles.purchaseMeta}>
          {/* Date */}
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <Calendar size={12} />
            {formatDate(purchase.purchased_at)}
          </span>
          
          {/* Price */}
          {purchase.price > 0 && (
            <span>€{purchase.price.toFixed(2)}</span>
          )}
          
          {/* Brand */}
          {purchase.brand && (
            <span>{purchase.brand}</span>
          )}
        </div>
        
        {/* Enriched Data Badges */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', marginTop: '0.5rem' }}>
          {purchase.is_vegan && (
            <span style={{ 
              ...styles.badge, 
              background: 'rgba(34, 197, 94, 0.2)', 
              color: '#22c55e' 
            }}>
              <Leaf size={12} /> Vegan
            </span>
          )}
          
          {purchase.is_vegetarian && !purchase.is_vegan && (
            <span style={{ 
              ...styles.badge, 
              background: 'rgba(132, 204, 22, 0.2)', 
              color: '#84cc16' 
            }}>
              <Leaf size={12} /> Vegetarian
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
          
          {purchase.nutri_score && (
            <span style={{ 
              ...styles.badge, 
              background: `${getNutriScoreColor(purchase.nutri_score)}33`, 
              color: getNutriScoreColor(purchase.nutri_score) 
            }}>
              <Apple size={12} /> Nutri-Score {purchase.nutri_score}
            </span>
          )}
          
          {purchase.origin_country && (
            <span style={{ 
              ...styles.badge, 
              background: 'rgba(59, 130, 246, 0.2)', 
              color: '#3b82f6' 
            }}>
              <MapPin size={12} /> {purchase.origin_country}
            </span>
          )}
        </div>
      </div>
      
      {/* Sustainability Score */}
      <div style={{ 
        ...styles.scoreBox,
        background: getScoreBg(purchase.sustainability_score)
      }}>
        <span style={{ 
          fontSize: '1.5rem', 
          fontWeight: '700', 
          color: getScoreColor(purchase.sustainability_score) 
        }}>
          {purchase.sustainability_score}
        </span>
        <span style={{ 
          fontSize: '0.65rem', 
          color: 'var(--text-muted)',
          textTransform: 'uppercase'
        }}>
          score
        </span>
      </div>
    </div>
  )
}

export default Dashboard

