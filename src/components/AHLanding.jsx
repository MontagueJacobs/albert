import { useState } from 'react'
import { Mail, Lock, ShoppingCart, Leaf, ArrowRight, UserPlus, LogIn } from 'lucide-react'
import { useAHUser } from '../lib/ahUserContext'
import { useI18n } from '../i18n.jsx'

/**
 * Landing page with email + password login/register
 */
export default function AHLanding() {
  const { setAHEmail } = useAHUser()
  const { t } = useI18n()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState('login') // 'login' or 'register'

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email.trim() || !password) return
    
    setLoading(true)
    setError('')
    
    try {
      const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login'
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password })
      })
      
      const data = await res.json()
      
      if (!res.ok) {
        setError(data.message || 'An error occurred')
        return
      }
      
      // Success - log the user in
      setAHEmail(data.email)
    } catch (err) {
      setError(t('landing_error_generic') || 'Connection error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const toggleMode = () => {
    setMode(mode === 'login' ? 'register' : 'login')
    setError('')
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.logoContainer}>
            <Leaf size={32} style={{ color: '#00ADE6' }} />
          </div>
          <h1 style={styles.title}>{t('landing_title') || 'Broodschappen (Un)wrapped'}</h1>
          <p style={styles.subtitle}>
            {t('landing_subtitle') || 'Discover the CO₂ impact of your groceries'}
          </p>
        </div>

        {/* Features */}
        <div style={styles.features}>
          <div style={styles.feature}>
            <ShoppingCart size={20} style={{ color: '#00ADE6' }} />
            <span>{t('landing_feature_history') || 'View purchase history'}</span>
          </div>
          <div style={styles.feature}>
            <Leaf size={20} style={{ color: '#22c55e' }} />
            <span>{t('landing_feature_scores') || 'Sustainability scores'}</span>
          </div>
        </div>

        {/* Mode tabs */}
        <div style={styles.tabs}>
          <button 
            style={{...styles.tab, ...(mode === 'login' ? styles.tabActive : {})}}
            onClick={() => setMode('login')}
          >
            <LogIn size={16} />
            {t('login') || 'Login'}
          </button>
          <button 
            style={{...styles.tab, ...(mode === 'register' ? styles.tabActive : {})}}
            onClick={() => setMode('register')}
          >
            <UserPlus size={16} />
            {t('register') || 'Register'}
          </button>
        </div>

        {/* Login/Register form */}
        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.inputGroup}>
            <Mail size={20} style={styles.inputIcon} />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('email_placeholder') || 'Email address'}
              style={styles.input}
              required
              autoComplete="email"
            />
          </div>
          
          <div style={styles.inputGroup}>
            <Lock size={20} style={styles.inputIcon} />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('password_placeholder') || 'Password'}
              style={styles.input}
              required
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              minLength={4}
            />
          </div>
          
          {error && <p style={styles.error}>{error}</p>}
          
          <button 
            type="submit" 
            disabled={loading || !email.trim() || !password}
            style={{
              ...styles.submitBtn,
              opacity: loading || !email.trim() || !password ? 0.7 : 1,
            }}
          >
            {loading 
              ? (t('loading') || 'Loading...') 
              : mode === 'register' 
                ? (t('create_account') || 'Create Account')
                : (t('login') || 'Login')
            }
            <ArrowRight size={18} />
          </button>
        </form>

        {/* Toggle link */}
        <p style={styles.toggleText}>
          {mode === 'login' 
            ? (t('no_account') || "Don't have an account?")
            : (t('have_account') || 'Already have an account?')
          }
          {' '}
          <button style={styles.toggleBtn} onClick={toggleMode}>
            {mode === 'login' 
              ? (t('register') || 'Register')
              : (t('login') || 'Login')
            }
          </button>
        </p>
      </div>

      {/* Footer */}
      <p style={styles.footer}>
        {t('landing_privacy_notice') || 'Your data is stored securely and used only for this study.'}
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
    marginBottom: '1.5rem',
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
  tabs: {
    display: 'flex',
    gap: '0.5rem',
    marginBottom: '1.5rem',
  },
  tab: {
    flex: 1,
    padding: '0.75rem',
    fontSize: '0.95rem',
    fontWeight: 600,
    border: '2px solid #e0e0e0',
    borderRadius: '10px',
    background: 'white',
    color: '#666',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem',
    transition: 'all 0.2s',
  },
  tabActive: {
    borderColor: '#00ADE6',
    color: '#00ADE6',
    background: '#f0f9ff',
  },
  form: {
    marginBottom: '1rem',
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
    padding: '0.75rem',
    background: '#fef2f2',
    borderRadius: '8px',
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
    transition: 'background 0.2s',
  },
  toggleText: {
    textAlign: 'center',
    color: '#666',
    fontSize: '0.9rem',
    margin: 0,
  },
  toggleBtn: {
    color: '#00ADE6',
    fontWeight: 600,
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    fontSize: '0.9rem',
  },
  footer: {
    marginTop: '1.5rem',
    textAlign: 'center',
    color: '#888',
    fontSize: '0.85rem',
    maxWidth: '400px',
  },
}
