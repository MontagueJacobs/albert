import { useState, useEffect, useCallback } from 'react'
import { Search, Info, CheckCircle2, XCircle } from 'lucide-react'
import { useI18n } from '../i18n.jsx'

// Dark mode styles
const darkStyles = {
  description: { maxWidth: '640px', color: 'var(--text-muted, #9ca3af)', marginBottom: '1rem' },
  heading: { marginBottom: '0.5rem', color: 'var(--text, #f3f4f6)' },
  input: {
    width: '100%',
    padding: '0.65rem 0.75rem 0.65rem 2.5rem',
    borderRadius: '999px',
    border: '1px solid var(--border, #334155)',
    background: 'var(--bg-card, #1e293b)',
    color: 'var(--text, #f3f4f6)',
    fontSize: '1rem'
  },
  searchIcon: { position: 'absolute', top: '50%', left: '0.75rem', transform: 'translateY(-50%)', color: 'var(--text-muted, #9ca3af)' },
  error: { color: '#ef4444', marginTop: '0.75rem' },
  suggestionsLabel: { fontSize: '0.85rem', color: 'var(--text-muted, #9ca3af)', marginBottom: '0.35rem' },
  suggestionBtn: {
    padding: '0.45rem 0.75rem',
    borderRadius: '999px',
    border: '1px solid var(--border, #334155)',
    background: 'var(--bg-hover, #334155)',
    color: 'var(--text, #f3f4f6)',
    cursor: 'pointer'
  },
  resultCard: {
    marginTop: '1.5rem',
    border: '1px solid var(--border, #334155)',
    borderRadius: '12px',
    padding: '1rem',
    background: 'var(--bg-card, #1e293b)'
  },
  resultTitle: { margin: 0, color: 'var(--text, #f3f4f6)' },
  resultText: { color: 'var(--text-muted, #9ca3af)' },
  matchLabel: { marginTop: '0.35rem', fontSize: '0.85rem', color: 'var(--text-muted, #9ca3af)' },
  hint: { maxWidth: '320px', color: 'var(--text-muted, #9ca3af)', fontSize: '0.9rem' },
  sectionTitle: { marginBottom: '0.5rem', color: 'var(--text, #f3f4f6)' },
  list: { margin: 0, paddingLeft: '1.2rem', color: 'var(--text-muted, #9ca3af)' },
  emptyText: { color: 'var(--text-muted, #9ca3af)', fontSize: '0.9rem' }
}

function ScoreBadge({ score }) {
  const numeric = Number(score) || 0
  const cls = numeric >= 7 ? 'score-high' : numeric >= 5 ? 'score-medium' : 'score-low'
  return (
    <span className={`score-badge ${cls}`} aria-label={`score ${numeric}`}>{numeric}</span>
  )
}

function ScoreLookup() {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [suggestions, setSuggestions] = useState([])

  const handleChange = useCallback((event) => {
    setQuery(event.target.value)
  }, [])

  const fetchSuggestions = useCallback(async (value) => {
    const trimmed = value.trim()
    if (trimmed.length < 2) {
      setSuggestions([])
      return
    }
    try {
      const res = await fetch(`/api/score/search?query=${encodeURIComponent(trimmed)}`)
      if (!res.ok) throw new Error('search_failed')
      const json = await res.json()
      setSuggestions(json.results || [])
    } catch (err) {
      console.error('Score search failed', err)
    }
  }, [])

  useEffect(() => {
    fetchSuggestions(query)
  }, [query, fetchSuggestions])

  const performLookup = useCallback(async (value) => {
    const trimmed = value.trim()
    if (!trimmed) {
      setError(t('lookup_error_required'))
      setResult(null)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/score?product=${encodeURIComponent(trimmed)}`)
      if (!res.ok) {
        setResult(null)
        throw new Error('lookup_failed')
      }
      const json = await res.json()
      setResult(json)
    } catch (err) {
      console.error('Score lookup failed', err)
      setError(t('lookup_error_generic'))
    } finally {
      setLoading(false)
    }
  }, [t])

  const handleSubmit = useCallback((event) => {
    event.preventDefault()
    performLookup(query)
  }, [performLookup, query])

  const handleSuggestionClick = useCallback((name) => {
    setQuery(name)
    performLookup(name)
  }, [performLookup])

  const renderAdjustment = (adj) => {
    const label = t(`lookup_reasons.${adj.code}`)
    const delta = adj.delta > 0 ? `+${adj.delta}` : adj.delta
    return (
      <li key={`${adj.code}-${adj.resultingScore}`} style={{ marginBottom: '0.35rem' }}>
        <strong>{delta}</strong> · {label}
      </li>
    )
  }

  const renderCategory = (category) => {
    const label = t(`category_labels.${category.category}`)
    return (
      <li key={category.category}>
        <span style={{ marginRight: '0.35rem' }}>{category.icon || '•'}</span>
        {label}
      </li>
    )
  }

  const renderKeyword = (code) => {
    return (
      <li key={code}>{t(`lookup_reasons.${code}`)}</li>
    )
  }

  const hasCategories = result?.categories && result.categories.length > 0
  const hasKeywords = result?.keywords && result.keywords.length > 0

  return (
    <section style={{ marginTop: '1.5rem' }}>
      <h3 style={darkStyles.heading}>{t('lookup_title')}</h3>
      <p style={darkStyles.description}>{t('lookup_description')}</p>

      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <label htmlFor="score-lookup" style={{ display: 'none' }}>{t('lookup_input_label')}</label>
        <div style={{ position: 'relative', flex: '1 1 280px' }}>
          <Search size={18} style={darkStyles.searchIcon} />
          <input
            id="score-lookup"
            type="search"
            value={query}
            onChange={handleChange}
            placeholder={t('lookup_placeholder')}
            style={darkStyles.input}
          />
        </div>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={loading}
          style={{ minWidth: '150px' }}
        >
          {loading ? t('lookup_button_loading') : t('lookup_button')}
        </button>
      </form>

      {error && <div style={darkStyles.error}>{error}</div>}

      {suggestions.length > 0 && (
        <div style={{ marginTop: '0.75rem' }}>
          <div style={darkStyles.suggestionsLabel}>{t('lookup_suggestions_label')}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {suggestions.map((item) => (
              <button
                key={item.name}
                type="button"
                onClick={() => handleSuggestionClick(item.name)}
                style={darkStyles.suggestionBtn}
              >
                <span style={{ marginRight: '0.4rem' }}>{item.name}</span>
                <ScoreBadge score={item.score} />
              </button>
            ))}
          </div>
        </div>
      )}

      {result && !loading && (
        <div style={darkStyles.resultCard}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <h4 style={darkStyles.resultTitle}>{result.product}</h4>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.35rem' }}>
                <ScoreBadge score={result.score} />
                <span style={{ color: 'var(--text, #f3f4f6)' }}>{t('lookup_score_label')}</span>
              </div>
              <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', alignItems: 'center', color: 'var(--text-muted, #9ca3af)' }}>
                {result.score >= 7 ? <CheckCircle2 size={18} style={{ color: '#22c55e' }} /> : result.score <= 4 ? <XCircle size={18} style={{ color: '#ef4444' }} /> : <Info size={18} style={{ color: '#f59e0b' }} />}
                <span>{result.rating}</span>
              </div>
              {result.matched?.canonicalName && (
                <div style={darkStyles.matchLabel}>
                  <strong>{t('lookup_match_label')}</strong> {result.matched.canonicalName}
                </div>
              )}
            </div>
            <div style={darkStyles.hint}>
              <div>{t('lookup_hint_add')}</div>
            </div>
          </div>

          <div style={{ marginTop: '1.25rem' }}>
            <h5 style={darkStyles.sectionTitle}>{t('lookup_breakdown_title')}</h5>
            {result.adjustments && result.adjustments.length > 0 ? (
              <ul style={darkStyles.list}>
                {result.adjustments.map(renderAdjustment)}
              </ul>
            ) : (
              <div style={darkStyles.emptyText}>{t('lookup_no_adjustments')}</div>
            )}
          </div>

          {result.notes && (
            <div style={{ marginTop: '1.25rem', color: 'var(--text-muted, #9ca3af)' }}>
              <h5 style={{ marginBottom: '0.35rem', color: 'var(--text, #f3f4f6)' }}>{t('lookup_notes_title')}</h5>
              <p style={{ margin: 0 }}>{result.notes}</p>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginTop: '1.25rem' }}>
            <div>
              <h5 style={darkStyles.sectionTitle}>{t('lookup_categories_title')}</h5>
              {hasCategories ? (
                <ul style={darkStyles.list}>
                  {result.categories.map(renderCategory)}
                </ul>
              ) : (
                <div style={darkStyles.emptyText}>{t('lookup_categories_empty')}</div>
              )}
            </div>
            <div>
              <h5 style={darkStyles.sectionTitle}>{t('lookup_keywords_title')}</h5>
              {hasKeywords ? (
                <ul style={darkStyles.list}>
                  {result.keywords.map(renderKeyword)}
                </ul>
              ) : (
                <div style={darkStyles.emptyText}>{t('lookup_keywords_empty')}</div>
              )}
            </div>
            <div>
              <h5 style={darkStyles.sectionTitle}>{t('lookup_suggestions_title')}</h5>
              {result.suggestions && result.suggestions.length > 0 ? (
                <ul style={darkStyles.list}>
                  {result.suggestions.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              ) : (
                <div style={darkStyles.emptyText}>{t('lookup_suggestions_empty')}</div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export default ScoreLookup
