import { useState } from 'react'
import { Loader2, ChevronRight, ThumbsUp, ThumbsDown } from 'lucide-react'
import { useI18n } from '../i18n.jsx'

const QUESTIONS = [
  {
    id: 'ref_surprised',
    text: 'Were you surprised by any of the correct CO₂ rankings?',
    textNl: 'Was u verrast door een van de juiste CO₂-rangschikkingen?',
    type: 'yesno'
  },
  {
    id: 'ref_learned',
    text: 'Did you learn something new about the environmental impact of food?',
    textNl: 'Heeft u iets nieuws geleerd over de milieu-impact van voedsel?',
    type: 'yesno'
  },
  {
    id: 'ref_change_intent',
    text: 'Do you think this information will change how you shop for groceries?',
    textNl: 'Denkt u dat deze informatie zal veranderen hoe u boodschappen doet?',
    type: 'yesno'
  },
  {
    id: 'ref_most_surprising',
    text: 'What surprised you the most about the CO₂ impact of food products?',
    textNl: 'Wat verbaasde u het meest over de CO₂-impact van voedselproducten?',
    type: 'open'
  },
  {
    id: 'ref_feedback',
    text: 'Do you have any other thoughts or feedback about this experiment?',
    textNl: 'Heeft u nog andere gedachten of feedback over dit experiment?',
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
  yesNoRow: {
    display: 'flex',
    gap: '0.75rem'
  },
  yesNoBtn: {
    flex: 1,
    padding: '0.85rem',
    border: '2px solid var(--border, #334155)',
    borderRadius: '12px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    fontSize: '0.95rem',
    fontWeight: '600',
    color: 'var(--text, #f3f4f6)',
    background: 'var(--bg-secondary, #0f172a)',
    transition: 'all 0.2s ease'
  },
  yesSelected: {
    borderColor: '#22c55e',
    background: 'rgba(34, 197, 94, 0.15)',
    color: '#22c55e'
  },
  noSelected: {
    borderColor: '#ef4444',
    background: 'rgba(239, 68, 68, 0.1)',
    color: '#ef4444'
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
  },
  optionalBadge: {
    display: 'inline-block',
    padding: '0.1rem 0.4rem',
    borderRadius: '4px',
    fontSize: '0.65rem',
    background: 'rgba(148, 163, 184, 0.2)',
    color: '#94a3b8',
    marginLeft: '0.5rem',
    fontWeight: '400'
  }
}

export default function ExperimentReflection({ sessionId, onComplete }) {
  const { lang } = useI18n()
  const isNl = lang === 'nl'

  const [responses, setResponses] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  // Yes/no questions are required, open questions are optional
  const requiredQuestions = QUESTIONS.filter(q => q.type === 'yesno')
  const allRequiredAnswered = requiredQuestions.every(q => responses[q.id] !== undefined)

  const handleYesNo = (questionId, value) => {
    setResponses(prev => ({ ...prev, [questionId]: value }))
    setError(null)
  }

  const handleTextChange = (questionId, value) => {
    setResponses(prev => ({ ...prev, [questionId]: value }))
  }

  const handleSubmit = async () => {
    if (!allRequiredAnswered) {
      setError(isNl ? 'Beantwoord alle ja/nee vragen.' : 'Please answer all yes/no questions.')
      return
    }

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
            ? 'Deel je ervaring met het experiment.'
            : 'Share your experience with the experiment.'}
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
            {q.type === 'open' && (
              <span style={styles.optionalBadge}>
                {isNl ? 'Optioneel' : 'Optional'}
              </span>
            )}
          </div>

          {q.type === 'yesno' && (
            <div style={styles.yesNoRow}>
              <button
                style={{
                  ...styles.yesNoBtn,
                  ...(responses[q.id] === true ? styles.yesSelected : {})
                }}
                onClick={() => handleYesNo(q.id, true)}
              >
                <ThumbsUp size={18} />
                {isNl ? 'Ja' : 'Yes'}
              </button>
              <button
                style={{
                  ...styles.yesNoBtn,
                  ...(responses[q.id] === false ? styles.noSelected : {})
                }}
                onClick={() => handleYesNo(q.id, false)}
              >
                <ThumbsDown size={18} />
                {isNl ? 'Nee' : 'No'}
              </button>
            </div>
          )}

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
          ...(!allRequiredAnswered || submitting ? styles.submitBtnDisabled : {})
        }}
        onClick={handleSubmit}
        disabled={!allRequiredAnswered || submitting}
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
