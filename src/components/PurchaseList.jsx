import { useState, useEffect, useCallback } from 'react'
import { ShoppingBag, LogIn, Loader2 } from 'lucide-react'
import { useI18n } from '../i18n.jsx'
import { useAHUser, useAHFetch } from '../lib/ahUserContext'
import ScoreBreakdownModal from './ScoreBreakdownModal'

function PurchaseList({ syncVersion }) {
  const { t, lang } = useI18n()
  const { ahEmail } = useAHUser()
  const ahFetch = useAHFetch()
  
  const [purchases, setPurchases] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedProduct, setSelectedProduct] = useState(null)

  const fetchPurchases = useCallback(async () => {
    if (!ahEmail) {
      setLoading(false)
      return
    }
    
    setLoading(true)
    try {
      const res = await ahFetch('/api/user/purchases/history')
      if (res.ok) {
        const data = await res.json()
        setPurchases(data.purchases || [])
      } else {
        setPurchases([])
      }
    } catch (err) {
      console.error('Failed to fetch purchases:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [ahEmail, ahFetch])

  useEffect(() => {
    fetchPurchases()
  }, [fetchPurchases, syncVersion])

  // Not logged in - fallback (shouldn't happen with new flow)
  if (!ahEmail) {
    return (
      <div style={{
        textAlign: 'center',
        padding: '3rem 2rem',
        background: 'var(--bg-card, #1e293b)',
        borderRadius: '16px',
        border: '1px solid var(--border, #334155)'
      }}>
        <LogIn size={64} style={{ color: 'var(--primary)', marginBottom: '1rem' }} />
        <h2 style={{ color: 'var(--text)', marginBottom: '0.5rem' }}>{t('login_required_title') || 'Connect Required'}</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
          {t('login_required_history') || 'Connect your AH account to view your purchase history.'}
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

  if (!purchases || purchases.length === 0) {
    return (
      <div className="empty-state">
        <ShoppingBag size={100} />
        <h2>{t('no_purchases_heading')}</h2>
        <p>{t('no_purchases_subtext')}</p>
      </div>
    )
  }

  const getScoreClass = (score) => {
    if (score == null) return 'score-na'
    if (score >= 7) return 'score-high'
    if (score >= 4) return 'score-medium'
    return 'score-low'
  }

  const formatDate = (dateString) => {
    if (!dateString) return ''
    const date = new Date(dateString)
    const locale = lang === 'en' ? 'en-US' : 'nl-NL'
    return date.toLocaleDateString(locale, { 
      day: 'numeric', 
      month: 'short', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  return (
    <div className="purchase-list">
      <h2 style={{marginBottom: '1rem'}}>{t('tab_history')} ({purchases.length})</h2>
      {purchases.map((purchase, index) => (
        <div 
          key={purchase.id || index} 
          className="purchase-item"
          onClick={() => setSelectedProduct({
            name: purchase.product_name || purchase.product,
            url: purchase.product_url || purchase.url || null,
            image_url: purchase.image_url || null
          })}
          style={{ cursor: 'pointer' }}
        >
          <div className="info">
            <div className="product-name">{purchase.product_name || purchase.product}</div>
            <div className="details">
              {purchase.quantity || 1}x • €{(purchase.price || 0).toFixed(2)} • {formatDate(purchase.scraped_at || purchase.date)}
            </div>
          </div>
          <div className={`score-badge ${getScoreClass(purchase.sustainability_score)}`}>
            {purchase.sustainability_score != null ? `${purchase.sustainability_score}/10` : '—'}
          </div>
        </div>
      ))}
      
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

export default PurchaseList
