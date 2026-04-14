import { useState } from 'react'
import { Loader2, ChevronRight } from 'lucide-react'
import { useI18n } from '../i18n.jsx'

const DEMOGRAPHICS_QUESTIONS = [
  {
    id: 'demo_age',
    text: 'What is your age?',
    textNl: 'Wat is uw leeftijd?',
    type: 'number',
    placeholder: 'e.g. 25',
    placeholderNl: 'bijv. 25',
    min: 16,
    max: 99
  },
  {
    id: 'demo_gender',
    text: 'What is your gender?',
    textNl: 'Wat is uw geslacht?',
    type: 'select',
    options: [
      { value: 'man', label: 'Man', labelNl: 'Man' },
      { value: 'woman', label: 'Woman', labelNl: 'Vrouw' },
      { value: 'non_binary', label: 'Non-binary', labelNl: 'Non-binair' },
      { value: 'prefer_not_to_say', label: 'Prefer not to say', labelNl: 'Zeg ik liever niet' }
    ]
  },
  {
    id: 'demo_occupation',
    text: 'What is your current occupation?',
    textNl: 'Wat is uw huidige beroep?',
    type: 'select',
    options: [
      { value: 'University_HBO', label: 'University (HBO)', labelNl: 'Universiteit (HBO)' },
      { value: 'University_WO', label: 'University (WO)', labelNl: 'Universiteit (WO)' },
      { value: 'Employed', label: 'Employed', labelNl: 'Werkzaam' },
      { value: 'Unemployed', label: 'Unemployed', labelNl: 'Werkloos' },
      { value: 'Other', label: 'Other', labelNl: 'Anders' },
    ]
  },
  {
    id: 'demo_diet',
    text: 'How would you describe your diet?',
    textNl: 'Hoe zou u uw voedingspatroon omschrijven?',
    type: 'select_with_other',
    options: [
      { value: 'omnivore', label: 'Omnivore (I eat everything)', labelNl: 'Omnivoor (ik eet alles)' },
      { value: 'flexitarian', label: 'Flexitarian (mostly plant-based)', labelNl: 'Flexitariër (voornamelijk plantaardig)' },
      { value: 'vegetarian', label: 'Vegetarian', labelNl: 'Vegetarisch' },
      { value: 'vegan', label: 'Vegan', labelNl: 'Veganistisch' },
      { value: 'other', label: 'Other', labelNl: 'Anders' }
    ]
  },
  {
    id: 'demo_shopping_frequency',
    text: 'How often do you go grocery shopping?',
    textNl: 'Hoe vaak doet u boodschappen?',
    type: 'select',
    options: [
      { value: 'daily', label: 'Daily', labelNl: 'Dagelijks' },
      { value: '2_3_per_week', label: '2-3 times per week', labelNl: '2-3 keer per week' },
      { value: 'weekly', label: 'Weekly', labelNl: 'Wekelijks' },
      { value: 'less_than_weekly', label: 'Less than weekly', labelNl: 'Minder dan wekelijks' }
    ]
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
  numberInput: {
    width: '120px',
    padding: '0.75rem',
    background: 'var(--bg-secondary, #0f172a)',
    border: '2px solid var(--border, #334155)',
    borderRadius: '12px',
    color: 'var(--text, #f3f4f6)',
    fontSize: '1rem',
    fontFamily: 'inherit',
    outline: 'none',
    transition: 'border-color 0.2s ease'
  },
  selectGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem'
  },
  selectOption: {
    padding: '0.75rem 1rem',
    border: '2px solid var(--border, #334155)',
    borderRadius: '12px',
    cursor: 'pointer',
    fontSize: '0.95rem',
    fontWeight: '500',
    color: 'var(--text, #f3f4f6)',
    background: 'var(--bg-secondary, #0f172a)',
    transition: 'all 0.2s ease',
    textAlign: 'left'
  },
  selectOptionSelected: {
    borderColor: '#22c55e',
    background: 'rgba(34, 197, 94, 0.12)',
    color: '#22c55e'
  },
  otherInput: {
    width: '100%',
    padding: '0.6rem 0.75rem',
    background: 'var(--bg-secondary, #0f172a)',
    border: '2px solid var(--border, #334155)',
    borderRadius: '10px',
    color: 'var(--text, #f3f4f6)',
    fontSize: '0.9rem',
    fontFamily: 'inherit',
    outline: 'none',
    marginTop: '0.5rem',
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

export default function ExperimentDemographics({ sessionId, onComplete }) {
  const { lang } = useI18n()
  const isNl = lang === 'nl'

  const [responses, setResponses] = useState({})
  const [otherTexts, setOtherTexts] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  // All questions are required
  const allAnswered = DEMOGRAPHICS_QUESTIONS.every(q => {
    const val = responses[q.id]
    if (val === undefined || val === '') return false
    // If "other" is selected for select_with_other, require text
    if (q.type === 'select_with_other' && val === 'other') {
      return otherTexts[q.id] && otherTexts[q.id].trim().length > 0
    }
    return true
  })

  const handleSelect = (questionId, value) => {
    setResponses(prev => ({ ...prev, [questionId]: value }))
    setError(null)
  }

  const handleNumber = (questionId, value) => {
    setResponses(prev => ({ ...prev, [questionId]: value }))
    setError(null)
  }

  const handleOtherText = (questionId, value) => {
    setOtherTexts(prev => ({ ...prev, [questionId]: value }))
  }

  const handleSubmit = async () => {
    if (!allAnswered) {
      setError(isNl ? 'Beantwoord alle vragen voordat je verdergaat.' : 'Please answer all questions before continuing.')
      return
    }

    // Build final responses, merging "other" text
    const finalResponses = {}
    for (const q of DEMOGRAPHICS_QUESTIONS) {
      if (q.type === 'select_with_other' && responses[q.id] === 'other') {
        finalResponses[q.id] = `other: ${otherTexts[q.id]}`
      } else {
        finalResponses[q.id] = responses[q.id]
      }
    }

    try {
      setSubmitting(true)
      setError(null)
      const res = await fetch(`/api/experiment/${sessionId}/demographics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responses: finalResponses })
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
          {isNl ? 'Over jou' : 'About you'}
        </h2>
        <p style={styles.subtitle}>
          {isNl 
            ? 'Een paar korte vragen om te beginnen. Alle antwoorden zijn anoniem.'
            : 'A few quick questions to get started. All answers are anonymous.'}
        </p>
      </div>

      {error && <div style={styles.errorMsg}>{error}</div>}

      {DEMOGRAPHICS_QUESTIONS.map((q, idx) => (
        <div key={q.id} style={styles.questionCard}>
          <div style={styles.questionNum}>
            {isNl ? `Vraag ${idx + 1} van ${DEMOGRAPHICS_QUESTIONS.length}` : `Question ${idx + 1} of ${DEMOGRAPHICS_QUESTIONS.length}`}
          </div>
          <div style={styles.questionText}>
            {isNl ? q.textNl : q.text}
          </div>

          {q.type === 'number' && (
            <input
              type="number"
              style={styles.numberInput}
              placeholder={isNl ? q.placeholderNl : q.placeholder}
              min={q.min}
              max={q.max}
              value={responses[q.id] || ''}
              onChange={(e) => handleNumber(q.id, e.target.value)}
              onFocus={(e) => { e.target.style.borderColor = '#3b82f6' }}
              onBlur={(e) => { e.target.style.borderColor = 'var(--border, #334155)' }}
            />
          )}

          {(q.type === 'select' || q.type === 'select_with_other') && (
            <div style={styles.selectGrid}>
              {q.options.map(opt => (
                <button
                  key={opt.value}
                  style={{
                    ...styles.selectOption,
                    ...(responses[q.id] === opt.value ? styles.selectOptionSelected : {})
                  }}
                  onClick={() => handleSelect(q.id, opt.value)}
                >
                  {isNl ? opt.labelNl : opt.label}
                </button>
              ))}
              {q.type === 'select_with_other' && responses[q.id] === 'other' && (
                <input
                  type="text"
                  style={styles.otherInput}
                  placeholder={isNl ? 'Specificeer...' : 'Please specify...'}
                  value={otherTexts[q.id] || ''}
                  onChange={(e) => handleOtherText(q.id, e.target.value)}
                  onFocus={(e) => { e.target.style.borderColor = '#3b82f6' }}
                  onBlur={(e) => { e.target.style.borderColor = 'var(--border, #334155)' }}
                />
              )}
            </div>
          )}
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
            {isNl ? 'Opslaan...' : 'Saving...'}
          </>
        ) : (
          <>
            {isNl ? 'Verder' : 'Continue'}
            <ChevronRight size={20} />
          </>
        )}
      </button>
    </div>
  )
}
