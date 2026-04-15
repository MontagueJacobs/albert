import { useState, useEffect, useCallback } from 'react'
import { TrendingUp, Award, ShoppingCart, DollarSign, Loader2, ChevronDown, ChevronUp, Calendar, MapPin, Leaf, Apple, RefreshCw } from 'lucide-react'
import ProductDetailModal from './ProductDetailModal'
import { useI18n } from '../i18n.jsx'
import { useAuth, useAuthenticatedFetch } from '../lib/authContext'
import { useAHUser } from '../lib/ahUserContext.jsx'
import { useBonusCard } from '../lib/bonusCardContext.jsx'
import { variantScoreColor, variantScoreBg } from '../lib/scoreUtils.js'

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
    background: 'var(--bg-hover, #374151)'
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
  const { user, isAuthenticated } = useAuth()
  const { sessionId, loading: sessionLoading } = useAHUser()
  const { bonusCardNumber, isAuthenticated: isBonusAuth, userInfo: bonusUserInfo, loading: bonusLoading, websiteVariant } = useBonusCard()
  const authFetch = useAuthenticatedFetch()
  
  // User is "connected" if they have JWT auth OR bonus card
  // Note: sessionId alone is NOT sufficient anymore (user_ah_credentials table removed)
  const isUserConnected = isAuthenticated || isBonusAuth
  
  // Debug logging - helps identify wrong-account issues
  console.log('[Dashboard] Current state:', {
    bonusCardNumber: bonusCardNumber ? `...${bonusCardNumber.slice(-4)}` : null,
    isAuthenticated,
    isBonusAuth,
    isUserConnected,
    bonusLoading,
    localStorage: typeof localStorage !== 'undefined' ? `...${(localStorage.getItem('ah_bonus_card') || '').slice(-4)}` : 'N/A'
  })
  
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
  const [selectedPurchase, setSelectedPurchase] = useState(null)
  const [purchaseSort, setPurchaseSort] = useState('worst') // 'worst' or 'best'

  const fetchInsights = useCallback(async () => {
    console.log('[Dashboard] fetchInsights called, isUserConnected:', isUserConnected, 'bonusCardNumber:', bonusCardNumber, 'isAuthenticated:', isAuthenticated)
    
    // Wait for bonus loading to complete
    if (bonusLoading) {
      console.log('[Dashboard] Bonus card still loading, waiting...')
      return
    }
    
    // Skip if not connected (no bonus card AND no JWT auth)
    if (!isUserConnected) {
      console.log('[Dashboard] Skipping fetch - not connected')
      setLoading(false)
      return
    }
    
    // Must have either bonus card or JWT auth to make API call
    if (!bonusCardNumber && !isAuthenticated) {
      console.log('[Dashboard] No bonus card or JWT auth, skipping API call')
      setLoading(false)
      return
    }
    
    setLoading(true)
    try {
      // Use bonus card API if available, otherwise use auth API
      const url = bonusCardNumber 
        ? `/api/bonus/${bonusCardNumber}/suggestions`
        : '/api/user/insights'
      const res = bonusCardNumber 
        ? await fetch(url)
        : await authFetch(url)
        
      console.log('[Dashboard] insights response status:', res.status)
      if (res.ok) {
        const data = await res.json()
        console.log('[Dashboard] insights data:', data)
        setInsights(data)
      } else {
        console.log('[Dashboard] insights response not ok')
        setInsights(null)
      }
    } catch (err) {
      console.error('Failed to fetch insights:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [isUserConnected, authFetch, bonusLoading, bonusCardNumber, isAuthenticated])

  const fetchPurchaseHistory = useCallback(async (page = 1) => {
    // Must have bonus card or JWT auth
    if (!bonusCardNumber && !isAuthenticated) return
    
    setPurchasesLoading(true)
    try {
      // Use bonus card API if available
      const url = bonusCardNumber
        ? `/api/bonus/${bonusCardNumber}/purchases?page=${page}&limit=100`
        : `/api/user/purchases/history?page=${page}&limit=100`
      const res = bonusCardNumber
        ? await fetch(url)
        : await authFetch(url)
        
      if (res.ok) {
        const data = await res.json()
        console.log('[Dashboard] Purchase history response:', data)
        console.log('[Dashboard] Purchases count:', data.purchases?.length, 'total:', data.total)
        setPurchases(data.purchases || [])
        setPurchaseTotal(data.total || 0)
        setPurchaseTotalPages(data.totalPages || 0)
        setPurchasePage(data.page || 1)
      } else {
        console.error('[Dashboard] Purchase history fetch failed:', res.status, res.statusText)
        const errData = await res.json().catch(() => ({}))
        console.error('[Dashboard] Error details:', errData)
        // Show error to user if invalid card
        if (errData.error === 'invalid_card') {
          console.error('[Dashboard] Invalid bonus card format - check localStorage')
        }
      }
    } catch (err) {
      console.error('Failed to fetch purchase history:', err)
    } finally {
      setPurchasesLoading(false)
    }
  }, [bonusCardNumber, isAuthenticated, authFetch])

  useEffect(() => {
    fetchInsights()
  }, [fetchInsights, syncVersion])
  
  // Fetch purchase history when expanding the section
  useEffect(() => {
    if (showHistory) {
      fetchPurchaseHistory(1)
    }
  }, [showHistory, fetchPurchaseHistory])

  // Still loading bonus card context - show spinner
  if (bonusLoading) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem' }}>
        <Loader2 size={48} className="spin" style={{ color: 'var(--primary)' }} />
        <p style={{ color: 'var(--text-muted)', marginTop: '1rem' }}>{t('loading') || 'Loading...'}</p>
      </div>
    )
  }

  // Not logged in - show sync prompt
  if (!isUserConnected) {
    return (
      <div style={styles.loginPrompt}>
        <RefreshCw size={64} style={{ color: 'var(--primary)', marginBottom: '1rem' }} />
        <h2 style={{ color: 'var(--text)', marginBottom: '0.5rem' }}>{t('access_required_title') || 'Connect Your Account'}</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
          {t('access_required_desc') || 'Sync your Albert Heijn account to view your sustainability dashboard.'}
        </p>
        <button 
          className="btn btn-primary btn-lg"
          onClick={() => window.location.href = '/bookmarklet.html'}
        >
          <RefreshCw size={20} />
          {t('sync_account') || 'Sync Account'}
        </button>
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
    // CO2-based ratings
    if (rating.includes('Excellent') || rating.includes('🌿')) return '🌿'
    if (rating.includes('Good') || rating.includes('🌱')) return '🌱'
    if (rating.includes('Average') || rating.includes('🌍')) return '🌍'
    if (rating.includes('High') || rating.includes('⚠️')) return '⚠️'
    return '🔴'
  }

  const ratingLabel = (insights.rating || '').split('!')[0]

  return (
    <div>
      {/* Bonus card indicator */}
      {bonusCardNumber && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.5rem 1rem',
          background: 'rgba(34, 197, 94, 0.1)',
          borderRadius: '8px',
          marginBottom: '1rem',
          fontSize: '0.85rem',
          color: 'var(--text-muted)'
        }}>
          <span style={{ color: '#22c55e' }}>🎫</span>
          <span>Bonuskaart: ••••{bonusCardNumber.slice(-4)}</span>
        </div>
      )}
      
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
          {(() => {
            const score = insights.average_score || 0
            // 10=best (green), 1=worst (red)
            const scoreColor = score >= 8 ? '#22c55e' : score >= 7 ? '#84cc16' : score >= 5 ? '#eab308' : score >= 3 ? '#f97316' : '#ef4444'
            return (
              <div className="value" style={{ color: scoreColor }}>
                {score.toFixed(1)}{t('score_suffix')}
                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 400, marginTop: '0.25rem' }}>
                  {score >= 8 ? '🌿' : score >= 7 ? '🌱' : score >= 5 ? '🌍' : score >= 3 ? '⚠️' : '🔴'}
                  {' '}{score >= 8 ? (t('rating_excellent') || 'Excellent') : score >= 7 ? (t('rating_good') || 'Good') : score >= 5 ? (t('rating_average') || 'Average') : score >= 3 ? (t('rating_high') || 'High') : (t('rating_very_high') || 'Very high')}
                </div>
              </div>
            )
          })()}
        </div>

        <div className="stat-card">
          <h3>
            <Leaf size={18} style={{ display: 'inline', marginRight: '5px' }} />
            {t('avg_co2_per_kg')}
          </h3>
          <div className="value">
            {insights.avg_co2_per_kg != null 
              ? <>{insights.avg_co2_per_kg.toFixed(2)} <span style={{ fontSize: '0.7em', color: 'var(--text-muted)' }}>kg CO₂/kg</span></>
              : <span style={{ color: 'var(--text-muted)' }}>—</span>}
          </div>
        </div>

        {insights.total_spent > 0 && (
        <div className="stat-card">
          <h3>
            <DollarSign size={18} style={{ display: 'inline', marginRight: '5px' }} />
            {t('total_spent')}
          </h3>
          <div className="value">€{insights.total_spent.toFixed(2)}</div>
          {insights.priced_items != null && insights.total_purchases > 0 && insights.priced_items < insights.total_purchases && (
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              {t('price_coverage')} ({insights.priced_items}/{insights.total_purchases})
            </div>
          )}
        </div>
        )}

        {insights.total_co2_kg != null && (
          <div className="stat-card">
            <h3>
              <TrendingUp size={18} style={{ display: 'inline', marginRight: '5px' }} />
              {t('total_co2')}
            </h3>
            <div className="value">
              {insights.total_co2_kg.toFixed(1)} <span style={{ fontSize: '0.7em', color: 'var(--text-muted)' }}>kg CO₂</span>
            </div>
            {insights.total_weight_kg != null && (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                ~{insights.total_weight_kg.toFixed(1)} kg {t('total_food_weight')}
              </div>
            )}
          </div>
        )}

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

      {/* CO2 Baseline Comparison */}
      {insights.baseline_comparison && (
        <div style={{
          ...styles.card,
          background: insights.baseline_comparison.percentBetter >= 0
            ? 'linear-gradient(135deg, rgba(34, 197, 94, 0.08), rgba(16, 185, 129, 0.04))'
            : 'linear-gradient(135deg, rgba(239, 68, 68, 0.08), rgba(220, 38, 38, 0.04))',
          border: `1px solid ${insights.baseline_comparison.percentBetter >= 0 ? 'rgba(34, 197, 94, 0.25)' : 'rgba(239, 68, 68, 0.25)'}`,
        }}>
          <h3 style={styles.heading}>
            🇳🇱 {t('baseline_title')}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', alignItems: 'center' }}>
            {/* User vs Baseline visual */}
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '2rem', fontWeight: 'bold', color: insights.baseline_comparison.percentBetter >= 0 ? '#22c55e' : '#ef4444' }}>
                {insights.baseline_comparison.percentBetter >= 0 ? '↓' : '↑'} {Math.abs(insights.baseline_comparison.percentBetter)}%
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                {insights.baseline_comparison.percentBetter >= 0 
                  ? t('baseline_better')
                  : t('baseline_worse')}
              </div>
            </div>
            
            {/* CO2/kg comparison bars */}
            <div>
              <div style={{ marginBottom: '0.75rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                  <span>{t('baseline_you')}</span>
                  <span>{insights.baseline_comparison.userAvgCO2PerKg?.toFixed(2)} kg CO₂/kg</span>
                </div>
                <div style={{ background: 'var(--progress-track, rgba(255,255,255,0.1))', borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
                  <div style={{
                    width: `${Math.min(100, (insights.baseline_comparison.userAvgCO2PerKg / Math.max(insights.baseline_comparison.baseline, insights.baseline_comparison.userAvgCO2PerKg)) * 100)}%`,
                    height: '100%',
                    background: insights.baseline_comparison.percentBetter >= 0 ? '#22c55e' : '#ef4444',
                    borderRadius: '4px',
                    transition: 'width 0.5s ease'
                  }} />
                </div>
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                  <span>{t('baseline_avg_nl')}</span>
                  <span>{insights.baseline_comparison.baseline?.toFixed(2)} kg CO₂/kg</span>
                </div>
                <div style={{ background: 'var(--progress-track, rgba(255,255,255,0.1))', borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
                  <div style={{
                    width: `${Math.min(100, (insights.baseline_comparison.baseline / Math.max(insights.baseline_comparison.baseline, insights.baseline_comparison.userAvgCO2PerKg)) * 100)}%`,
                    height: '100%',
                    background: '#6b7280',
                    borderRadius: '4px',
                    transition: 'width 0.5s ease'
                  }} />
                </div>
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.5rem', textAlign: 'right' }}>
                {t('baseline_source')}
              </div>
            </div>
          </div>
          
          {/* Annual projection */}
          {insights.baseline_comparison.userProjectedAnnual && (
            <div style={{ 
              marginTop: '1rem', 
              paddingTop: '0.75rem', 
              borderTop: '1px solid var(--divider, rgba(255,255,255,0.1))',
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '0.85rem',
              color: 'var(--text-muted)'
            }}>
              <span>{t('baseline_projected_annual')}</span>
              <span style={{ fontWeight: '600', color: 'var(--text)' }}>
                ~{(insights.baseline_comparison.userProjectedAnnual / 1000).toFixed(1)} {t('baseline_tonnes')} 
                <span style={{ fontWeight: 'normal', color: 'var(--text-muted)' }}> ({t('baseline_nl_avg')}: {(insights.baseline_comparison.baselineAnnual / 1000).toFixed(1)}t)</span>
              </span>
            </div>
          )}
        </div>
      )}

      {insights.best_purchase && (
        <div style={styles.card}>
          <h3 style={styles.heading}>{t('rating_best_worst')}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div
              onClick={() => insights.best_purchase_obj && setSelectedPurchase(insights.best_purchase_obj)}
              style={{ cursor: insights.best_purchase_obj ? 'pointer' : 'default', padding: '0.75rem', borderRadius: '10px', transition: 'background 0.15s', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}
              onMouseEnter={e => { if (insights.best_purchase_obj) e.currentTarget.style.background = 'var(--bg-hover, rgba(255,255,255,0.05))' }}
              onMouseLeave={e => { e.currentTarget.style.background = '' }}
            >
              {insights.best_purchase_obj?.image_url && (
                <img src={insights.best_purchase_obj.image_url} alt="" style={{ width: '64px', height: '64px', objectFit: 'contain', borderRadius: '8px' }} onError={e => { e.target.style.display = 'none' }} />
              )}
              <p style={{ ...styles.bestPurchase, textAlign: 'center', margin: 0 }}>🌟 {t('best_purchase')}: {insights.best_purchase}</p>
            </div>
            <div
              onClick={() => insights.worst_purchase_obj && setSelectedPurchase(insights.worst_purchase_obj)}
              style={{ cursor: insights.worst_purchase_obj ? 'pointer' : 'default', padding: '0.75rem', borderRadius: '10px', transition: 'background 0.15s', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}
              onMouseEnter={e => { if (insights.worst_purchase_obj) e.currentTarget.style.background = 'var(--bg-hover, rgba(255,255,255,0.05))' }}
              onMouseLeave={e => { e.currentTarget.style.background = '' }}
            >
              {insights.worst_purchase_obj?.image_url && (
                <img src={insights.worst_purchase_obj.image_url} alt="" style={{ width: '64px', height: '64px', objectFit: 'contain', borderRadius: '8px' }} onError={e => { e.target.style.display = 'none' }} />
              )}
              <p style={{ ...styles.worstPurchase, textAlign: 'center', margin: 0 }}>⚠️ {t('worst_purchase')}: {insights.worst_purchase}</p>
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
                {/* Sort toggle */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.75rem', gap: '0.25rem' }}>
                  <button
                    onClick={() => setPurchaseSort('worst')}
                    style={{
                      padding: '0.3rem 0.75rem',
                      fontSize: '0.75rem',
                      fontWeight: purchaseSort === 'worst' ? 700 : 400,
                      background: purchaseSort === 'worst' ? 'rgba(239, 68, 68, 0.15)' : 'transparent',
                      color: purchaseSort === 'worst' ? '#ef4444' : 'var(--text-muted)',
                      border: `1px solid ${purchaseSort === 'worst' ? 'rgba(239, 68, 68, 0.3)' : 'var(--border, #334155)'}`,
                      borderRadius: '8px',
                      cursor: 'pointer'
                    }}
                  >
                    {t('sort_worst') || 'Worst first'}
                  </button>
                  <button
                    onClick={() => setPurchaseSort('best')}
                    style={{
                      padding: '0.3rem 0.75rem',
                      fontSize: '0.75rem',
                      fontWeight: purchaseSort === 'best' ? 700 : 400,
                      background: purchaseSort === 'best' ? 'rgba(34, 197, 94, 0.15)' : 'transparent',
                      color: purchaseSort === 'best' ? '#22c55e' : 'var(--text-muted)',
                      border: `1px solid ${purchaseSort === 'best' ? 'rgba(34, 197, 94, 0.3)' : 'var(--border, #334155)'}`,
                      borderRadius: '8px',
                      cursor: 'pointer'
                    }}
                  >
                    {t('sort_best') || 'Best first'}
                  </button>
                </div>
                {[...purchases].sort((a, b) => {
                  const aScore = a.sustainability_score ?? (purchaseSort === 'worst' ? 999 : -1)
                  const bScore = b.sustainability_score ?? (purchaseSort === 'worst' ? 999 : -1)
                  return purchaseSort === 'worst' ? aScore - bScore : bScore - aScore
                }).map((purchase) => (
                  <PurchaseItem 
                    key={purchase.id} 
                    purchase={purchase} 
                    onClick={() => setSelectedPurchase(purchase)}
                    variant={websiteVariant}
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
      

      
      {/* Product Detail Modal */}
      {selectedPurchase && (
        <ProductDetailModal 
          purchase={selectedPurchase} 
          onClose={() => setSelectedPurchase(null)} 
        />
      )}
    </div>
  )
}

// Helper component for individual purchase items
function PurchaseItem({ purchase, onClick, variant }) {
  const getScoreColor = (score) => variantScoreColor(variant, score)
  const getScoreBg = (score) => variantScoreBg(variant, score)

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
    <div 
      style={{
        ...styles.purchaseItem,
        cursor: 'pointer',
        transition: 'transform 0.2s, box-shadow 0.2s'
      }}
      onClick={onClick}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateX(4px)'
        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateX(0)'
        e.currentTarget.style.boxShadow = 'none'
      }}
    >
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
          
          {purchase.is_fairtrade && (
            <span style={{ 
              ...styles.badge, 
              background: 'rgba(59, 130, 246, 0.2)', 
              color: '#3b82f6' 
            }}>
              🤝 Fairtrade
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
          {purchase.sustainability_score != null ? purchase.sustainability_score : '—'}
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

