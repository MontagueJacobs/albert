import { useState, useEffect } from 'react'
import { LogIn } from 'lucide-react'
import { useI18n } from '../i18n.jsx'
import { useAHUser, useAHFetch } from '../lib/ahUserContext'
import ScoreBreakdownModal from './ScoreBreakdownModal'

// Dark mode styles
const styles = {
  skeletonCard: {
    padding: '0.5rem',
    borderRadius: '8px',
    background: 'var(--bg-hover, #334155)',
    minHeight: '56px'
  },
  panel: {
    padding: '1rem',
    background: 'var(--bg-card, #1e293b)',
    borderRadius: '12px',
    border: '1px solid var(--border, #334155)'
  },
  statLabel: {
    fontSize: '0.85rem',
    color: 'var(--text-muted, #9ca3af)'
  },
  suggestionCard: {
    display: 'block',
    padding: '0.75rem',
    borderRadius: '10px',
    border: '1px solid var(--border, #334155)',
    background: 'var(--bg-hover, #334155)',
    textDecoration: 'none',
    color: 'var(--text, #f3f4f6)',
    transition: 'transform 0.2s, box-shadow 0.2s'
  },
  suggestionName: {
    fontWeight: 600,
    color: 'var(--text, #f3f4f6)'
  },
  suggestionCategory: {
    fontSize: '0.9rem',
    color: 'var(--text-muted, #9ca3af)',
    marginTop: '0.25rem'
  },
  heading: {
    color: 'var(--text, #f3f4f6)',
    margin: 0
  },
  subHeading: {
    marginTop: '1rem',
    color: 'var(--text, #f3f4f6)'
  },
  error: {
    color: '#ef4444'
  }
}

function ProfileSuggestions({ refreshKey = 0 }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedProduct, setSelectedProduct] = useState(null)
  const { t } = useI18n()
  const { ahEmail } = useAHUser()
  const ahFetch = useAHFetch()

  function ScoreBadge({ score }) {
    const cls = score >= 7 ? 'score-high' : score >= 5 ? 'score-medium' : 'score-low'
    return <span className={`score-badge ${cls}`} aria-label={`score ${score}`}>{score}</span>
  }

  function SkeletonGrid() {
    return (
      <div className="skeleton-grid" style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem'}}>
        {[0,1,2,3].map(i => (
          <div key={i} className="skeleton-card" style={styles.skeletonCard} />
        ))}
      </div>
    )
  }

  // If not connected, show message
  if (!ahEmail) {
    return (
      <div style={{textAlign: 'center', padding: '3rem 1rem'}}>
        <LogIn size={48} style={{color: 'var(--text-muted)', marginBottom: '1rem'}} />
        <h3 style={{color: 'var(--text)', marginBottom: '0.5rem'}}>{t('login_required') || 'Connection Required'}</h3>
        <p style={{color: 'var(--text-muted)', marginBottom: '1.5rem'}}>
          {t('login_to_view_suggestions') || 'Connect your AH account to see personalized suggestions based on your purchases.'}
        </p>
      </div>
    )
  }
  useEffect(() => {
    let cancelled = false

    async function fetchData() {
      if (!ahEmail) return
      
      setLoading(true)
      setError(null)
      try {
        const res = await ahFetch('/api/user/suggestions')
        if (!res.ok) throw new Error('Failed to load profile suggestions')
        const json = await res.json()
        if (!cancelled) {
          setData(json)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message)
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    fetchData()
    return () => {
      cancelled = true
    }
  }, [refreshKey, ahEmail, ahFetch])

  if (loading) return <div style={{marginTop: '1rem'}}><SkeletonGrid /></div>
  if (error) return <div style={styles.error}>{t('error')} {error}</div>
  if (!data) return null

  const { profile, replacements, suggestions } = data

  // Show friendly message if user has no purchases yet
  if (!profile || profile.total_products === 0) {
    return (
      <section aria-labelledby="profile-heading" style={{marginTop: '1.5rem'}}>
        <h3 id="profile-heading" style={styles.heading}>{t('profile_title')}</h3>
        <div style={{...styles.panel, textAlign: 'center', padding: '2rem'}}>
          <p style={{color: 'var(--text)', fontSize: '1.1rem', marginBottom: '0.5rem'}}>
            {t('no_purchases_yet') || 'No purchases yet'}
          </p>
          <p style={{color: 'var(--text-muted)'}}>
            {t('sync_to_get_suggestions') || 'Sync your Albert Heijn account or add purchases to get personalized suggestions.'}
          </p>
        </div>
      </section>
    )
  }

  const profileInfo = profile.profile_info || {}
  const scoreDistribution = profile.score_distribution || { low: 0, medium: 0, high: 0 }
  const totalScored = scoreDistribution.low + scoreDistribution.medium + scoreDistribution.high

  return (
    <section aria-labelledby="profile-heading" style={{marginTop: '1.5rem'}}>
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem'}}>
        <h3 id="profile-heading" style={styles.heading}>{t('profile_title')}</h3>
      </div>

      {/* Profile Type Card */}
      <div className="profile-panel" style={{...styles.panel, marginBottom: '1rem'}}>
        <div style={{fontSize: '1.3rem', fontWeight: 600, color: 'var(--text)', marginBottom: '0.5rem'}}>
          {profileInfo.label || '⚖️ Balanced Shopper'}
        </div>
        <p style={{color: 'var(--text-muted)', marginBottom: '1rem'}}>
          {profileInfo.description || 'You have a varied diet with room for sustainable swaps.'}
        </p>
        
        {/* Stats row */}
        <div style={{display: 'flex', gap: '2rem', flexWrap: 'wrap', marginBottom: '1rem'}}>
          <div><strong style={{color: 'var(--text)', fontSize: '1.5rem'}}>{profile.total_products}</strong><div style={styles.statLabel}>{t('total_products') || 'Products'}</div></div>
          <div><strong style={{color: 'var(--text)', fontSize: '1.5rem'}}>{profile.avg_sustainability_score?.toFixed(1) || '5.0'}</strong><div style={styles.statLabel}>{t('avg_score') || 'Avg Score'}</div></div>
        </div>

        {/* Score distribution bar */}
        {totalScored > 0 && (
          <div style={{marginBottom: '1rem'}}>
            <div style={{fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.5rem'}}>Score Distribution</div>
            <div style={{display: 'flex', height: '8px', borderRadius: '4px', overflow: 'hidden', background: 'var(--bg-hover)'}}>
              <div style={{width: `${(scoreDistribution.low/totalScored)*100}%`, background: '#ef4444'}} title={`Low: ${scoreDistribution.low}`}></div>
              <div style={{width: `${(scoreDistribution.medium/totalScored)*100}%`, background: '#f59e0b'}} title={`Medium: ${scoreDistribution.medium}`}></div>
              <div style={{width: `${(scoreDistribution.high/totalScored)*100}%`, background: '#22c55e'}} title={`High: ${scoreDistribution.high}`}></div>
            </div>
            <div style={{display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem'}}>
              <span>🔴 {scoreDistribution.low} low</span>
              <span>🟡 {scoreDistribution.medium} medium</span>
              <span>🟢 {scoreDistribution.high} high</span>
            </div>
          </div>
        )}

        {/* Tips */}
        {profileInfo.tips && profileInfo.tips.length > 0 && (
          <div style={{background: 'var(--bg-hover)', padding: '0.75rem', borderRadius: '8px'}}>
            <div style={{fontSize: '0.85rem', fontWeight: 600, color: 'var(--text)', marginBottom: '0.5rem'}}>💡 Tips for you</div>
            <ul style={{margin: 0, paddingLeft: '1.25rem', color: 'var(--text-muted)', fontSize: '0.9rem'}}>
              {profileInfo.tips.map((tip, i) => <li key={i}>{tip}</li>)}
            </ul>
          </div>
        )}
      </div>

      {/* Replacement Suggestions */}
      {replacements && replacements.length > 0 && (
        <div className="profile-panel" style={{...styles.panel, marginBottom: '1rem'}}>
          <h4 style={{...styles.heading, marginBottom: '0.75rem'}}>🔄 {t('swap_suggestions') || 'Swap Suggestions'}</h4>
          <div style={{display: 'flex', flexDirection: 'column', gap: '0.75rem'}}>
            {replacements.map((r, idx) => (
              <div key={idx} style={{background: 'var(--bg-hover)', borderRadius: '10px', padding: '0.75rem'}}>
                <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap'}}>
                  <button 
                    onClick={() => setSelectedProduct({ name: r.original.name, score: r.original.score })}
                    style={{display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'none', border: 'none', cursor: 'pointer', padding: 0}}
                  >
                    <span style={{color: 'var(--text-muted)'}}>{r.original.name}</span>
                    <ScoreBadge score={r.original.score} />
                  </button>
                  <span style={{color: 'var(--text-muted)'}}>→</span>
                  <button 
                    onClick={() => setSelectedProduct({ name: r.replacement.name, url: r.replacement.url, image_url: r.replacement.image_url, score: r.replacement.score })}
                    style={{display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'none'}}
                  >
                    <span style={{color: 'var(--text)', fontWeight: 600}}>{r.replacement.name}</span>
                    <ScoreBadge score={r.replacement.score} />
                  </button>
                </div>
                <div style={{fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.25rem'}}>{r.reason}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* High-score suggestions */}
      <div className="profile-panel" style={styles.panel}>
        <h4 style={{...styles.heading, marginBottom: '0.5rem'}}>{t('top_suggestions') || '✨ Top Sustainable Products'}</h4>
        <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem', marginTop: '0.5rem'}}>
          {suggestions && suggestions.length > 0 ? suggestions.map((s, idx) => (
            <button 
              key={idx} 
              onClick={() => setSelectedProduct({ name: s.name, url: s.url, image_url: s.image_url, score: s.sustainability_score })}
              className="suggestion-card" 
              style={{...styles.suggestionCard, cursor: 'pointer', textAlign: 'left', width: '100%'}}
            >
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                <div style={styles.suggestionName}>{s.name}</div>
                <ScoreBadge score={s.sustainability_score} />
              </div>
            </button>
          )) : <div style={{padding:'1rem', color: 'var(--text-muted, #9ca3af)'}}>{t('no_suggestions') || 'No suggestions available'}</div>}
        </div>
      </div>

      {/* Score breakdown modal */}
      {selectedProduct && (
        <ScoreBreakdownModal 
          product={selectedProduct} 
          onClose={() => setSelectedProduct(null)} 
        />
      )}
    </section>
  )
}

export default ProfileSuggestions
