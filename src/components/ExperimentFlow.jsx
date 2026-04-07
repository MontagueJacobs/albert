import { useState, useEffect, useCallback } from 'react'
import { Loader2, ChevronRight, ChevronLeft, FlaskConical, CheckCircle, ShoppingCart, BookOpen } from 'lucide-react'
import { useI18n } from '../i18n.jsx'
import { useBonusCard } from '../lib/bonusCardContext.jsx'
import ExperimentRanking from './ExperimentRanking.jsx'
import ExperimentLikert from './ExperimentLikert.jsx'
import ExperimentIntervention from './ExperimentIntervention.jsx'
import ExperimentReflection from './ExperimentReflection.jsx'
import QuizResultsReview from './QuizResultsReview.jsx'
import AccountSync from './AccountSync.jsx'
import Dashboard from './Dashboard.jsx'

const STEP_LABELS = {
  consent: { en: 'Consent', nl: 'Toestemming' },
  scrape: { en: 'Connect Account', nl: 'Account Koppelen' },
  pre_quiz_general: { en: 'Quiz 1 – General Products', nl: 'Quiz 1 – Algemene Producten' },
  pre_quiz_ah: { en: 'Quiz 2 – Albert Heijn Products', nl: 'Quiz 2 – Albert Heijn Producten' },
  pre_quiz_personal: { en: 'Quiz 3 – Your Products', nl: 'Quiz 3 – Jouw Producten' },
  pre_questionnaire: { en: 'Questionnaire', nl: 'Vragenlijst' },
  learning_dashboard: { en: 'Learn & Explore', nl: 'Leren & Verkennen' },
  post_quiz_general: { en: 'Quiz 4 – General Products', nl: 'Quiz 4 – Algemene Producten' },
  post_quiz_ah: { en: 'Quiz 5 – Albert Heijn Products', nl: 'Quiz 5 – Albert Heijn Producten' },
  post_quiz_personal: { en: 'Quiz 6 – Your Products', nl: 'Quiz 6 – Jouw Producten' },
  post_questionnaire: { en: 'Questionnaire', nl: 'Vragenlijst' },
  post_reflection: { en: 'Reflection', nl: 'Reflectie' },
  complete: { en: 'Complete', nl: 'Afgerond' }
}

const STEPS = [
  'consent', 'scrape',
  'pre_quiz_general', 'pre_quiz_ah', 'pre_quiz_personal',
  'pre_questionnaire',
  'learning_dashboard',
  'post_quiz_general', 'post_quiz_ah', 'post_quiz_personal',
  'post_questionnaire', 'post_reflection',
  'complete'
]

// Pre-questionnaire: Likert questions about awareness & self-perception
const PRE_LIKERT_QUESTIONS = [
  {
    id: 'pre_q1',
    text: 'I know which food products have a high CO₂ footprint.',
    textNl: 'Ik weet welke voedselproducten een hoge CO₂-uitstoot hebben.',
    low: 'Strongly disagree', lowNl: 'Helemaal oneens',
    high: 'Strongly agree', highNl: 'Helemaal eens'
  },
  {
    id: 'pre_q2',
    text: 'I consider sustainability when grocery shopping.',
    textNl: 'Ik houd rekening met duurzaamheid bij het doen van boodschappen.',
    low: 'Strongly disagree', lowNl: 'Helemaal oneens',
    high: 'Strongly agree', highNl: 'Helemaal eens'
  },
  {
    id: 'pre_q3',
    text: 'I know the environmental impact of meat compared to plant-based products.',
    textNl: 'Ik weet wat de milieu-impact is van vlees ten opzichte van plantaardige producten.',
    low: 'Strongly disagree', lowNl: 'Helemaal oneens',
    high: 'Strongly agree', highNl: 'Helemaal eens'
  },
  {
    id: 'pre_q4',
    text: 'I am willing to change my eating habits for the environment.',
    textNl: 'Ik ben bereid mijn eetgewoontes aan te passen voor het milieu.',
    low: 'Strongly disagree', lowNl: 'Helemaal oneens',
    high: 'Strongly agree', highNl: 'Helemaal eens'
  },
  {
    id: 'pre_q5',
    text: 'I think it is important to know how much CO₂ my groceries cause.',
    textNl: 'Ik vind het belangrijk om te weten hoeveel CO₂ mijn boodschappen veroorzaken.',
    low: 'Strongly disagree', lowNl: 'Helemaal oneens',
    high: 'Strongly agree', highNl: 'Helemaal eens'
  }
]

// Post-questionnaire: Likert questions about learning & intent
const POST_LIKERT_QUESTIONS = [
  {
    id: 'post_q1',
    text: 'I now better understand which products have a high CO₂ footprint.',
    textNl: 'Ik begrijp nu beter welke producten een hoge CO₂-uitstoot hebben.',
    low: 'Strongly disagree', lowNl: 'Helemaal oneens',
    high: 'Strongly agree', highNl: 'Helemaal eens'
  },
  {
    id: 'post_q2',
    text: 'I plan to make more sustainable choices in my next grocery shopping.',
    textNl: 'Ik ben van plan om duurzamere keuzes te maken bij mijn volgende boodschappen.',
    low: 'Strongly disagree', lowNl: 'Helemaal oneens',
    high: 'Strongly agree', highNl: 'Helemaal eens'
  },
  {
    id: 'post_q3',
    text: 'The information I saw was useful and understandable.',
    textNl: 'De informatie die ik heb gezien was nuttig en begrijpelijk.',
    low: 'Strongly disagree', lowNl: 'Helemaal oneens',
    high: 'Strongly agree', highNl: 'Helemaal eens'
  },
  {
    id: 'post_q4',
    text: 'I now feel better equipped to make sustainable choices in the supermarket.',
    textNl: 'Ik voel me nu beter in staat om duurzame keuzes te maken in de supermarkt.',
    low: 'Strongly disagree', lowNl: 'Helemaal oneens',
    high: 'Strongly agree', highNl: 'Helemaal eens'
  },
  {
    id: 'post_q5',
    text: 'This kind of information should be available by default when grocery shopping.',
    textNl: 'Dit soort informatie zou standaard beschikbaar moeten zijn bij het boodschappen doen.',
    low: 'Strongly disagree', lowNl: 'Helemaal oneens',
    high: 'Strongly agree', highNl: 'Helemaal eens'
  }
]

const styles = {
  container: {
    maxWidth: '700px',
    margin: '0 auto',
    padding: '1rem'
  },
  progressContainer: {
    marginBottom: '1.5rem'
  },
  progressBar: {
    background: 'var(--bg-secondary, #334155)',
    borderRadius: '9999px',
    height: '8px',
    overflow: 'hidden',
    marginBottom: '0.5rem'
  },
  progressFill: {
    background: 'linear-gradient(90deg, #22c55e, #3b82f6)',
    height: '100%',
    transition: 'width 0.5s ease'
  },
  stepIndicator: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '0.75rem',
    color: 'var(--text-muted, #9ca3af)'
  },
  introCard: {
    background: 'var(--bg-card, #1e293b)',
    borderRadius: '16px',
    padding: '2rem',
    border: '1px solid var(--border, #334155)',
    textAlign: 'center'
  },
  introTitle: {
    fontSize: '1.75rem',
    fontWeight: '700',
    color: 'var(--text, #f3f4f6)',
    marginBottom: '1rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.75rem'
  },
  introText: {
    color: 'var(--text-muted, #9ca3af)',
    fontSize: '1rem',
    lineHeight: '1.7',
    marginBottom: '1.5rem',
    textAlign: 'left'
  },
  consentBox: {
    background: 'rgba(59, 130, 246, 0.08)',
    border: '1px solid rgba(59, 130, 246, 0.2)',
    borderRadius: '12px',
    padding: '1.25rem',
    marginBottom: '1.5rem',
    textAlign: 'left'
  },
  consentLabel: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.75rem',
    cursor: 'pointer',
    color: 'var(--text, #f3f4f6)',
    fontSize: '0.95rem',
    lineHeight: '1.5'
  },
  checkbox: {
    width: '20px',
    height: '20px',
    marginTop: '2px',
    accentColor: '#22c55e',
    flexShrink: 0
  },
  startBtn: {
    width: '100%',
    padding: '1rem 2rem',
    background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
    border: 'none',
    borderRadius: '12px',
    color: 'white',
    fontWeight: '600',
    fontSize: '1.1rem',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    transition: 'transform 0.2s, box-shadow 0.2s'
  },
  startBtnDisabled: {
    background: 'var(--bg-secondary, #334155)',
    cursor: 'not-allowed',
    opacity: 0.5
  },
  completeCard: {
    background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.1), rgba(59, 130, 246, 0.1))',
    borderRadius: '16px',
    padding: '2.5rem',
    border: '1px solid rgba(34, 197, 94, 0.3)',
    textAlign: 'center'
  },
  completeTitle: {
    fontSize: '1.75rem',
    fontWeight: '700',
    color: 'var(--text, #f3f4f6)',
    marginBottom: '1rem'
  },
  completeText: {
    color: 'var(--text-muted, #9ca3af)',
    fontSize: '1rem',
    lineHeight: '1.6',
    marginBottom: '1.5rem'
  },
  scoreSummary: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: '1rem',
    marginBottom: '2rem'
  },
  scoreBox: {
    background: 'var(--bg-card, #1e293b)',
    borderRadius: '12px',
    padding: '1rem',
    border: '1px solid var(--border, #334155)'
  },
  scoreLabel: {
    fontSize: '0.75rem',
    color: 'var(--text-muted, #9ca3af)',
    marginBottom: '0.25rem',
    textTransform: 'uppercase',
    letterSpacing: '0.05em'
  },
  scoreValue: {
    fontSize: '1.5rem',
    fontWeight: '700',
    color: '#22c55e'
  },
  loading: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '3rem',
    gap: '1rem',
    color: 'var(--text-muted, #9ca3af)'
  },
  doneBtn: {
    padding: '1rem 3rem',
    background: 'var(--primary, #3b82f6)',
    border: 'none',
    borderRadius: '12px',
    color: 'white',
    fontWeight: '600',
    fontSize: '1rem',
    cursor: 'pointer'
  },
  stepBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.25rem 0.75rem',
    background: 'rgba(59, 130, 246, 0.15)',
    color: '#60a5fa',
    borderRadius: '999px',
    fontSize: '0.8rem',
    fontWeight: '500',
    marginBottom: '1rem'
  }
}

export default function ExperimentFlow({ onComplete, onBack }) {
  const { lang } = useI18n()
  const { bonusCardNumber } = useBonusCard()
  const isNl = lang === 'nl'

  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [consentChecked, setConsentChecked] = useState(false)
  const [syncVersion, setSyncVersion] = useState(0)

  // Start or resume session
  useEffect(() => {
    if (!bonusCardNumber) {
      setError(isNl ? 'Geen bonuskaart gevonden' : 'No bonus card found')
      setLoading(false)
      return
    }
    startOrResume()
  }, [bonusCardNumber])

  const startOrResume = async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch('/api/experiment/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bonus_card: bonusCardNumber })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSession(data.session)
      if (data.session.consent_given) setConsentChecked(true)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleConsent = async () => {
    if (!consentChecked || !session) return
    try {
      setLoading(true)
      const res = await fetch(`/api/experiment/${session.id}/consent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consent_given: true })
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSession(data.session)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleScrapeComplete = async () => {
    try {
      setLoading(true)
      setSyncVersion(v => v + 1)
      const res = await fetch(`/api/experiment/${session.id}/scrape-complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSession(data.session)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleQuizComplete = useCallback((updatedSession) => {
    setSession(updatedSession)
  }, [])

  const handlePreQuestionnaireComplete = useCallback((updatedSession) => {
    setSession(updatedSession)
  }, [])

  const handleLearningComplete = useCallback(async () => {
    try {
      const res = await fetch(`/api/experiment/${session.id}/learning-complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setSession(data.session)
    } catch (e) {
      setError(e.message)
    }
  }, [session])

  const handlePostQuestionnaireComplete = useCallback((updatedSession) => {
    setSession(updatedSession)
  }, [])

  const handleReflectionComplete = useCallback((updatedSession) => {
    setSession(updatedSession)
  }, [])

  // Dev skip: jump directly to learning_dashboard for testing
  const handleDevSkip = async () => {
    if (!session) return
    try {
      setLoading(true)
      const res = await fetch(`/api/experiment/${session.id}/learning-complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      // We just need to set the step to learning_dashboard, so we do it manually
      setSession(prev => ({ ...prev, current_step: 'learning_dashboard' }))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // Map current step to index in STEPS array (handle legacy step names)
  const getStepIdx = (step) => {
    const legacyMap = {
      intro: 'consent', quiz1: 'pre_quiz_general', quiz2: 'pre_quiz_personal',
      self_perception: 'pre_questionnaire', intervention: 'learning_dashboard',
      quiz3: 'post_quiz_general', quiz4: 'post_quiz_personal', reflection: 'post_reflection'
    }
    return STEPS.indexOf(legacyMap[step] || step)
  }

  const currentStepIndex = session ? getStepIdx(session.current_step) : 0
  const progress = Math.max(0, (currentStepIndex / (STEPS.length - 1)) * 100)

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.loading}>
          <Loader2 size={32} className="spin" />
          <span>{isNl ? 'Experiment laden...' : 'Loading experiment...'}</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={styles.container}>
        <div style={{ ...styles.introCard, borderColor: 'rgba(239, 68, 68, 0.3)' }}>
          <p style={{ color: '#ef4444', marginBottom: '1rem' }}>{error}</p>
          <button 
            style={styles.doneBtn} 
            onClick={() => { setError(null); startOrResume() }}
          >
            {isNl ? 'Opnieuw proberen' : 'Try again'}
          </button>
        </div>
      </div>
    )
  }

  if (!session) return null

  const step = session.current_step
  const stepLabel = STEP_LABELS[step]
  const stepText = isNl ? stepLabel?.nl : stepLabel?.en

  return (
    <div style={styles.container}>
      {/* Progress Bar — shown for all steps except consent and complete */}
      {step !== 'consent' && step !== 'complete' && step !== 'intro' && (
        <div style={styles.progressContainer}>
          <div style={styles.progressBar}>
            <div style={{ ...styles.progressFill, width: `${progress}%` }} />
          </div>
          <div style={styles.stepIndicator}>
            <span>{stepText}</span>
            <span>
              {isNl
                ? `Stap ${currentStepIndex} van ${STEPS.length - 1}`
                : `Step ${currentStepIndex} of ${STEPS.length - 1}`}
            </span>
          </div>
        </div>
      )}

      {/* ====================== CONSENT ====================== */}
      {(step === 'consent' || step === 'intro') && (
        <div style={styles.introCard}>
          <h1 style={styles.introTitle}>
            <FlaskConical size={32} />
            {isNl ? 'CO₂ Voedsel Experiment' : 'CO₂ Food Experiment'}
          </h1>
          
          <div style={styles.introText}>
            {isNl ? (
              <>
                <p>Welkom bij dit experiment over de CO₂-impact van voedsel!</p>
                <p style={{ marginTop: '0.75rem' }}>In dit experiment ga je:</p>
                <ul style={{ marginTop: '0.5rem', paddingLeft: '1.5rem' }}>
                  <li>Je Albert Heijn account koppelen (bonuskaart-aankopen)</li>
                  <li>6 rangschikkingsopdrachten maken over CO₂-uitstoot van producten</li>
                  <li>Vragenlijsten invullen over je kennis en bewustzijn</li>
                  <li>Informatie bekijken over de CO₂-impact van voedsel en je eigen aankopen</li>
                  <li>Reflecteren op wat je hebt geleerd</li>
                </ul>
                <p style={{ marginTop: '0.75rem' }}>Het duurt ongeveer <strong>15-20 minuten</strong>. Je antwoorden worden anoniem opgeslagen voor wetenschappelijk onderzoek.</p>
              </>
            ) : (
              <>
                <p>Welcome to this experiment about the CO₂ impact of food!</p>
                <p style={{ marginTop: '0.75rem' }}>In this experiment you will:</p>
                <ul style={{ marginTop: '0.5rem', paddingLeft: '1.5rem' }}>
                  <li>Connect your Albert Heijn account (bonus card purchases)</li>
                  <li>Complete 6 ranking tasks about CO₂ emissions of products</li>
                  <li>Fill in questionnaires about your knowledge and awareness</li>
                  <li>View information about food CO₂ impact and your own purchases</li>
                  <li>Reflect on what you have learned</li>
                </ul>
                <p style={{ marginTop: '0.75rem' }}>It takes about <strong>15-20 minutes</strong>. Your answers are stored anonymously for scientific research.</p>
              </>
            )}
          </div>

          <div style={styles.consentBox}>
            <label style={styles.consentLabel}>
              <input 
                type="checkbox" 
                style={styles.checkbox}
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
              />
              <span>
                {isNl 
                  ? 'Ik begrijp dat mijn anonieme antwoorden worden opgeslagen voor onderzoeksdoeleinden en ik geef hiervoor toestemming.'
                  : 'I understand that my anonymous responses will be stored for research purposes and I give my consent.'}
              </span>
            </label>
          </div>

          <button
            style={{ ...styles.startBtn, ...(!consentChecked ? styles.startBtnDisabled : {}) }}
            onClick={handleConsent}
            disabled={!consentChecked}
          >
            {isNl ? 'Start Experiment' : 'Start Experiment'}
            <ChevronRight size={20} />
          </button>

          {/* Dev skip link — only in development */}
          {window.location.search.includes('dev=1') && (
            <button
              style={{ ...styles.doneBtn, marginTop: '1rem', background: '#6b7280', fontSize: '0.8rem' }}
              onClick={handleDevSkip}
            >
              [DEV] Skip to Dashboard
            </button>
          )}
        </div>
      )}

      {/* ====================== SCRAPE ====================== */}
      {step === 'scrape' && (
        <div>
          <div style={styles.stepBadge}>
            <ShoppingCart size={14} />
            {isNl ? 'Stap 1 – Account Koppelen' : 'Step 1 – Connect Account'}
          </div>
          <div style={{ ...styles.introCard, textAlign: 'left' }}>
            <h2 style={{ ...styles.introTitle, fontSize: '1.25rem', justifyContent: 'flex-start' }}>
              {isNl ? 'Koppel je Albert Heijn account' : 'Connect your Albert Heijn account'}
            </h2>
            <p style={{ ...styles.introText, marginBottom: '1rem' }}>
              {isNl
                ? 'Om het experiment te personaliseren, halen we je recente boodschappen op via je bonuskaart. Gebruik de onderstaande knop om je aankopen te synchroniseren.'
                : 'To personalize the experiment, we will retrieve your recent groceries via your bonus card. Use the button below to sync your purchases.'}
            </p>
            <AccountSync onSyncCompleted={() => {}} />
            <button
              style={{ ...styles.startBtn, marginTop: '1.5rem' }}
              onClick={handleScrapeComplete}
            >
              {isNl ? 'Verder naar de quizzen' : 'Continue to the quizzes'}
              <ChevronRight size={20} />
            </button>
          </div>
        </div>
      )}

      {/* ====================== PRE-QUIZ GENERAL (Quiz 1 – Pool A) ====================== */}
      {step === 'pre_quiz_general' && (
        <>
          <div style={styles.stepBadge}>
            {isNl ? '📊 Quiz 1 – Algemene Producten' : '📊 Quiz 1 – General Products'}
          </div>
          <ExperimentRanking
            sessionId={session.id}
            quizNumber={1}
            title={isNl ? 'Rangschik deze producten op CO₂-uitstoot' : 'Rank these products by CO₂ emissions'}
            subtitle={isNl 
              ? 'Sorteer van HOOGSTE naar LAAGSTE CO₂-uitstoot per kg product.'
              : 'Sort from HIGHEST to LOWEST CO₂ emissions per kg of product.'}
            onComplete={handleQuizComplete}
            showResults={false}
          />
        </>
      )}

      {/* ====================== PRE-QUIZ AH (Quiz 5 – Pool C) ====================== */}
      {step === 'pre_quiz_ah' && (
        <>
          <div style={styles.stepBadge}>
            {isNl ? '🛒 Quiz 2 – Albert Heijn Producten' : '🛒 Quiz 2 – Albert Heijn Products'}
          </div>
          <ExperimentRanking
            sessionId={session.id}
            quizNumber={5}
            title={isNl ? 'Rangschik deze AH-producten op CO₂-uitstoot' : 'Rank these AH products by CO₂ emissions'}
            subtitle={isNl 
              ? 'Sorteer van HOOGSTE naar LAAGSTE CO₂-uitstoot per kg product.'
              : 'Sort from HIGHEST to LOWEST CO₂ emissions per kg of product.'}
            onComplete={handleQuizComplete}
            showResults={false}
          />
        </>
      )}

      {/* ====================== PRE-QUIZ PERSONAL (Quiz 2 – User products) ====================== */}
      {(step === 'pre_quiz_personal' || step === 'quiz2') && (
        <>
          <div style={styles.stepBadge}>
            {isNl ? '🛒 Quiz 3 – Jouw Aankopen' : '🛒 Quiz 3 – Your Purchases'}
          </div>
          <ExperimentRanking
            sessionId={session.id}
            quizNumber={2}
            title={isNl ? 'Rangschik jouw producten op CO₂-uitstoot' : 'Rank your products by CO₂ emissions'}
            subtitle={isNl 
              ? 'Dit zijn producten die je eerder hebt gekocht. Sorteer van HOOGSTE naar LAAGSTE.'
              : 'These are products you have previously purchased. Sort from HIGHEST to LOWEST.'}
            onComplete={handleQuizComplete}
            showResults={false}
          />
        </>
      )}

      {/* ====================== PRE-QUESTIONNAIRE (Closed Likert) ====================== */}
      {(step === 'pre_questionnaire' || step === 'self_perception') && (
        <>
          <div style={styles.stepBadge}>
            {isNl ? '📝 Vragenlijst' : '📝 Questionnaire'}
          </div>
          <ExperimentLikert
            sessionId={session.id}
            questions={PRE_LIKERT_QUESTIONS}
            submitUrl={`/api/experiment/${session.id}/pre-questionnaire`}
            title={isNl ? 'Wat weet je over duurzaam eten?' : 'What do you know about sustainable eating?'}
            subtitle={isNl
              ? 'Geef aan in hoeverre je het eens bent met de volgende stellingen.'
              : 'Indicate how much you agree with the following statements.'}
            onComplete={handlePreQuestionnaireComplete}
          />
        </>
      )}

      {/* ====================== LEARNING + DASHBOARD ====================== */}
      {(step === 'learning_dashboard' || step === 'intervention') && (
        <>
          <div style={styles.stepBadge}>
            <BookOpen size={14} />
            {isNl ? '📚 Leren & Verkennen' : '📚 Learn & Explore'}
          </div>
          
          {/* Education / intervention section */}
          <ExperimentIntervention
            session={session}
            onComplete={null}
          />

          {/* Dashboard section */}
          <div style={{ marginTop: '2rem' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: '700', color: 'var(--text, #f3f4f6)', marginBottom: '1rem' }}>
              {isNl ? 'Jouw Duurzaamheids-Dashboard' : 'Your Sustainability Dashboard'}
            </h2>
            <p style={{ color: 'var(--text-muted, #9ca3af)', fontSize: '0.9rem', marginBottom: '1rem' }}>
              {isNl
                ? 'Bekijk hieronder de CO₂-impact van jouw eigen boodschappen.'
                : 'View the CO₂ impact of your own groceries below.'}
            </p>
            <Dashboard syncVersion={syncVersion} />
          </div>

          <button
            style={{ ...styles.startBtn, marginTop: '2rem' }}
            onClick={handleLearningComplete}
          >
            {isNl ? 'Verder naar de post-quizzen' : 'Continue to post-quizzes'}
            <ChevronRight size={20} />
          </button>
        </>
      )}

      {/* ====================== POST-QUIZ GENERAL (Quiz 3 – Pool B) ====================== */}
      {step === 'post_quiz_general' && (
        <>
          <div style={styles.stepBadge}>
            {isNl ? '📊 Quiz 4 – Nieuwe Producten' : '📊 Quiz 4 – New Products'}
          </div>
          <ExperimentRanking
            sessionId={session.id}
            quizNumber={3}
            title={isNl ? 'Rangschik deze nieuwe producten op CO₂-uitstoot' : 'Rank these new products by CO₂ emissions'}
            subtitle={isNl 
              ? 'Gebruik wat je hebt geleerd! Sorteer van HOOGSTE naar LAAGSTE.'
              : 'Use what you learned! Sort from HIGHEST to LOWEST.'}
            onComplete={handleQuizComplete}
            showResults={false}
          />
        </>
      )}

      {/* ====================== POST-QUIZ AH (Quiz 6 – Pool D) ====================== */}
      {step === 'post_quiz_ah' && (
        <>
          <div style={styles.stepBadge}>
            {isNl ? '🛒 Quiz 5 – Albert Heijn Producten' : '🛒 Quiz 5 – Albert Heijn Products'}
          </div>
          <ExperimentRanking
            sessionId={session.id}
            quizNumber={6}
            title={isNl ? 'Rangschik deze AH-producten op CO₂-uitstoot' : 'Rank these AH products by CO₂ emissions'}
            subtitle={isNl 
              ? 'Gebruik wat je hebt geleerd! Sorteer van HOOGSTE naar LAAGSTE.'
              : 'Use what you learned! Sort from HIGHEST to LOWEST.'}
            onComplete={handleQuizComplete}
            showResults={false}
          />
        </>
      )}

      {/* ====================== POST-QUIZ PERSONAL (Quiz 4 – User products) ====================== */}
      {step === 'post_quiz_personal' && (
        <>
          <div style={styles.stepBadge}>
            {isNl ? '🛒 Quiz 6 – Meer van Jouw Aankopen' : '🛒 Quiz 6 – More of Your Purchases'}
          </div>
          <ExperimentRanking
            sessionId={session.id}
            quizNumber={4}
            title={isNl ? 'Rangschik deze producten op CO₂-uitstoot' : 'Rank these products by CO₂ emissions'}
            subtitle={isNl 
              ? 'Andere producten uit je aankoopgeschiedenis. Sorteer van HOOGSTE naar LAAGSTE.'
              : 'Other products from your purchase history. Sort from HIGHEST to LOWEST.'}
            onComplete={handleQuizComplete}
            showResults={false}
          />
        </>
      )}

      {/* ====================== POST-QUESTIONNAIRE (Closed Likert) ====================== */}
      {step === 'post_questionnaire' && (
        <>
          <div style={styles.stepBadge}>
            {isNl ? '📝 Afsluitende Vragenlijst' : '📝 Closing Questionnaire'}
          </div>
          <ExperimentLikert
            sessionId={session.id}
            questions={POST_LIKERT_QUESTIONS}
            submitUrl={`/api/experiment/${session.id}/post-questionnaire`}
            title={isNl ? 'Hoe kijk je nu naar duurzaam eten?' : 'How do you now view sustainable eating?'}
            subtitle={isNl
              ? 'Geef aan in hoeverre je het eens bent met de volgende stellingen.'
              : 'Indicate how much you agree with the following statements.'}
            onComplete={handlePostQuestionnaireComplete}
          />
        </>
      )}

      {/* ====================== POST-REFLECTION (Open-ended) ====================== */}
      {(step === 'post_reflection' || step === 'reflection') && (
        <>
          <div style={styles.stepBadge}>
            {isNl ? '💭 Reflectie' : '💭 Reflection'}
          </div>
          <ExperimentReflection
            sessionId={session.id}
            onComplete={handleReflectionComplete}
          />
        </>
      )}

      {/* ====================== COMPLETE ====================== */}
      {step === 'complete' && (
        <div style={styles.completeCard}>
          <CheckCircle size={56} style={{ color: '#22c55e', marginBottom: '1rem' }} />
          <h2 style={styles.completeTitle}>
            {isNl ? 'Experiment Afgerond!' : 'Experiment Complete!'}
          </h2>
          <p style={styles.completeText}>
            {isNl 
              ? 'Bedankt voor je deelname! Hier is een samenvatting van je scores:'
              : 'Thank you for participating! Here is a summary of your scores:'}
          </p>

          <div style={styles.scoreSummary}>
            {[
              { n: 1, label: isNl ? 'Algemeen (voor)' : 'General (pre)' },
              { n: 5, label: isNl ? 'AH (voor)' : 'AH (pre)' },
              { n: 2, label: isNl ? 'Persoonlijk (voor)' : 'Personal (pre)' },
              { n: 3, label: isNl ? 'Algemeen (na)' : 'General (post)' },
              { n: 6, label: isNl ? 'AH (na)' : 'AH (post)' },
              { n: 4, label: isNl ? 'Persoonlijk (na)' : 'Personal (post)' }
            ].map(({ n, label }) => {
              const quizData = session[`quiz${n}_data`]
              return (
                <div key={n} style={styles.scoreBox}>
                  <div style={styles.scoreLabel}>{label}</div>
                  <div style={styles.scoreValue}>
                    {quizData?.score != null ? `${quizData.score}/100` : '—'}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Improvement comparison */}
          {session.quiz1_data?.score != null && session.quiz3_data?.score != null && (
            <p style={{ color: 'var(--text, #f3f4f6)', marginBottom: '1rem', fontSize: '1rem' }}>
              {(() => {
                const diff = session.quiz3_data.score - session.quiz1_data.score
                if (diff > 0) return isNl ? `Je scoorde ${diff} punten beter op algemene producten na het leermoment!` : `You scored ${diff} points better on general products after the learning moment!`
                if (diff === 0) return isNl ? 'Je score op algemene producten bleef gelijk.' : 'Your score on general products stayed the same.'
                return isNl ? `Je score op algemene producten veranderde met ${diff} punten.` : `Your score on general products changed by ${diff} points.`
              })()}
            </p>
          )}

          {/* Detailed results for post-quizzes */}
          {(session.quiz3_data || session.quiz4_data || session.quiz6_data) && (
            <div style={{ textAlign: 'left', marginBottom: '1.5rem' }}>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted, #9ca3af)', marginBottom: '1rem', lineHeight: '1.5' }}>
                {isNl
                  ? 'Bekijk hieronder hoe je het deed op de post-quizzen:'
                  : 'See below how you did on the post-quizzes:'}
              </p>
              <QuizResultsReview
                quizData={session.quiz3_data}
                quizLabel={isNl ? 'Quiz 4 – Algemene Producten' : 'Quiz 4 – General Products'}
                defaultOpen={true}
              />
              <QuizResultsReview
                quizData={session.quiz6_data}
                quizLabel={isNl ? 'Quiz 5 – AH Producten' : 'Quiz 5 – AH Products'}
                defaultOpen={false}
              />
              <QuizResultsReview
                quizData={session.quiz4_data}
                quizLabel={isNl ? 'Quiz 6 – Jouw Aankopen' : 'Quiz 6 – Your Purchases'}
                defaultOpen={false}
              />
            </div>
          )}

          <button style={styles.doneBtn} onClick={onComplete || onBack}>
            {isNl ? 'Terug naar Dashboard' : 'Back to Dashboard'}
          </button>
        </div>
      )}

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .spin { animation: spin 1s linear infinite; }
        button:hover:not(:disabled) { transform: translateY(-1px); }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>
    </div>
  )
}
