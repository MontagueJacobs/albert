import { useState, useEffect } from 'react'
import { useI18n } from '../i18n.jsx'

function ProfileSuggestions({ refreshKey = 0 }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const { t } = useI18n()

  function ScoreBadge({ score }) {
    const cls = score >= 7 ? 'score-high' : score >= 5 ? 'score-medium' : 'score-low'
    return <span className={`score-badge ${cls}`} aria-label={`score ${score}`}>{score}</span>
  }

  function SkeletonGrid() {
    return (
      <div className="skeleton-grid" style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem'}}>
        {[0,1,2,3].map(i => (
          <div key={i} className="skeleton-card" style={{padding: '0.5rem', borderRadius: '8px', background: '#fafafa', minHeight: '56px'}} />
        ))}
      </div>
    )
  }
  useEffect(() => {
    let cancelled = false

    async function fetchData() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch('/api/profile_suggestions')
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
  }, [refreshKey])

  if (loading) return <div style={{marginTop: '1rem'}}><SkeletonGrid /></div>
  if (error) return <div style={{color: 'red'}}>{t('error')} {error}</div>
  if (!data) return null

  const { profile, suggestions } = data

  return (
    <section aria-labelledby="profile-heading" style={{marginTop: '1.5rem'}}>
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem'}}>
        <h3 id="profile-heading" style={{margin: 0}}>{t('profile_title')}</h3>
      </div>

      <div className="profile-panel" style={{padding: '1rem', background: '#fff', borderRadius: '12px', border: '1px solid #e6e6e6'}}>
        <div style={{display: 'flex', gap: '2rem', flexWrap: 'wrap'}}>
          <div><strong>{profile.total_products}</strong><div style={{fontSize:'0.85rem', color:'#666'}}>{t('total_products')}</div></div>
          <div><strong>{profile.avg_sustainability_score.toFixed(1)}</strong><div style={{fontSize:'0.85rem', color:'#666'}}>{t('avg_score')}</div></div>
        </div>

        <h4 style={{marginTop: '1rem'}}>{t('top_suggestions')}</h4>
        <div style={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem', marginTop: '0.5rem'}}>
          {suggestions && suggestions.length > 0 ? suggestions.map((s, idx) => (
            <a key={idx} href={s.url} target="_blank" rel="noreferrer" className="suggestion-card" style={{display:'block', padding:'0.75rem', borderRadius:'10px', border:'1px solid #eee', textDecoration:'none', color:'inherit'}}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                <div style={{fontWeight:600}}>{s.name}</div>
                <ScoreBadge score={s.sustainability_score} />
              </div>
              <div style={{fontSize:'0.9rem', color:'#666', marginTop: '0.25rem'}}>{s.category}</div>
            </a>
          )) : <div style={{padding:'1rem'}}>{t('no_suggestions')}</div>}
        </div>
      </div>
    </section>
  )
}

export default ProfileSuggestions
