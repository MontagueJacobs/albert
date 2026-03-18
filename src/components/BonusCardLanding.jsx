import { useState, useEffect } from 'react'
import { RefreshCw, CheckCircle, ShoppingBag, Leaf, ArrowRight, Calendar, TrendingUp } from 'lucide-react'
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
    fontSize: '1.2rem',
    fontWeight: '600',
    color: 'var(--text)',
    marginBottom: '1rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  button: {
    width: '100%',
    padding: '1rem 1.5rem',
    fontSize: '1.1rem',
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
  message: {
    padding: '1rem',
    borderRadius: '12px',
    marginBottom: '1rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
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
  featureGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '1rem',
    marginTop: '1rem',
  },
  featureItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.75rem',
    background: 'var(--bg-hover, #334155)',
    borderRadius: '10px',
  },
  featureIcon: {
    color: 'var(--primary, #22c55e)',
  },
  featureText: {
    fontSize: '0.9rem',
    color: 'var(--text)',
  },
}

export default function BonusCardLanding({ onBonusCardSubmit, onStartScrape }) {
  const { t, lang } = useI18n()
  const [userInfo, setUserInfo] = useState(null)
  const [loading, setLoading] = useState(true)
  
  // Check localStorage for saved bonus card and auto-fetch user info
  useEffect(() => {
    const checkSavedCard = async () => {
      const savedCard = localStorage.getItem('ah_bonus_card')
      if (savedCard) {
        try {
          const response = await fetch(`/api/bonus/${savedCard}/user`)
          if (response.ok) {
            const data = await response.json()
            setUserInfo(data)
            // Notify parent
            if (onBonusCardSubmit) {
              onBonusCardSubmit(savedCard, data)
            }
          }
        } catch (err) {
          console.error('Failed to fetch user info:', err)
        }
      }
      setLoading(false)
    }
    checkSavedCard()
  }, [])
  
  const handleStartScrape = () => {
    if (onStartScrape) {
      onStartScrape()
    }
  }

  if (loading) {
    return null
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
      
      {/* Success state - returning user */}
      {userInfo && (
        <div style={{...styles.card, ...styles.success, background: 'rgba(34, 197, 94, 0.1)'}}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
            <CheckCircle size={24} />
            <div>
              <strong>{lang === 'nl' ? 'Welkom terug!' : 'Welcome back!'}</strong>
              {userInfo.ah_email && <div style={{ fontSize: '0.9rem', opacity: 0.8 }}>{userInfo.ah_email}</div>}
              <div style={{ fontSize: '0.85rem', opacity: 0.7 }}>
                {lang === 'nl' ? 'Laatste sync:' : 'Last sync:'} {userInfo.last_scrape_at ? new Date(userInfo.last_scrape_at).toLocaleDateString() : 'N/A'}
              </div>
            </div>
          </div>
          <button 
            style={{...styles.button, ...styles.primaryButton}}
            onClick={handleStartScrape}
          >
            <RefreshCw size={20} />
            {lang === 'nl' ? 'Gegevens vernieuwen' : 'Refresh data'}
          </button>
        </div>
      )}
      
      {/* New user CTA */}
      {!userInfo && (
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>
            <ShoppingBag size={22} />
            {lang === 'nl' ? 'Koppel je AH Account' : 'Connect your AH Account'}
          </h2>
          
          <div style={{...styles.message, ...styles.info}}>
            <Leaf size={20} />
            <span>
              {lang === 'nl'
                ? 'We halen je aankoopgeschiedenis op en analyseren de duurzaamheid van je boodschappen.'
                : 'We\'ll fetch your purchase history and analyze the sustainability of your groceries.'}
            </span>
          </div>
          
          <button 
            style={{...styles.button, ...styles.primaryButton}}
            onClick={handleStartScrape}
          >
            <RefreshCw size={20} />
            {lang === 'nl' ? 'Start' : 'Get Started'}
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
                  ? 'Je boodschappen worden automatisch opgehaald en geanalyseerd'
                  : 'Your purchases will be fetched and analyzed automatically'}
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Features preview */}
      <div style={styles.card}>
        <h2 style={styles.cardTitle}>
          {lang === 'nl' ? 'Wat je kunt zien' : 'What you\'ll see'}
        </h2>
        <div style={styles.featureGrid}>
          <div style={styles.featureItem}>
            <TrendingUp size={20} style={styles.featureIcon} />
            <span style={styles.featureText}>
              {lang === 'nl' ? 'Duurzaamheidsscore' : 'Sustainability score'}
            </span>
          </div>
          <div style={styles.featureItem}>
            <Leaf size={20} style={styles.featureIcon} />
            <span style={styles.featureText}>
              {lang === 'nl' ? 'Herkomst producten' : 'Product origins'}
            </span>
          </div>
          <div style={styles.featureItem}>
            <Calendar size={20} style={styles.featureIcon} />
            <span style={styles.featureText}>
              {lang === 'nl' ? 'Maandoverzichten' : 'Monthly insights'}
            </span>
          </div>
          <div style={styles.featureItem}>
            <ShoppingBag size={20} style={styles.featureIcon} />
            <span style={styles.featureText}>
              {lang === 'nl' ? 'Aankoopgeschiedenis' : 'Purchase history'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
