import { useState } from 'react'
import { Sparkles, LogIn } from 'lucide-react'
import { useI18n } from '../i18n.jsx'
import { useAuth, useAuthenticatedFetch } from '../lib/authContext'

function AddPurchase({ onPurchaseAdded, onLoginClick }) {
  const [product, setProduct] = useState('')
  const [quantity, setQuantity] = useState(1)
  const [price, setPrice] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [suggestions, setSuggestions] = useState([])

  const { t } = useI18n()
  const { user, isAuthenticated } = useAuth()
  const authFetch = useAuthenticatedFetch()

  // If not authenticated, show login prompt
  if (!isAuthenticated) {
    return (
      <div style={{textAlign: 'center', padding: '3rem 1rem'}}>
        <LogIn size={48} style={{color: 'var(--text-muted)', marginBottom: '1rem'}} />
        <h3 style={{color: 'var(--text)', marginBottom: '0.5rem'}}>{t('login_required') || 'Login Required'}</h3>
        <p style={{color: 'var(--text-muted)', marginBottom: '1.5rem'}}>
          {t('login_to_add_purchases') || 'Please log in to add purchases to your account.'}
        </p>
        {onLoginClick && (
          <button 
            className="btn btn-primary"
            onClick={onLoginClick}
          >
            {t('sign_in') || 'Sign In'}
          </button>
        )}
      </div>
    )
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)

    try {
      const response = await authFetch('/api/user/purchases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product,
          quantity: parseInt(quantity),
          price: parseFloat(price) || 0
        })
      })

      const data = await response.json()
      setResult(data.purchase)
      
      // Get suggestions
      const suggestionsRes = await fetch(`/api/suggestions?product=${encodeURIComponent(product)}`)
      const suggestionsData = await suggestionsRes.json()
      setSuggestions(suggestionsData.suggestions)

      // Clear form
      setProduct('')
      setQuantity(1)
      setPrice('')

      // Notify parent
      if (onPurchaseAdded) {
        onPurchaseAdded()
      }

      // Clear result after 5 seconds
      setTimeout(() => {
        setResult(null)
        setSuggestions([])
      }, 5000)
    } catch (error) {
      console.error('Error adding purchase:', error)
      alert(t('add_error'))
    } finally {
      setLoading(false)
    }
  }

  const getScoreClass = (score) => {
    if (score >= 7) return 'score-high'
    if (score >= 4) return 'score-medium'
    return 'score-low'
  }

  return (
    <div>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="product">{t('product_label')}</label>
          <input
            id="product"
            type="text"
            value={product}
            onChange={(e) => setProduct(e.target.value)}
            placeholder={t('product_placeholder')}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="quantity">{t('quantity_label')}</label>
          <input
            id="quantity"
            type="number"
            min="1"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="price">{t('price_label')}</label>
          <input
            id="price"
            type="number"
            step="0.01"
            min="0"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder={t('price_placeholder')}
          />
        </div>

        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? t('adding_button') : t('add_button')}
        </button>
      </form>

      {result && (
        <div style={{marginTop: '2rem', padding: '1.5rem', background: 'rgba(34, 197, 94, 0.15)', border: '1px solid rgba(34, 197, 94, 0.3)', borderRadius: '12px'}}>
          <h3 style={{color: '#22c55e', marginBottom: '1rem'}}>
            <Sparkles size={20} style={{display: 'inline', verticalAlign: 'middle', marginRight: '5px'}} />
            {t('added_title')}
          </h3>
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
            <div>
              <p style={{fontSize: '1.2rem', fontWeight: '600', color: 'var(--text, #f3f4f6)'}}>{result.product}</p>
              <p style={{color: 'var(--text-muted, #9ca3af)'}}>{t('added_quantity')}: {result.quantity}</p>
            </div>
            <div className={`score-badge ${getScoreClass(result.sustainability_score)}`}>
              {t('score_label')}: {result.sustainability_score}{t('score_suffix')}
            </div>
          </div>

          {suggestions.length > 0 && (
            <div className="suggestions">
              <h4 style={{color: 'var(--text, #f3f4f6)'}}>{t('suggestions_heading')}</h4>
              <ul style={{color: 'var(--text-muted, #9ca3af)'}}>
                {suggestions.map((suggestion, idx) => (
                  <li key={idx}>{suggestion}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default AddPurchase
