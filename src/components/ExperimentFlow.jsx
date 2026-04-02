import { useState, useEffect, useCallback } from 'react'
import { Loader2, ChevronRight, ChevronLeft, FlaskConical, CheckCircle } from 'lucide-react'
import { useI18n } from '../i18n.jsx'
import { useBonusCard } from '../lib/bonusCardContext.jsx'
import ExperimentRanking from './ExperimentRanking.jsx'
import ExperimentLikert from './ExperimentLikert.jsx'
import ExperimentIntervention from './ExperimentIntervention.jsx'
import ExperimentReflection from './ExperimentReflection.jsx'
import QuizResultsReview from './QuizResultsReview.jsx'

const STEP_LABELS = {
  intro: { en: 'Introduction', nl: 'Introductie' },
  quiz1: { en: 'Quiz 1 – General Knowledge', nl: 'Quiz 1 – Algemene Kennis' },
  quiz2: { en: 'Quiz 2 – Your Products', nl: 'Quiz 2 – Jouw Producten' },
  self_perception: { en: 'Self-Assessment', nl: 'Zelfbeoordeling' },
  intervention: { en: 'Learn', nl: 'Leren' },
  quiz3: { en: 'Quiz 3 – General Products', nl: 'Quiz 3 – Algemene Producten' },
  quiz4: { en: 'Quiz 4 – Your Products', nl: 'Quiz 4 – Jouw Producten' },
  reflection: { en: 'Reflection', nl: 'Reflectie' },
  complete: { en: 'Complete', nl: 'Afgerond' }
}

const STEPS = ['intro', 'quiz1', 'quiz2', 'self_perception', 'intervention', 'quiz3', 'quiz4', 'reflection', 'complete']

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

  const handleQuizComplete = useCallback((updatedSession, scoreResult) => {
    setSession(updatedSession)
  }, [])

  const handleSelfPerceptionComplete = useCallback((updatedSession) => {
    setSession(updatedSession)
  }, [])

  const handleInterventionComplete = useCallback(async () => {
    try {
      const res = await fetch(`/api/experiment/${session.id}/intervention-complete`, {
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

  const handleReflectionComplete = useCallback((updatedSession) => {
    setSession(updatedSession)
  }, [])

  // Progress calculation
  const currentStepIndex = session ? STEPS.indexOf(session.current_step) : 0
  const progress = ((currentStepIndex) / (STEPS.length - 1)) * 100

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

  const stepLabel = STEP_LABELS[session.current_step]
  const stepText = isNl ? stepLabel?.nl : stepLabel?.en

  return (
    <div style={styles.container}>
      {/* Progress Bar */}
      {session.current_step !== 'intro' && session.current_step !== 'complete' && (
        <div style={styles.progressContainer}>
          <div style={styles.progressBar}>
            <div style={{ ...styles.progressFill, width: `${progress}%` }} />
          </div>
          <div style={styles.stepIndicator}>
            <span>{stepText}</span>
            <span>{isNl ? `Stap ${currentStepIndex} van ${STEPS.length - 1}` : `Step ${currentStepIndex} of ${STEPS.length - 1}`}</span>
          </div>
        </div>
      )}

      {/* INTRO / CONSENT STEP */}
      {session.current_step === 'intro' && (
        <div style={styles.introCard}>
          <h1 style={styles.introTitle}>
            <FlaskConical size={32} />
            {isNl ? 'CO₂ Voedsel Experiment' : 'CO₂ Food Experiment'}
          </h1>
          
          <div style={styles.introText}>
            {isNl ? (
              <>
                <p>Welkom bij dit korte experiment over de CO₂-impact van voedsel! 🌍</p>
                <p style={{ marginTop: '0.75rem' }}>In dit experiment ga je:</p>
                <ul style={{ marginTop: '0.5rem', paddingLeft: '1.5rem' }}>
                  <li>4 korte rangschikkingsopdrachten maken (producten sorteren op CO₂-uitstoot)</li>
                  <li>Een paar vragen beantwoorden over je zelfbeeld</li>
                  <li>Informatie bekijken over de echte CO₂-impact van voedsel</li>
                  <li>Reflecteren op wat je hebt geleerd</li>
                </ul>
                <p style={{ marginTop: '0.75rem' }}>Het duurt ongeveer <strong>10-15 minuten</strong>. Je antwoorden worden anoniem opgeslagen.</p>
              </>
            ) : (
              <>
                <p>Welcome to this short experiment about the CO₂ impact of food! 🌍</p>
                <p style={{ marginTop: '0.75rem' }}>In this experiment you will:</p>
                <ul style={{ marginTop: '0.5rem', paddingLeft: '1.5rem' }}>
                  <li>Complete 4 short ranking tasks (sorting products by CO₂ emissions)</li>
                  <li>Answer a few self-assessment questions</li>
                  <li>View information about the real CO₂ impact of food</li>
                  <li>Reflect on what you learned</li>
                </ul>
                <p style={{ marginTop: '0.75rem' }}>It takes about <strong>10-15 minutes</strong>. Your answers are stored anonymously.</p>
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
        </div>
      )}

      {/* QUIZ 1 - Generic Baseline */}
      {session.current_step === 'quiz1' && (
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

      {/* QUIZ 2 - Personal Baseline */}
      {session.current_step === 'quiz2' && (
        <>
          <div style={styles.stepBadge}>
            {isNl ? '🛒 Quiz 2 – Jouw Aankopen' : '🛒 Quiz 2 – Your Purchases'}
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

      {/* SELF-PERCEPTION */}
      {session.current_step === 'self_perception' && (
        <>
          <div style={styles.stepBadge}>
            {isNl ? '🪞 Zelfbeoordeling' : '🪞 Self-Assessment'}
          </div>
          <ExperimentLikert
            sessionId={session.id}
            onComplete={handleSelfPerceptionComplete}
          />
        </>
      )}

      {/* INTERVENTION / LEARNING */}
      {session.current_step === 'intervention' && (
        <>
          <div style={styles.stepBadge}>
            {isNl ? '📚 Leermoment' : '📚 Learning Moment'}
          </div>
          <ExperimentIntervention
            session={session}
            onComplete={handleInterventionComplete}
          />
        </>
      )}

      {/* QUIZ 3 - Post-intervention Generic */}
      {session.current_step === 'quiz3' && (
        <>
          <div style={styles.stepBadge}>
            {isNl ? '📊 Quiz 3 – Nieuwe Producten' : '📊 Quiz 3 – New Products'}
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

      {/* QUIZ 4 - Transfer Personal */}
      {session.current_step === 'quiz4' && (
        <>
          <div style={styles.stepBadge}>
            {isNl ? '🛒 Quiz 4 – Meer van Jouw Aankopen' : '🛒 Quiz 4 – More of Your Purchases'}
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

      {/* REFLECTION */}
      {session.current_step === 'reflection' && (
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

      {/* COMPLETE */}
      {session.current_step === 'complete' && (
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
            {[1, 2, 3, 4].map(n => {
              const quizData = session[`quiz${n}_data`]
              return (
                <div key={n} style={styles.scoreBox}>
                  <div style={styles.scoreLabel}>Quiz {n}</div>
                  <div style={styles.scoreValue}>
                    {quizData?.score != null ? `${quizData.score}/100` : '—'}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Show improvement */}
          {session.quiz1_data?.score != null && session.quiz3_data?.score != null && (
            <p style={{ color: 'var(--text, #f3f4f6)', marginBottom: '1rem', fontSize: '1rem' }}>
              {(() => {
                const diff = session.quiz3_data.score - session.quiz1_data.score
                if (diff > 0) return isNl ? `🎉 Je scoorde ${diff} punten beter na het leermoment!` : `🎉 You scored ${diff} points better after the learning moment!`
                if (diff === 0) return isNl ? '📊 Je score bleef gelijk.' : '📊 Your score stayed the same.'
                return isNl ? `📊 Je score veranderde met ${diff} punten.` : `📊 Your score changed by ${diff} points.`
              })()}
            </p>
          )}

          {/* Detailed quiz 3 & 4 results */}
          {(session.quiz3_data || session.quiz4_data) && (
            <div style={{ textAlign: 'left', marginBottom: '1.5rem' }}>
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted, #9ca3af)', marginBottom: '1rem', lineHeight: '1.5' }}>
                {isNl
                  ? 'Bekijk hieronder hoe je het deed op de laatste twee quizzen:'
                  : 'See below how you did on the last two quizzes:'}
              </p>
              <QuizResultsReview
                quizData={session.quiz3_data}
                quizLabel={isNl ? 'Quiz 3 – Nieuwe Producten' : 'Quiz 3 – New Products'}
                defaultOpen={true}
              />
              <QuizResultsReview
                quizData={session.quiz4_data}
                quizLabel={isNl ? 'Quiz 4 – Jouw Aankopen' : 'Quiz 4 – Your Purchases'}
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
