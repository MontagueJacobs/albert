import { useState, useEffect } from 'react'
import { X, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { useI18n } from '../i18n.jsx'

// Score breakdown modal component
function ScoreBreakdownModal({ product, onClose }) {
  const { t, lang } = useI18n()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!product) return
    
    setLoading(true)
    setError(null)
    
    fetch(`/api/score?product=${encodeURIComponent(product.name)}&lang=${lang}`)
      .then(res => res.json())
      .then(data => {
        setData(data)
        setLoading(false)
      })
      .catch(err => {
        setError(err.message)
        setLoading(false)
      })
  }, [product, lang])

  if (!product) return null

  const modalOverlay = {
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
  }

  const modalContent = {
    background: 'var(--bg-card, #1e293b)',
    borderRadius: '16px',
    maxWidth: '500px',
    width: '100%',
    maxHeight: '80vh',
    overflow: 'auto',
    border: '1px solid var(--border, #334155)'
  }

  const modalHeader = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: '1.25rem',
    borderBottom: '1px solid var(--border, #334155)'
  }

  const modalBody = {
    padding: '1.25rem'
  }

  const adjustmentItem = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.5rem 0',
    borderBottom: '1px solid var(--border, #334155)'
  }

  const getDeltaColor = (delta) => {
    if (delta > 0) return '#22c55e'
    if (delta < 0) return '#ef4444'
    return 'var(--text-muted)'
  }

  const getDeltaIcon = (delta) => {
    if (delta > 0) return <TrendingUp size={14} style={{ color: '#22c55e' }} />
    if (delta < 0) return <TrendingDown size={14} style={{ color: '#ef4444' }} />
    return <Minus size={14} style={{ color: 'var(--text-muted)' }} />
  }

  const formatAdjustmentLabel = (adj) => {
    // Make the code more readable
    const code = adj.code || ''
    if (code.startsWith('category_')) return `Category: ${code.replace('category_', '')}`
    if (code.startsWith('keyword_')) return `Keyword: ${code.replace('keyword_', '')}`
    if (code.startsWith('enriched_')) return code.replace('enriched_', '').replace(/_/g, ' ')
    if (code.startsWith('trait_')) return code.replace('trait_', '').replace(/_/g, ' ')
    if (code === 'catalog_base') return 'Base product score'
    return code.replace(/_/g, ' ')
  }

  return (
    <div style={modalOverlay} onClick={onClose}>
      <div style={modalContent} onClick={e => e.stopPropagation()}>
        <div style={modalHeader}>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', flex: 1 }}>
            {product.image_url && (
              <img 
                src={product.image_url} 
                alt={product.name}
                style={{
                  width: '60px',
                  height: '60px',
                  objectFit: 'contain',
                  borderRadius: '8px',
                  background: 'var(--bg-hover, #334155)',
                  flexShrink: 0
                }}
                onError={(e) => { e.target.style.display = 'none' }}
              />
            )}
            <div>
              <h3 style={{ margin: 0, color: 'var(--text)', fontSize: '1.1rem' }}>{product.name}</h3>
              <p style={{ margin: '0.25rem 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                {t('modal_score_breakdown')}
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            style={{ 
              background: 'none', 
              border: 'none', 
              cursor: 'pointer',
              padding: '0.25rem',
              color: 'var(--text-muted)'
            }}
          >
            <X size={20} />
          </button>
        </div>
        
        <div style={modalBody}>
          {loading && (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
              {t('modal_loading')}
            </div>
          )}
          
          {error && (
            <div style={{ color: '#ef4444', padding: '1rem' }}>
              {t('modal_error')}: {error}
            </div>
          )}
          
          {data && !loading && (
            <>
              {/* Final Score */}
              <div style={{ 
                textAlign: 'center', 
                padding: '1.5rem',
                background: 'var(--bg-hover, #334155)',
                borderRadius: '12px',
                marginBottom: '1rem'
              }}>
                <div style={{ 
                  fontSize: '3rem', 
                  fontWeight: 700,
                  color: data.score >= 7 ? '#22c55e' : data.score >= 5 ? '#f59e0b' : '#ef4444'
                }}>
                  {data.score}
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                  {data.rating || 'Score'} ({t('modal_base_score')}: 5)
                </div>
              </div>

              {/* Enriched badges */}
              {data.enriched && data.enriched.length > 0 && (
                <div style={{ marginBottom: '1rem' }}>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                    {t('modal_product_attributes')}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                    {data.enriched.map((e, i) => (
                      <span key={i} style={{
                        background: e.delta > 0 ? 'rgba(34, 197, 94, 0.2)' : e.delta < 0 ? 'rgba(239, 68, 68, 0.2)' : 'var(--bg-hover)',
                        color: e.delta > 0 ? '#22c55e' : e.delta < 0 ? '#ef4444' : 'var(--text)',
                        padding: '0.25rem 0.5rem',
                        borderRadius: '6px',
                        fontSize: '0.85rem'
                      }}>
                        {e.icon} {e.label} ({e.delta > 0 ? '+' : ''}{e.delta})
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Score adjustments */}
              {data.adjustments && data.adjustments.length > 0 && (
                <div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                    {t('modal_score_adjustments')}
                  </div>
                  <div style={{ 
                    background: 'var(--bg-hover, #334155)', 
                    borderRadius: '8px',
                    padding: '0.5rem 0.75rem'
                  }}>
                    {data.adjustments.map((adj, i) => (
                      <div key={i} style={{
                        ...adjustmentItem,
                        borderBottom: i === data.adjustments.length - 1 ? 'none' : adjustmentItem.borderBottom
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          {getDeltaIcon(adj.delta)}
                          <span style={{ color: 'var(--text)', fontSize: '0.9rem' }}>
                            {formatAdjustmentLabel(adj)}
                          </span>
                        </div>
                        <span style={{ 
                          color: getDeltaColor(adj.delta),
                          fontWeight: 600,
                          fontSize: '0.9rem'
                        }}>
                          {adj.delta > 0 ? '+' : ''}{adj.delta}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Categories */}
              {data.categories && data.categories.length > 0 && (
                <div style={{ marginTop: '1rem' }}>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                    {t('modal_categories')}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                    {data.categories.map((cat, i) => (
                      <span key={i} style={{
                        background: 'var(--bg-hover)',
                        color: 'var(--text)',
                        padding: '0.25rem 0.5rem',
                        borderRadius: '6px',
                        fontSize: '0.85rem'
                      }}>
                        {cat.icon} {cat.category}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Suggestions */}
              {data.suggestions && data.suggestions.length > 0 && (
                <div style={{ marginTop: '1rem' }}>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                    {t('modal_suggestions')}
                  </div>
                  <ul style={{ 
                    margin: 0, 
                    paddingLeft: '1.25rem', 
                    color: 'var(--text)',
                    fontSize: '0.9rem'
                  }}>
                    {data.suggestions.slice(0, 3).map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Link to AH */}
              {product.url ? (
                <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
                  <a 
                    href={product.url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    onClick={(e) => {
                      e.stopPropagation()
                      console.log('Opening URL:', product.url)
                    }}
                    style={{
                      color: 'var(--accent, #3b82f6)',
                      fontSize: '0.9rem',
                      cursor: 'pointer',
                      textDecoration: 'underline'
                    }}
                  >
                    {t('modal_view_on_ah')}
                  </a>
                </div>
              ) : (
                <div style={{ marginTop: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                  {t('modal_no_link')}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default ScoreBreakdownModal
