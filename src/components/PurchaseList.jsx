import { useState, useEffect, useCallback } from 'react'
import { ShoppingBag, LogIn, Loader2 } from 'lucide-react'
import { useI18n } from '../i18n.jsx'
import { useAuth, useAuthenticatedFetch } from '../lib/authContext'

function PurchaseList({ syncVersion, onLoginClick }) {
  const { t, lang } = useI18n()
  const { user, isAuthenticated } = useAuth()
  const authFetch = useAuthenticatedFetch()
  
  const [purchases, setPurchases] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchPurchases = useCallback(async () => {
    if (!isAuthenticated) {
      setLoading(false)
      return
    }
    
    setLoading(true)
    try {
      const res = await authFetch('/api/user/purchases')
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
  }, [isAuthenticated, authFetch])

  useEffect(() => {
    fetchPurchases()
  }, [fetchPurchases, syncVersion])

  // Not logged in - show login prompt
  if (!isAuthenticated) {
    return (
      <div style={{
        textAlign: 'center',
        padding: '3rem 2rem',
        background: 'var(--bg-card, #1e293b)',
        borderRadius: '16px',
        border: '1px solid var(--border, #334155)'
      }}>
        <LogIn size={64} style={{ color: 'var(--primary)', marginBottom: '1rem' }} />
        <h2 style={{ color: 'var(--text)', marginBottom: '0.5rem' }}>{t('login_required_title') || 'Login Required'}</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
          {t('login_required_history') || 'Please log in to view your purchase history.'}
        </p>
        <button 
          className="btn btn-primary btn-lg"
          onClick={onLoginClick}
        >
          <LogIn size={20} />
          {t('login_button') || 'Log In / Sign Up'}
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
        <div key={purchase.id || index} className="purchase-item">
          <div className="info">
            <div className="product-name">{purchase.product_name || purchase.product}</div>
            <div className="details">
              {purchase.quantity || 1}x • €{(purchase.price || 0).toFixed(2)} • {formatDate(purchase.scraped_at || purchase.date)}
            </div>
          </div>
          <div className={`score-badge ${getScoreClass(purchase.sustainability_score || 5)}`}>
            {purchase.sustainability_score || 5}/10
          </div>
        </div>
      ))}
    </div>
  )
}

export default PurchaseList
