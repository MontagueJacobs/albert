import { useState } from 'react'
import { Loader2, ChevronRight } from 'lucide-react'
import { useI18n } from '../i18n.jsx'

const QUESTIONS = [
  {
    id: 'ref_reflection',
    text: 'What did you learn from this study?',
    textNl: 'Wat heeft u geleerd van dit onderzoek?',
    type: 'open'
  },
  {
    id: 'ref_surprise',
    text: 'Did any of the results about your purchases surprise you? If yes, how?',
    textNl: 'Hebben de resultaten over uw aankopen u verrast? Zo ja, hoe?',
    type: 'open'
  },
  {
    id: 'ref_system_feedback',
    text: 'What did you like or dislike about the ranking system?',
    textNl: 'Wat vond u goed of minder goed aan het rangschikkingssysteem?',
    type: 'open'
  },
  {
    id: 'ref_trust_comparison',
    text: 'How does this system compare to eco-labels you have seen before?',
    textNl: 'Hoe verhoudt dit systeem zich tot keurmerken die u eerder heeft gezien?',
    type: 'open'
  },
  {
    id: 'ref_improvement',
    text: 'What would you improve about this tool?',
    textNl: 'Wat zou u verbeteren aan deze tool?',
    type: 'open'
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
  textarea: {
    width: '100%',
    minHeight: '80px',
    padding: '0.75rem',
    background: 'var(--bg-secondary, #0f172a)',
    border: '2px solid var(--border, #334155)',
    borderRadius: '12px',
    color: 'var(--text, #f3f4f6)',
    fontSize: '0.9rem',
    fontFamily: 'inherit',
    resize: 'vertical',
    outline: 'none',
    transition: 'border-color 0.2s ease'
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

export default function ExperimentReflection({ sessionId, onComplete }) {
  const { lang } = useI18n()
  const isNl = lang === 'nl'

  const [responses, setResponses] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const handleTextChange = (questionId, value) => {
    setResponses(prev => ({ ...prev, [questionId]: value }))
  }

  const handleSubmit = async () => {

    try {
      setSubmitting(true)
      setError(null)
      const res = await fetch(`/api/experiment/${sessionId}/reflection`, {
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
          {isNl ? 'Even reflecteren...' : 'Time to reflect...'}
        </h2>
        <p style={styles.subtitle}>
          {isNl 
            ? 'Deel je ervaring met het experiment. (Optioneel)'
            : 'Share your experience with the experiment. (Optional)'}
        </p>
      </div>

      {error && <div style={styles.errorMsg}>{error}</div>}

      {QUESTIONS.map((q, idx) => (
        <div key={q.id} style={styles.questionCard}>
          <div style={styles.questionNum}>
            {isNl ? `Vraag ${idx + 1} van ${QUESTIONS.length}` : `Question ${idx + 1} of ${QUESTIONS.length}`}
          </div>
          <div style={styles.questionText}>
            {isNl ? q.textNl : q.text}
          </div>

          {q.type === 'open' && (
            <textarea
              style={styles.textarea}
              placeholder={isNl ? 'Typ hier...' : 'Type here...'}
              value={responses[q.id] || ''}
              onChange={(e) => handleTextChange(q.id, e.target.value)}
              onFocus={(e) => { e.target.style.borderColor = '#3b82f6' }}
              onBlur={(e) => { e.target.style.borderColor = 'var(--border, #334155)' }}
            />
          )}
        </div>
      ))}

      <button
        style={{
          ...styles.submitBtn,
          ...(submitting ? styles.submitBtnDisabled : {})
        }}
        onClick={handleSubmit}
        disabled={submitting}
      >
        {submitting ? (
          <>
            <Loader2 size={20} className="spin" />
            {isNl ? 'Afronden...' : 'Finishing...'}
          </>
        ) : (
          <>
            {isNl ? 'Experiment Afronden' : 'Complete Experiment'}
            <ChevronRight size={20} />
          </>
        )}
      </button>
    </div>
  )
}
