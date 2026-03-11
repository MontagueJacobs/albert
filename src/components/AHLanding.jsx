import { useState } from 'react'
import { Mail, ShoppingCart, Leaf, ArrowRight } from 'lucide-react'
import { useAHUser } from '../lib/ahUserContext'

/**
 * Landing page for non-identified users
 * Options:
 * 1. Enter AH email to view saved data (returning user)
 * 2. Connect AH account for the first time (new user)
 */
export default function AHLanding({ onConnectNew }) {
  const { setAHEmail } = useAHUser()
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email.trim()) return
    
    setChecking(true)
    setError('')
    
    try {
      // Check if this email has data
      const res = await fetch(`/api/ah-user/check?email=${encodeURIComponent(email.trim())}`)
      const data = await res.json()
      
      if (data.exists) {
        // User has data, log them in
        setAHEmail(email.trim())
      } else {
        setError('Geen gegevens gevonden voor dit e-mailadres. Koppel eerst je AH-account.')
      }
    } catch (err) {
      setError('Er ging iets mis. Probeer het opnieuw.')
    } finally {
      setChecking(false)
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.logoContainer}>
            <Leaf size={32} style={{ color: '#00ADE6' }} />
          </div>
          <h1 style={styles.title}>Duurzaam Boodschappen</h1>
          <p style={styles.subtitle}>
            Ontdek de duurzaamheid van je Albert Heijn aankopen
          </p>
        </div>

        {/* Features */}
        <div style={styles.features}>
          <div style={styles.feature}>
            <ShoppingCart size={20} style={{ color: '#00ADE6' }} />
            <span>Bekijk je aankoopgeschiedenis</span>
          </div>
          <div style={styles.feature}>
            <Leaf size={20} style={{ color: '#22c55e' }} />
            <span>Krijg duurzaamheidsscores</span>
          </div>
        </div>

        {/* Divider */}
        <div style={styles.divider}>
          <span style={styles.dividerText}>Al eerder gekoppeld?</span>
        </div>

        {/* Email lookup form */}
        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.inputGroup}>
            <Mail size={20} style={styles.inputIcon} />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Je AH e-mailadres"
              style={styles.input}
              required
            />
          </div>
          
          {error && <p style={styles.error}>{error}</p>}
          
          <button 
            type="submit" 
            disabled={checking || !email.trim()}
            style={{
              ...styles.submitBtn,
              opacity: checking || !email.trim() ? 0.7 : 1,
            }}
          >
            {checking ? 'Controleren...' : 'Bekijk mijn gegevens'}
            <ArrowRight size={18} />
          </button>
        </form>

        {/* New user option */}
        <div style={styles.newUser}>
          <p style={styles.newUserText}>Nog niet gekoppeld?</p>
          <button 
            onClick={onConnectNew}
            style={styles.connectBtn}
          >
            Koppel je AH-account
          </button>
        </div>
      </div>

      {/* Footer */}
      <p style={styles.footer}>
        Je gegevens worden veilig opgeslagen en alleen gebruikt om je duurzaamheidsinzichten te tonen.
      </p>
    </div>
  )
}

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2rem',
    background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)',
  },
  card: {
    background: 'white',
    borderRadius: '16px',
    padding: '2.5rem',
    maxWidth: '420px',
    width: '100%',
    boxShadow: '0 10px 40px rgba(0,0,0,0.1)',
  },
  header: {
    textAlign: 'center',
    marginBottom: '2rem',
  },
  logoContainer: {
    width: '64px',
    height: '64px',
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #e0f7fa 0%, #b2ebf2 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 1rem',
  },
  title: {
    fontSize: '1.75rem',
    fontWeight: 700,
    color: '#1a1a1a',
    margin: '0 0 0.5rem',
  },
  subtitle: {
    fontSize: '1rem',
    color: '#666',
    margin: 0,
  },
  features: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
    marginBottom: '1.5rem',
  },
  feature: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    fontSize: '0.95rem',
    color: '#444',
  },
  divider: {
    textAlign: 'center',
    marginBottom: '1.5rem',
    position: 'relative',
  },
  dividerText: {
    background: 'white',
    padding: '0 1rem',
    color: '#888',
    fontSize: '0.9rem',
    position: 'relative',
    zIndex: 1,
  },
  form: {
    marginBottom: '1.5rem',
  },
  inputGroup: {
    position: 'relative',
    marginBottom: '1rem',
  },
  inputIcon: {
    position: 'absolute',
    left: '1rem',
    top: '50%',
    transform: 'translateY(-50%)',
    color: '#888',
  },
  input: {
    width: '100%',
    padding: '1rem 1rem 1rem 3rem',
    fontSize: '1rem',
    border: '2px solid #e0e0e0',
    borderRadius: '10px',
    outline: 'none',
    transition: 'border-color 0.2s',
    boxSizing: 'border-box',
  },
  error: {
    color: '#ef4444',
    fontSize: '0.9rem',
    marginBottom: '1rem',
  },
  submitBtn: {
    width: '100%',
    padding: '1rem',
    fontSize: '1rem',
    fontWeight: 600,
    color: 'white',
    background: '#00ADE6',
    border: 'none',
    borderRadius: '10px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
  },
  newUser: {
    textAlign: 'center',
    paddingTop: '1.5rem',
    borderTop: '1px solid #eee',
  },
  newUserText: {
    color: '#666',
    fontSize: '0.9rem',
    marginBottom: '0.75rem',
  },
  connectBtn: {
    padding: '0.75rem 1.5rem',
    fontSize: '1rem',
    fontWeight: 600,
    color: '#00ADE6',
    background: 'transparent',
    border: '2px solid #00ADE6',
    borderRadius: '10px',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  footer: {
    marginTop: '1.5rem',
    textAlign: 'center',
    color: '#888',
    fontSize: '0.85rem',
    maxWidth: '400px',
  },
}
