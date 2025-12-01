import { ShoppingBag } from 'lucide-react'
import { useI18n } from '../i18n.jsx'

function PurchaseList({ purchases }) {
  const { t, lang } = useI18n()

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
        <div key={index} className="purchase-item">
          <div className="info">
            <div className="product-name">{purchase.product}</div>
            <div className="details">
              {purchase.quantity}x • €{purchase.price.toFixed(2)} • {formatDate(purchase.date)}
            </div>
          </div>
          <div className={`score-badge ${getScoreClass(purchase.sustainability_score)}`}>
            {purchase.sustainability_score}/10
          </div>
        </div>
      ))}
    </div>
  )
}

export default PurchaseList
