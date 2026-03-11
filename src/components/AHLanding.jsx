import { useState, useCallback, useRef, useEffect } from 'react'
import { Mail, ShoppingCart, Leaf, ArrowRight, Loader2, ExternalLink, CheckCircle, AlertCircle } from 'lucide-react'
import { useAHUser } from '../lib/ahUserContext'
import { useI18n } from '../i18n.jsx'

/**
 * Landing page for non-identified users
 * Options:
 * 1. Enter AH email to view saved data (returning user)
 * 2. Connect AH account for the first time (new user) - triggers visual login flow
 */
export default function AHLanding({ onConnectNew }) {
  const { setAHEmail } = useAHUser()
  const { t } = useI18n()
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  
  // Connect flow state
  const [connectStep, setConnectStep] = useState('idle') // 'idle', 'email', 'connecting', 'syncing', 'success', 'error'
  const [connectEmail, setConnectEmail] = useState('')
  const [connectProgress, setConnectProgress] = useState('')
  const [productsCount, setProductsCount] = useState(0)
  const pollRef = useRef(null)

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
        setError(t('landing_error_no_data'))
      }
    } catch (err) {
      setError(t('landing_error_generic'))
    } finally {
      setChecking(false)
    }
  }

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [])

  // Poll for sync status while connecting/syncing
  useEffect(() => {
    if (connectStep === 'connecting' || connectStep === 'syncing') {
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch('/api/auto-scrape/status')
          const data = await res.json()
          
          if (data.progress) {
            setConnectProgress(data.progress)
          }
          
          if (!data.running) {
            clearInterval(pollRef.current)
            pollRef.current = null
            
            if (data.lastRun?.status === 'success') {
              setConnectStep('success')
              setProductsCount(data.lastRun.productsStored || data.lastRun.productsFound || 0)
              // Wait a moment then log user in
              setTimeout(() => {
                setAHEmail(connectEmail.trim())
              }, 2000)
            } else {
              setConnectStep('error')
              setError(data.lastRun?.error || t('landing_error_generic'))
            }
          }
        } catch (e) {
          console.error('Poll error:', e)
        }
      }, 2000)
    }
    
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [connectStep, connectEmail, setAHEmail, t])

  // Start the connect flow - first ask for email
  const handleConnectClick = () => {
    if (onConnectNew) {
      onConnectNew()
    } else {
      setConnectStep('email')
    }
  }

  // After email entered, start visual login
  const handleStartVisualLogin = async (e) => {
    e.preventDefault()
    if (!connectEmail.trim()) return
    
    setConnectStep('connecting')
    setConnectProgress(t('landing_opening_browser'))
    setError('')
    
    try {
      // First register the user
      await fetch('/api/ah-user/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: connectEmail.trim() })
      })
      
      // Start visual login with email header so data is tied to this user
      const res = await fetch('/api/auto-scrape/visual-login', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-AH-Email': connectEmail.trim()
        }
      })
      
      if (res.status === 501) {
        // Not supported on hosted version - fall back to simple registration
        setError(t('landing_visual_not_supported'))
        setConnectStep('error')
        return
      }
      
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to start')
      }
      
      setConnectProgress(t('landing_please_login'))
      setConnectStep('syncing')
      // Polling will take over from here
      
    } catch (err) {
      console.error('Connect failed:', err)
      setError(err.message)
      setConnectStep('error')
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
          <h1 style={styles.title}>{t('landing_title')}</h1>
          <p style={styles.subtitle}>
            {t('landing_subtitle')}
          </p>
        </div>

        {/* Features */}
        <div style={styles.features}>
          <div style={styles.feature}>
            <ShoppingCart size={20} style={{ color: '#00ADE6' }} />
            <span>{t('landing_feature_history')}</span>
          </div>
          <div style={styles.feature}>
            <Leaf size={20} style={{ color: '#22c55e' }} />
            <span>{t('landing_feature_scores')}</span>
          </div>
        </div>

        {/* Divider */}
        <div style={styles.divider}>
          <span style={styles.dividerText}>{t('landing_already_connected')}</span>
        </div>

        {/* Email lookup form */}
        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.inputGroup}>
            <Mail size={20} style={styles.inputIcon} />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t('landing_email_placeholder')}
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
            {checking ? t('landing_checking') : t('landing_view_data')}
            <ArrowRight size={18} />
          </button>
        </form>

        {/* New user / Connect option */}
        <div style={styles.newUser}>
          <p style={styles.newUserText}>{t('landing_not_connected')}</p>
          
          {connectStep === 'idle' && (
            <button 
              onClick={handleConnectClick}
              style={styles.connectBtn}
            >
              {t('landing_connect_account')}
            </button>
          )}
          
          {connectStep === 'email' && (
            <form onSubmit={handleStartVisualLogin} style={styles.registerForm}>
              <p style={styles.registerHint}>{t('landing_enter_ah_email')}</p>
              <div style={styles.inputGroup}>
                <Mail size={20} style={styles.inputIcon} />
                <input
                  type="email"
                  value={connectEmail}
                  onChange={(e) => setConnectEmail(e.target.value)}
                  placeholder={t('landing_email_placeholder')}
                  style={styles.input}
                  required
                  autoFocus
                />
              </div>
              <button 
                type="submit" 
                disabled={!connectEmail.trim()}
                style={{
                  ...styles.submitBtn,
                  background: 'linear-gradient(135deg, #00a0e2 0%, #0077b3 100%)',
                  opacity: !connectEmail.trim() ? 0.7 : 1,
                }}
              >
                <ExternalLink size={18} />
                {t('landing_open_ah_login')}
              </button>
              <button 
                type="button"
                onClick={() => setConnectStep('idle')}
                style={styles.cancelBtn}
              >
                {t('landing_cancel')}
              </button>
            </form>
          )}
          
          {(connectStep === 'connecting' || connectStep === 'syncing') && (
            <div style={styles.connectingBox}>
              <div style={styles.spinnerContainer}>
                <Loader2 size={32} style={{ color: '#00ADE6', animation: 'spin 1s linear infinite' }} />
              </div>
              <p style={styles.connectingText}>{connectProgress}</p>
              <p style={styles.connectingHint}>
                {t('landing_login_hint')}
              </p>
            </div>
          )}
          
          {connectStep === 'success' && (
            <div style={styles.successBox}>
              <CheckCircle size={48} style={{ color: '#22c55e' }} />
              <p style={styles.successText}>{t('landing_sync_success')}</p>
              <p style={styles.successCount}>{productsCount} {t('landing_products_synced')}</p>
            </div>
          )}
          
          {connectStep === 'error' && (
            <div style={styles.errorBox}>
              <AlertCircle size={32} style={{ color: '#ef4444' }} />
              <p style={styles.errorText}>{error}</p>
              <button 
                onClick={() => { setConnectStep('idle'); setError(''); }}
                style={styles.connectBtn}
              >
                {t('landing_try_again')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <p style={styles.footer}>
        {t('landing_privacy_notice')}
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
  registerForm: {
    width: '100%',
  },
  registerHint: {
    fontSize: '0.9rem',
    color: '#666',
    marginBottom: '1rem',
    textAlign: 'center',
  },
  cancelBtn: {
    marginTop: '0.75rem',
    padding: '0.5rem 1rem',
    fontSize: '0.9rem',
    color: '#888',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    width: '100%',
  },
  connectingBox: {
    padding: '1.5rem',
    textAlign: 'center',
  },
  spinnerContainer: {
    marginBottom: '1rem',
  },
  connectingText: {
    fontSize: '1rem',
    fontWeight: 600,
    color: '#333',
    marginBottom: '0.5rem',
  },
  connectingHint: {
    fontSize: '0.85rem',
    color: '#666',
  },
  successBox: {
    padding: '1.5rem',
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.75rem',
  },
  successText: {
    fontSize: '1.1rem',
    fontWeight: 600,
    color: '#22c55e',
  },
  successCount: {
    fontSize: '0.9rem',
    color: '#666',
  },
  errorBox: {
    padding: '1.5rem',
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '0.75rem',
  },
  errorText: {
    fontSize: '0.9rem',
    color: '#ef4444',
  },
  footer: {
    marginTop: '1.5rem',
    textAlign: 'center',
    color: '#888',
    fontSize: '0.85rem',
    maxWidth: '400px',
  },
}
