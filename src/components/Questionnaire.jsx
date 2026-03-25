import { useState, useEffect } from 'react'
import { Loader2, ChevronRight, CheckCircle, AlertCircle } from 'lucide-react'
import { useI18n } from '../i18n.jsx'
import { useBonusCard } from '../lib/bonusCardContext.jsx'
import CarbonRankingGame from './CarbonRankingGame.jsx'

// Dummy questions for the questionnaire
// These can be easily replaced with real questions later
const PRE_QUESTIONS = [
  {
    id: 'awareness',
    text: 'How aware are you of the environmental impact of your food choices?',
    textNl: 'Hoe bewust bent u van de milieu-impact van uw voedselkeuzes?',
    type: 'scale',
    options: [
      { value: 1, label: 'Not at all aware', labelNl: 'Helemaal niet bewust' },
      { value: 2, label: 'Slightly aware', labelNl: 'Een beetje bewust' },
      { value: 3, label: 'Moderately aware', labelNl: 'Redelijk bewust' },
      { value: 4, label: 'Very aware', labelNl: 'Zeer bewust' },
      { value: 5, label: 'Extremely aware', labelNl: 'Extreem bewust' }
    ]
  },
  {
    id: 'importance',
    text: 'How important is sustainability when you shop for groceries?',
    textNl: 'Hoe belangrijk is duurzaamheid wanneer u boodschappen doet?',
    type: 'scale',
    options: [
      { value: 1, label: 'Not important', labelNl: 'Niet belangrijk' },
      { value: 2, label: 'Slightly important', labelNl: 'Een beetje belangrijk' },
      { value: 3, label: 'Moderately important', labelNl: 'Redelijk belangrijk' },
      { value: 4, label: 'Very important', labelNl: 'Zeer belangrijk' },
      { value: 5, label: 'Extremely important', labelNl: 'Extreem belangrijk' }
    ]
  },
  {
    id: 'current_habits',
    text: 'How often do you currently choose sustainable products?',
    textNl: 'Hoe vaak kiest u momenteel voor duurzame producten?',
    type: 'scale',
    options: [
      { value: 1, label: 'Never', labelNl: 'Nooit' },
      { value: 2, label: 'Rarely', labelNl: 'Zelden' },
      { value: 3, label: 'Sometimes', labelNl: 'Soms' },
      { value: 4, label: 'Often', labelNl: 'Vaak' },
      { value: 5, label: 'Always', labelNl: 'Altijd' }
    ]
  },
  {
    id: 'knowledge',
    text: 'How knowledgeable do you feel about sustainable food choices?',
    textNl: 'Hoe goed kent u duurzame voedselkeuzes?',
    type: 'scale',
    options: [
      { value: 1, label: 'Not knowledgeable', labelNl: 'Geen kennis' },
      { value: 2, label: 'Slightly knowledgeable', labelNl: 'Weinig kennis' },
      { value: 3, label: 'Moderately knowledgeable', labelNl: 'Redelijke kennis' },
      { value: 4, label: 'Very knowledgeable', labelNl: 'Veel kennis' },
      { value: 5, label: 'Expert', labelNl: 'Expert' }
    ]
  }
]

const POST_QUESTIONS = [
  {
    id: 'dashboard_clarity',
    text: 'How clear was the sustainability information presented in the dashboard?',
    textNl: 'Hoe duidelijk was de duurzaamheidsinformatie in het dashboard?',
    type: 'scale',
    options: [
      { value: 1, label: 'Not clear at all', labelNl: 'Helemaal niet duidelijk' },
      { value: 2, label: 'Slightly clear', labelNl: 'Een beetje duidelijk' },
      { value: 3, label: 'Moderately clear', labelNl: 'Redelijk duidelijk' },
      { value: 4, label: 'Very clear', labelNl: 'Zeer duidelijk' },
      { value: 5, label: 'Extremely clear', labelNl: 'Extreem duidelijk' }
    ]
  },
  {
    id: 'learned_something',
    text: 'Did you learn something new about the sustainability of your purchases?',
    textNl: 'Heeft u iets nieuws geleerd over de duurzaamheid van uw aankopen?',
    type: 'scale',
    options: [
      { value: 1, label: 'Nothing new', labelNl: 'Niets nieuws' },
      { value: 2, label: 'A little', labelNl: 'Een beetje' },
      { value: 3, label: 'Some things', labelNl: 'Sommige dingen' },
      { value: 4, label: 'Quite a lot', labelNl: 'Best veel' },
      { value: 5, label: 'A lot', labelNl: 'Veel' }
    ]
  },
  {
    id: 'intent_to_change',
    text: 'How likely are you to change your shopping habits based on this information?',
    textNl: 'Hoe waarschijnlijk is het dat u uw winkelgedrag aanpast op basis van deze informatie?',
    type: 'scale',
    options: [
      { value: 1, label: 'Very unlikely', labelNl: 'Zeer onwaarschijnlijk' },
      { value: 2, label: 'Unlikely', labelNl: 'Onwaarschijnlijk' },
      { value: 3, label: 'Neutral', labelNl: 'Neutraal' },
      { value: 4, label: 'Likely', labelNl: 'Waarschijnlijk' },
      { value: 5, label: 'Very likely', labelNl: 'Zeer waarschijnlijk' }
    ]
  },
  {
    id: 'usefulness',
    text: 'How useful did you find this sustainability dashboard?',
    textNl: 'Hoe nuttig vond u dit duurzaamheidsdashboard?',
    type: 'scale',
    options: [
      { value: 1, label: 'Not useful', labelNl: 'Niet nuttig' },
      { value: 2, label: 'Slightly useful', labelNl: 'Een beetje nuttig' },
      { value: 3, label: 'Moderately useful', labelNl: 'Redelijk nuttig' },
      { value: 4, label: 'Very useful', labelNl: 'Zeer nuttig' },
      { value: 5, label: 'Extremely useful', labelNl: 'Extreem nuttig' }
    ]
  },
  {
    id: 'recommend',
    text: 'Would you recommend this tool to friends or family?',
    textNl: 'Zou u deze tool aanbevelen aan vrienden of familie?',
    type: 'scale',
    options: [
      { value: 1, label: 'Definitely not', labelNl: 'Zeker niet' },
      { value: 2, label: 'Probably not', labelNl: 'Waarschijnlijk niet' },
      { value: 3, label: 'Maybe', labelNl: 'Misschien' },
      { value: 4, label: 'Probably yes', labelNl: 'Waarschijnlijk wel' },
      { value: 5, label: 'Definitely yes', labelNl: 'Zeker wel' }
    ]
  }
]

const styles = {
  container: {
    maxWidth: '600px',
    margin: '0 auto',
    padding: '1rem'
  },
  header: {
    textAlign: 'center',
    marginBottom: '2rem'
  },
  title: {
    fontSize: '1.75rem',
    fontWeight: '700',
    color: 'var(--text, #f3f4f6)',
    marginBottom: '0.5rem'
  },
  subtitle: {
    color: 'var(--text-muted, #9ca3af)',
    fontSize: '1rem'
  },
  progressBar: {
    background: 'var(--bg-secondary, #334155)',
    borderRadius: '9999px',
    height: '8px',
    marginBottom: '2rem',
    overflow: 'hidden'
  },
  progressFill: {
    background: 'linear-gradient(90deg, #22c55e, #3b82f6)',
    height: '100%',
    transition: 'width 0.3s ease'
  },
  questionCard: {
    background: 'var(--bg-card, #1e293b)',
    borderRadius: '16px',
    padding: '1.5rem',
    marginBottom: '1.5rem',
    border: '1px solid var(--border, #334155)'
  },
  questionNumber: {
    fontSize: '0.75rem',
    color: 'var(--text-muted, #9ca3af)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    marginBottom: '0.5rem'
  },
  questionText: {
    fontSize: '1.125rem',
    fontWeight: '600',
    color: 'var(--text, #f3f4f6)',
    marginBottom: '1.25rem',
    lineHeight: '1.4'
  },
  optionsGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem'
  },
  optionButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '1rem',
    background: 'var(--bg-secondary, #0f172a)',
    border: '2px solid var(--border, #334155)',
    borderRadius: '12px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    textAlign: 'left',
    color: 'var(--text, #f3f4f6)'
  },
  optionButtonSelected: {
    borderColor: '#22c55e',
    background: 'rgba(34, 197, 94, 0.1)'
  },
  optionNumber: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    background: 'var(--bg-card, #1e293b)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: '600',
    fontSize: '0.875rem',
    color: 'var(--text-muted, #9ca3af)',
    flexShrink: 0
  },
  optionNumberSelected: {
    background: '#22c55e',
    color: '#fff'
  },
  optionLabel: {
    flex: 1,
    fontSize: '0.95rem'
  },
  buttonRow: {
    display: 'flex',
    justifyContent: 'space-between',
    gap: '1rem',
    marginTop: '1.5rem'
  },
  submitButton: {
    flex: 1,
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
    transition: 'transform 0.2s, box-shadow 0.2s'
  },
  submitButtonDisabled: {
    background: 'var(--bg-secondary, #334155)',
    cursor: 'not-allowed',
    opacity: 0.6
  },
  successContainer: {
    textAlign: 'center',
    padding: '3rem 1rem'
  },
  successIcon: {
    width: '80px',
    height: '80px',
    borderRadius: '50%',
    background: 'rgba(34, 197, 94, 0.2)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 1.5rem'
  },
  successTitle: {
    fontSize: '1.5rem',
    fontWeight: '700',
    color: 'var(--text, #f3f4f6)',
    marginBottom: '0.75rem'
  },
  successMessage: {
    color: 'var(--text-muted, #9ca3af)',
    marginBottom: '2rem'
  },
  continueButton: {
    padding: '1rem 3rem',
    background: 'linear-gradient(135deg, #3b82f6, #667eea)',
    color: '#fff',
    border: 'none',
    borderRadius: '12px',
    fontSize: '1rem',
    fontWeight: '600',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.5rem'
  },
  errorMessage: {
    background: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    borderRadius: '12px',
    padding: '1rem',
    marginBottom: '1rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    color: '#ef4444'
  }
}

function Questionnaire({ type = 'pre', onComplete, onSkip }) {
  const { lang } = useI18n()
  const { bonusCardNumber } = useBonusCard()
  const isNl = lang === 'nl'
  
  // Carbon ranking game - completely different UI
  if (type === 'carbon_ranking') {
    return (
      <CarbonRankingGame 
        onComplete={onComplete}
        onBack={onSkip}
      />
    )
  }
  
  const questions = type === 'pre' ? PRE_QUESTIONS : POST_QUESTIONS
  
  const [responses, setResponses] = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState(null)
  
  // Check if all questions are answered
  const allAnswered = questions.every(q => responses[q.id] !== undefined)
  const answeredCount = Object.keys(responses).length
  const progress = (answeredCount / questions.length) * 100
  
  const handleOptionSelect = (questionId, value) => {
    setResponses(prev => ({
      ...prev,
      [questionId]: value
    }))
    setError(null)
  }
  
  const handleSubmit = async () => {
    if (!allAnswered) {
      setError(isNl ? 'Beantwoord alle vragen voordat u verdergaat.' : 'Please answer all questions before continuing.')
      return
    }
    
    if (!bonusCardNumber) {
      setError(isNl ? 'Geen bonuskaart gevonden.' : 'No bonus card found.')
      return
    }
    
    setSubmitting(true)
    setError(null)
    
    try {
      const res = await fetch('/api/questionnaire/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bonus_card: bonusCardNumber,
          questionnaire_type: type,
          responses
        })
      })
      
      const data = await res.json()
      
      if (!res.ok) {
        throw new Error(data.error || 'Submission failed')
      }
      
      setSubmitted(true)
      
      // Auto-continue after showing success
      setTimeout(() => {
        if (onComplete) onComplete(responses)
      }, 2000)
      
    } catch (err) {
      console.error('Questionnaire submission error:', err)
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }
  
  // Success state
  if (submitted) {
    return (
      <div style={styles.container}>
        <div style={styles.successContainer}>
          <div style={styles.successIcon}>
            <CheckCircle size={40} color="#22c55e" />
          </div>
          <h2 style={styles.successTitle}>
            {isNl ? 'Bedankt!' : 'Thank you!'}
          </h2>
          <p style={styles.successMessage}>
            {isNl 
              ? 'Uw antwoorden zijn opgeslagen. U wordt nu doorgestuurd...'
              : 'Your responses have been saved. Redirecting now...'}
          </p>
          <Loader2 size={24} className="spin" style={{ color: 'var(--primary)' }} />
        </div>
      </div>
    )
  }
  
  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h1 style={styles.title}>
          {type === 'pre' 
            ? (isNl ? '📋 Korte Vragenlijst' : '📋 Quick Survey')
            : (isNl ? '📊 Afsluitende Vragenlijst' : '📊 Final Survey')}
        </h1>
        <p style={styles.subtitle}>
          {type === 'pre'
            ? (isNl ? 'Help ons uw voorkeuren te begrijpen' : 'Help us understand your preferences')
            : (isNl ? 'Deel uw ervaring met ons' : 'Share your experience with us')}
        </p>
      </div>
      
      {/* Progress Bar */}
      <div style={styles.progressBar}>
        <div style={{ ...styles.progressFill, width: `${progress}%` }} />
      </div>
      
      {/* Error Message */}
      {error && (
        <div style={styles.errorMessage}>
          <AlertCircle size={20} />
          <span>{error}</span>
        </div>
      )}
      
      {/* Questions */}
      {questions.map((question, index) => (
        <div key={question.id} style={styles.questionCard}>
          <div style={styles.questionNumber}>
            {isNl ? `Vraag ${index + 1} van ${questions.length}` : `Question ${index + 1} of ${questions.length}`}
          </div>
          <div style={styles.questionText}>
            {isNl ? question.textNl : question.text}
          </div>
          <div style={styles.optionsGrid}>
            {question.options.map((option) => {
              const isSelected = responses[question.id] === option.value
              return (
                <button
                  key={option.value}
                  style={{
                    ...styles.optionButton,
                    ...(isSelected ? styles.optionButtonSelected : {})
                  }}
                  onClick={() => handleOptionSelect(question.id, option.value)}
                >
                  <span style={{
                    ...styles.optionNumber,
                    ...(isSelected ? styles.optionNumberSelected : {})
                  }}>
                    {option.value}
                  </span>
                  <span style={styles.optionLabel}>
                    {isNl ? option.labelNl : option.label}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
      
      {/* Submit Button */}
      <div style={styles.buttonRow}>
        <button
          style={{
            ...styles.submitButton,
            ...(!allAnswered || submitting ? styles.submitButtonDisabled : {})
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
              {isNl ? 'Verzenden' : 'Submit'}
              <ChevronRight size={20} />
            </>
          )}
        </button>
      </div>
      
      {/* Progress indicator */}
      <p style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '1rem', fontSize: '0.875rem' }}>
        {answeredCount} / {questions.length} {isNl ? 'beantwoord' : 'answered'}
      </p>
    </div>
  )
}

export default Questionnaire
