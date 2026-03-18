import { useState, useEffect } from 'react'
import { CreditCard, Search, RefreshCw, CheckCircle, AlertCircle, Loader2, ShoppingBag, Leaf, ArrowRight } from 'lucide-react'
import { useI18n } from '../i18n.jsx'

const styles = {
  container: {
    maxWidth: '600px',
    margin: '0 auto',
    padding: '2rem 1rem',
  },
  hero: {
    textAlign: 'center',
    marginBottom: '2rem',
  },
  title: {
    fontSize: '2rem',
    fontWeight: '700',
    color: 'var(--text)',
    marginBottom: '0.5rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
  },
  subtitle: {
    color: 'var(--text-muted)',
    fontSize: '1.1rem',
    marginBottom: '1.5rem',
  },
  card: {
    background: 'var(--bg-card, #1e293b)',
    borderRadius: '16px',
    padding: '1.5rem',
    marginBottom: '1rem',
  },
  cardTitle: {
    fontSize: '1.1rem',
    fontWeight: '600',
    color: 'var(--text)',
    marginBottom: '1rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  input: {
    width: '100%',
    padding: '1rem',
    fontSize: '1.1rem',
    border: '2px solid var(--border, #334155)',
    borderRadius: '12px',
    background: 'var(--bg, #0f172a)',
    color: 'var(--text)',
    marginBottom: '1rem',
    letterSpacing: '2px',
    textAlign: 'center',
  },
  button: {
    width: '100%',
    padding: '1rem 1.5rem',
    fontSize: '1rem',
    fontWeight: '600',
    border: 'none',
    borderRadius: '12px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    transition: 'all 0.2s',
  },
  primaryButton: {
    background: 'var(--primary, #22c55e)',
    color: 'white',
  },
  secondaryButton: {
    background: 'var(--bg-hover, #334155)',
    color: 'var(--text)',
    marginTop: '0.5rem',
  },
  divider: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    margin: '1.5rem 0',
    color: 'var(--text-muted)',
  },
  dividerLine: {
    flex: 1,
    height: '1px',
    background: 'var(--border, #334155)',
  },
  message: {
    padding: '1rem',
    borderRadius: '12px',
    marginBottom: '1rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
  },
  error: {
    background: 'rgba(239, 68, 68, 0.1)',
    color: '#f87171',
  },
  success: {
    background: 'rgba(34, 197, 94, 0.1)',
    color: '#22c55e',
  },
  info: {
    background: 'rgba(59, 130, 246, 0.1)',
    color: '#60a5fa',
    fontSize: '0.9rem',
  },
  steps: {
    marginTop: '1.5rem',
  },
  step: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '1rem',
    marginBottom: '1rem',
  },
  stepNumber: {
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    background: 'var(--primary, #22c55e)',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.9rem',
    fontWeight: '600',
    flexShrink: 0,
  },
  stepText: {
    color: 'var(--text-muted)',
    fontSize: '0.95rem',
    lineHeight: 1.5,
  },
}

export default function BonusCardLanding({ onBonusCardSubmit, onStartScrape }) {
  const { t, lang } = useI18n()
  const [cardNumber, setCardNumber] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [userInfo, setUserInfo] = useState(null)
  
  // Check localStorage for saved bonus card
  useEffect(() => {
    const savedCard = localStorage.getItem('ah_bonus_card')
    if (savedCard) {
      setCardNumber(savedCard)
      // Auto-submit if we have a saved card
      handleSubmit(null, savedCard)
    }
  }, [])
  
  const formatCardNumber = (value) => {
    // Remove non-digits and format as groups of 4
    const digits = value.replace(/\D/g, '').slice(0, 19)
    return digits.replace(/(.{4})/g, '$1 ').trim()
  }
  
  const handleInputChange = (e) => {
    setCardNumber(formatCardNumber(e.target.value))
    setError(null)
  }
  
  const handleSubmit = async (e, savedCard = null) => {
    if (e) e.preventDefault()
    
    const digits = (savedCard || cardNumber).replace(/\D/g, '')
    
    if (digits.length < 13) {
      setError(lang === 'nl' 
        ? 'Voer een geldig bonuskaartnummer in (minimaal 13 cijfers)'
        : 'Please enter a valid bonus card number (at least 13 digits)')
      return
    }
    
    setLoading(true)
    setError(null)
    
    try {
      const response = await fetch(`/api/bonus/${digits}/user`)
      const data = await response.json()
      
      if (response.ok) {
        // Save to localStorage
        localStorage.setItem('ah_bonus_card', digits)
        setUserInfo(data)
        // Notify parent
        if (onBonusCardSubmit) {
          onBonusCardSubmit(digits, data)
        }
      } else {
        setError(data.message || (lang === 'nl'
          ? 'Geen gegevens gevonden voor deze bonuskaart. Start eerst een scrape.'
          : 'No data found for this bonus card. Please run a scrape first.'))
      }
    } catch (err) {
      setError(lang === 'nl' 
        ? 'Kon gegevens niet ophalen. Probeer het opnieuw.'
        : 'Could not fetch data. Please try again.')
    } finally {
      setLoading(false)
    }
  }
  
  const handleStartScrape = () => {
    if (onStartScrape) {
      onStartScrape()
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.hero}>
        <h1 style={styles.title}>
          <Leaf size={32} style={{ color: 'var(--primary)' }} />
          Duurzaam Winkelen
        </h1>
        <p style={styles.subtitle}>
          {lang === 'nl' 
            ? 'Bekijk de duurzaamheid van je boodschappen'
            : 'View the sustainability of your groceries'}
        </p>
      </div>
      
      {/* Success state - user found */}
      {userInfo && (
        <div style={{...styles.card, ...styles.success, background: 'rgba(34, 197, 94, 0.1)'}}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <CheckCircle size={24} />
            <div>
              <strong>{lang === 'nl' ? 'Welkom terug!' : 'Welcome back!'}</strong>
              {userInfo.ah_email && <div style={{ fontSize: '0.9rem', opacity: 0.8 }}>{userInfo.ah_email}</div>}
              <div style={{ fontSize: '0.85rem', opacity: 0.7 }}>
                {lang === 'nl' ? 'Laatste scrape:' : 'Last scrape:'} {userInfo.last_scrape_at ? new Date(userInfo.last_scrape_at).toLocaleDateString() : 'N/A'}
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Enter bonus card number */}
      <div style={styles.card}>
        <h2 style={styles.cardTitle}>
          <CreditCard size={20} />
          {lang === 'nl' ? 'Voer je Bonuskaart in' : 'Enter your Bonus Card'}
        </h2>
        
        {error && (
          <div style={{...styles.message, ...styles.error}}>
            <AlertCircle size={20} />
            {error}
          </div>
        )}
        
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            style={styles.input}
            placeholder="2610 0000 0000 00000"
            value={cardNumber}
            onChange={handleInputChange}
            disabled={loading}
          />
          
          <button 
            type="submit" 
            style={{...styles.button, ...styles.primaryButton}}
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 size={20} className="spin" />
                {lang === 'nl' ? 'Laden...' : 'Loading...'}
              </>
            ) : (
              <>
                <Search size={20} />
                {lang === 'nl' ? 'Bekijk mijn dashboard' : 'View my dashboard'}
              </>
            )}
          </button>
        </form>
      </div>
      
      <div style={styles.divider}>
        <div style={styles.dividerLine} />
        <span>{lang === 'nl' ? 'of' : 'or'}</span>
        <div style={styles.dividerLine} />
      </div>
      
      {/* Start new scrape */}
      <div style={styles.card}>
        <h2 style={styles.cardTitle}>
          <RefreshCw size={20} />
          {lang === 'nl' ? 'Eerste keer? Start een Scrape' : 'First time? Start a Scrape'}
        </h2>
        
        <div style={{...styles.message, ...styles.info}}>
          <ShoppingBag size={20} />
          <span>
            {lang === 'nl'
              ? 'We halen je aankoopgeschiedenis op van je AH account. Je bonuskaartnummer wordt automatisch gedetecteerd.'
              : 'We\'ll fetch your purchase history from your AH account. Your bonus card number will be detected automatically.'}
          </span>
        </div>
        
        <button 
          style={{...styles.button, ...styles.primaryButton}}
          onClick={handleStartScrape}
        >
          <RefreshCw size={20} />
          {lang === 'nl' ? 'Start Scrape' : 'Start Scrape'}
          <ArrowRight size={20} />
        </button>
        
        <div style={styles.steps}>
          <div style={styles.step}>
            <div style={styles.stepNumber}>1</div>
            <div style={styles.stepText}>
              {lang === 'nl'
                ? 'Er opent een browservenster met de AH website'
                : 'A browser window will open with the AH website'}
            </div>
          </div>
          <div style={styles.step}>
            <div style={styles.stepNumber}>2</div>
            <div style={styles.stepText}>
              {lang === 'nl'
                ? 'Log in met je AH account'
                : 'Log in with your AH account'}
            </div>
          </div>
          <div style={styles.step}>
            <div style={styles.stepNumber}>3</div>
            <div style={styles.stepText}>
              {lang === 'nl'
                ? 'Je bonuskaartnummer en boodschappen worden automatisch opgehaald'
                : 'Your bonus card number and purchases will be fetched automatically'}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
