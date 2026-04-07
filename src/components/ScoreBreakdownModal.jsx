import { useState, useEffect } from 'react'
import { X, TrendingUp, TrendingDown, Minus, Leaf } from 'lucide-react'
import { useI18n } from '../i18n.jsx'

/* ---- CO₂ bar colour ---- */
function co2Color(co2) {
  if (co2 == null) return 'var(--text-muted)'
  if (co2 < 2) return '#16a34a'
  if (co2 < 6) return '#65a30d'
  if (co2 < 15) return '#eab308'
  if (co2 < 40) return '#f97316'
  return '#ef4444'
}

function co2Label(co2, t) {
  if (co2 == null) return ''
  if (co2 < 2) return t('co2_very_low') || 'Very low'
  if (co2 < 6) return t('co2_low') || 'Low'
  if (co2 < 15) return t('co2_medium') || 'Medium'
  if (co2 < 40) return t('co2_high') || 'High'
  return t('co2_very_high') || 'Very high'
}

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

              {/* CO₂ Emissions */}
              {data.co2PerKg != null && (
                <div style={{
                  marginBottom: '1rem',
                  padding: '0.85rem',
                  background: 'var(--bg-hover, #334155)',
                  borderRadius: '10px'
                }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '0.4rem',
                    marginBottom: '0.5rem', color: 'var(--text-muted)', fontSize: '0.85rem'
                  }}>
                    <Leaf size={14} />
                    {t('modal_co2_title') || 'CO₂ Emissions'}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginBottom: '0.35rem' }}>
                    <span style={{
                      fontSize: '1.5rem', fontWeight: 700,
                      color: co2Color(data.co2PerKg)
                    }}>
                      {data.co2PerKg.toFixed(1)}
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                      kg CO₂ / kg
                    </span>
                    <span style={{
                      marginLeft: 'auto',
                      padding: '0.15rem 0.45rem', borderRadius: '6px',
                      fontSize: '0.75rem', fontWeight: 600,
                      background: `${co2Color(data.co2PerKg)}22`,
                      color: co2Color(data.co2PerKg)
                    }}>
                      {co2Label(data.co2PerKg, t)}
                    </span>
                  </div>

                  {/* Visual bar */}
                  {(() => {
                    // Map CO₂ to a 0-100 scale (log-ish: 0→0, 2→20, 6→40, 15→60, 40→80, 100→100)
                    const pct = Math.min(100, Math.max(2, Math.round(Math.log10(Math.max(0.1, data.co2PerKg)) * 50 + 50)))
                    return (
                      <div style={{
                        width: '100%', height: '6px', borderRadius: '3px',
                        background: 'var(--border, #4b5563)', overflow: 'hidden'
                      }}>
                        <div style={{
                          width: `${pct}%`, height: '100%', borderRadius: '3px',
                          background: co2Color(data.co2PerKg),
                          transition: 'width 0.4s ease'
                        }} />
                      </div>
                    )
                  })()}

                  {/* Category & range */}
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    marginTop: '0.4rem', fontSize: '0.78rem', color: 'var(--text-muted)'
                  }}>
                    {data.co2CategoryLabel && (
                      <span>{data.ratingEmoji} {data.co2CategoryLabel}</span>
                    )}
                    {data.co2Min != null && data.co2Max != null && (
                      <span>{t('modal_co2_range') || 'Range'}: {data.co2Min.toFixed(1)}–{data.co2Max.toFixed(1)} kg</span>
                    )}
                  </div>
                </div>
              )}

              {/* Enriched attribute tags */}
              {data.enriched && data.enriched.length > 0 && (
                <div style={{ marginBottom: '1rem' }}>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                    {t('modal_product_attributes')}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                    {data.enriched.map((e, i) => {
                      const hasDelta = e.delta != null && e.delta !== 0
                      const isPositive = e.delta > 0
                      const isNegative = e.delta < 0

                      // Colour based on delta, or neutral
                      const tagBg = isPositive ? 'rgba(34, 197, 94, 0.15)'
                        : isNegative ? 'rgba(239, 68, 68, 0.15)'
                        : 'var(--bg-hover, rgba(100, 116, 139, 0.2))'
                      const tagColor = isPositive ? '#22c55e'
                        : isNegative ? '#ef4444'
                        : 'var(--text)'
                      const tagBorder = isPositive ? 'rgba(34, 197, 94, 0.3)'
                        : isNegative ? 'rgba(239, 68, 68, 0.3)'
                        : 'var(--border, rgba(100, 116, 139, 0.3))'

                      return (
                        <span key={i} style={{
                          display: 'inline-flex', alignItems: 'center', gap: '0.25rem',
                          padding: '0.25rem 0.55rem',
                          borderRadius: '8px',
                          border: `1px solid ${tagBorder}`,
                          background: tagBg,
                          color: tagColor,
                          fontSize: '0.82rem',
                          fontWeight: 600,
                          lineHeight: 1.3
                        }}>
                          {e.icon && <span style={{ fontSize: '0.8rem' }}>{e.icon}</span>}
                          <span>{e.label}</span>
                          {hasDelta && (
                            <span style={{
                              fontSize: '0.72rem', fontWeight: 700,
                              opacity: 0.85
                            }}>
                              {isPositive ? '+' : ''}{e.delta}
                            </span>
                          )}
                        </span>
                      )
                    })}
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
