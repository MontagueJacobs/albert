import { useState, useEffect } from 'react'
import { Loader2, ChevronRight } from 'lucide-react'
import { useI18n } from '../i18n.jsx'

const QUESTIONS = [
  {
    id: 'sp_knowledge',
    text: 'How well do you think you know the CO₂ impact of different food products?',
    textNl: 'Hoe goed denkt u de CO₂-impact van verschillende voedselproducten te kennen?',
    low: 'Not at all', lowNl: 'Helemaal niet',
    high: 'Very well', highNl: 'Zeer goed'
  },
  {
    id: 'sp_confidence',
    text: 'How confident are you in ranking products by their environmental impact?',
    textNl: 'Hoe zeker bent u dat u producten kunt rangschikken op milieu-impact?',
    low: 'Not confident', lowNl: 'Niet zeker',
    high: 'Very confident', highNl: 'Zeer zeker'
  },
  {
    id: 'sp_awareness',
    text: 'How often do you consider CO₂ emissions when buying groceries?',
    textNl: 'Hoe vaak houdt u rekening met CO₂-uitstoot bij het kopen van boodschappen?',
    low: 'Never', lowNl: 'Nooit',
    high: 'Always', highNl: 'Altijd'
  },
  {
    id: 'sp_comparison',
    text: 'Compared to the average person, how well do you think you understand food sustainability?',
    textNl: 'Vergeleken met de gemiddelde persoon, hoe goed begrijpt u voedselduurzaamheid?',
    low: 'Much worse', lowNl: 'Veel slechter',
    high: 'Much better', highNl: 'Veel beter'
  }
]

const styles = {
  container: {
    maxWidth: '600px',
    margin: '0 auto'
  },
  header: {
    textAlign: 'center',
    marginBottom: '1.5rem'
  },
  title: {
    fontSize: '1.25rem',
    fontWeight: '700',
    color: 'var(--text, #f3f4f6)',
    marginBottom: '0.5rem'
  },
  subtitle: {
    color: 'var(--text-muted, #9ca3af)',
    fontSize: '0.9rem'
  },
  questionCard: {
    background: 'var(--bg-card, #1e293b)',
    borderRadius: '16px',
    padding: '1.25rem',
    marginBottom: '1rem',
    border: '1px solid var(--border, #334155)'
  },
  questionNum: {
    fontSize: '0.7rem',
    color: 'var(--text-muted, #9ca3af)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: '0.5rem'
  },
  questionText: {
    fontSize: '1rem',
    fontWeight: '600',
    color: 'var(--text, #f3f4f6)',
    marginBottom: '1rem',
    lineHeight: '1.4'
  },
  scaleContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem'
  },
  scaleRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '0.5rem'
  },
  scaleBtn: {
    flex: 1,
    padding: '0.75rem 0.5rem',
    background: 'var(--bg-secondary, #0f172a)',
    border: '2px solid var(--border, #334155)',
    borderRadius: '10px',
    cursor: 'pointer',
    textAlign: 'center',
    color: 'var(--text, #f3f4f6)',
    fontSize: '0.85rem',
    fontWeight: '600',
    transition: 'all 0.2s ease'
  },
  scaleBtnSelected: {
    borderColor: '#22c55e',
    background: 'rgba(34, 197, 94, 0.15)',
    color: '#22c55e'
  },
  anchors: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '0.7rem',
    color: 'var(--text-muted, #9ca3af)',
    marginTop: '0.25rem',
    paddingLeft: '0.25rem',
    paddingRight: '0.25rem'
  },
  submitBtn: {
    width: '100%',
    padding: '1rem 2rem',
    background: 'linear-gradient(135deg, #22c55e, #16a34a)',
    color: '#fff',
    border: 'none',
    borderRadius: '12px',
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    marginTop: '0.5rem'
  },
  submitBtnDisabled: {
    background: 'var(--bg-secondary, #334155)',
    cursor: 'not-allowed',
    opacity: 0.5
  },
  errorMsg: {
    background: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    borderRadius: '10px',
    padding: '0.75rem',
    marginBottom: '1rem',
    color: '#ef4444',
    fontSize: '0.85rem',
    textAlign: 'center'
  }
}

export default function ExperimentLikert({ sessionId, onComplete, questions: customQuestions, submitUrl, title: customTitle, subtitle: customSubtitle }) {
  const { lang } = useI18n()
  const isNl = lang === 'nl'

  const actualQuestions = customQuestions || QUESTIONS
  const endpoint = submitUrl || `/api/experiment/${sessionId}/self-perception`

  const [responses, setResponses] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const allAnswered = actualQuestions.every(q => responses[q.id] !== undefined)

  const handleSelect = (questionId, value) => {
    setResponses(prev => ({ ...prev, [questionId]: value }))
    setError(null)
  }

  const handleSubmit = async () => {
    if (!allAnswered) {
      setError(isNl ? 'Beantwoord alle vragen voordat je verdergaat.' : 'Please answer all questions before continuing.')
      return
    }

    try {
      setSubmitting(true)
      setError(null)
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responses })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onComplete(data.session)
    } catch (e) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>
          {customTitle || (isNl ? 'Hoe schat je jezelf in?' : 'How do you rate yourself?')}
        </h2>
        <p style={styles.subtitle}>
          {customSubtitle || (isNl 
            ? 'Beantwoord deze vragen over je eigen kennis en bewustzijn.'
            : 'Answer these questions about your own knowledge and awareness.')}
        </p>
      </div>

      {error && <div style={styles.errorMsg}>{error}</div>}

      {actualQuestions.map((q, idx) => (
        <div key={q.id} style={styles.questionCard}>
          <div style={styles.questionNum}>
            {isNl ? `Vraag ${idx + 1} van ${actualQuestions.length}` : `Question ${idx + 1} of ${actualQuestions.length}`}
          </div>
          <div style={styles.questionText}>
            {isNl ? (q.textNl || q.text_nl) : (q.text || q.text_en)}
          </div>
          <div style={styles.scaleContainer}>
            <div style={styles.scaleRow}>
              {[1, 2, 3, 4, 5].map(val => (
                <button
                  key={val}
                  style={{
                    ...styles.scaleBtn,
                    ...(responses[q.id] === val ? styles.scaleBtnSelected : {})
                  }}
                  onClick={() => handleSelect(q.id, val)}
                >
                  {val}
                </button>
              ))}
            </div>
            {(q.low || q.lowNl) && (
              <div style={styles.anchors}>
                <span>{isNl ? (q.lowNl || q.low) : (q.low || q.lowNl)}</span>
                <span>{isNl ? (q.highNl || q.high) : (q.high || q.highNl)}</span>
              </div>
            )}
            {!(q.low || q.lowNl) && (
              <div style={styles.anchors}>
                <span>{isNl ? 'Helemaal oneens' : 'Strongly disagree'}</span>
                <span>{isNl ? 'Helemaal eens' : 'Strongly agree'}</span>
              </div>
            )}
          </div>
        </div>
      ))}

      <button
        style={{
          ...styles.submitBtn,
          ...(!allAnswered || submitting ? styles.submitBtnDisabled : {})
        }}
        onClick={handleSubmit}
        disabled={!allAnswered || submitting}
      >
        {submitting ? (
          <>
            <Loader2 size={20} className="spin" />
            {isNl ? 'Verzenden...' : 'Submitting...'}
          </>
        ) : (
          <>
            {isNl ? 'Volgende' : 'Next'}
            <ChevronRight size={20} />
          </>
        )}
      </button>

      <p style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '0.75rem', fontSize: '0.8rem' }}>
        {Object.keys(responses).length} / {actualQuestions.length} {isNl ? 'beantwoord' : 'answered'}
      </p>
    </div>
  )
}
