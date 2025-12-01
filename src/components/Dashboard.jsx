import { TrendingUp, Award, ShoppingCart, DollarSign } from 'lucide-react'
import ProfileSuggestions from './ProfileSuggestions'
import { useI18n } from '../i18n.jsx'

function Dashboard({ insights }) {
  const { t } = useI18n()

  if (!insights || insights.message) {
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
          <div className="value">{insights.average_score.toFixed(1)}{t('score_suffix')}</div>
        </div>

        <div className="stat-card">
          <h3>
            <DollarSign size={18} style={{ display: 'inline', marginRight: '5px' }} />
            {t('total_spent')}
          </h3>
          <div className="value">€{insights.total_spent.toFixed(2)}</div>
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

      <div style={{ background: '#f8f9fa', padding: '1.5rem', borderRadius: '12px', marginTop: '2rem' }}>
        <h3 style={{ marginBottom: '1rem' }}>{t('rating_best_worst')}</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
          <div>
            <p style={{ color: '#16a34a', fontWeight: '600' }}>🌟 {t('best_purchase')}: {insights.best_purchase}</p>
          </div>
          <div>
            <p style={{ color: '#dc2626', fontWeight: '600' }}>⚠️ {t('worst_purchase')}: {insights.worst_purchase}</p>
          </div>
        </div>
      </div>

      <div style={{ marginTop: '2rem', padding: '1.5rem', background: 'white', borderRadius: '12px', border: '1px solid #e0e0e0' }}>
        <h3 style={{ marginBottom: '1rem' }}>{t('tips_title')}</h3>
        <ul style={{ paddingLeft: '1.5rem' }}>
          {(t('tips') || []).map((tip, i) => (
            <li key={i} style={{ marginBottom: '0.5rem' }}>{tip}</li>
          ))}
        </ul>
      </div>

      <ProfileSuggestions />
    </div>
  )
}

export default Dashboard

