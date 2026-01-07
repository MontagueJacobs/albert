import { useState } from 'react'
import { useAuth } from '../lib/authContext'

const modalStyles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    backgroundColor: '#1e293b',
    borderRadius: '16px',
    padding: '2rem',
    width: '100%',
    maxWidth: '400px',
    margin: '1rem',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '1.5rem',
  },
  title: {
    fontSize: '1.5rem',
    fontWeight: 700,
    color: '#f3f4f6',
    margin: 0,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    fontSize: '1.5rem',
    color: '#9ca3af',
    cursor: 'pointer',
    padding: '0.25rem',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  label: {
    display: 'block',
    fontSize: '0.875rem',
    fontWeight: 500,
    color: '#f3f4f6',
    marginBottom: '0.5rem',
  },
  input: {
    width: '100%',
    padding: '0.75rem',
    border: '2px solid #334155',
    borderRadius: '8px',
    fontSize: '1rem',
    backgroundColor: '#0f172a',
    color: '#f3f4f6',
    boxSizing: 'border-box',
  },
  error: {
    padding: '0.75rem',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid #ef4444',
    borderRadius: '8px',
    color: '#fca5a5',
    fontSize: '0.875rem',
  },
  success: {
    padding: '0.75rem',
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    border: '1px solid #22c55e',
    borderRadius: '8px',
    color: '#86efac',
    fontSize: '0.875rem',
  },
  submitBtn: {
    width: '100%',
    padding: '0.75rem 1.5rem',
    background: 'linear-gradient(135deg, #22c55e 0%, #667eea 100%)',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '1rem',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'transform 0.2s, box-shadow 0.2s',
  },
  submitBtnDisabled: {
    background: '#4b5563',
    cursor: 'not-allowed',
  },
  switchText: {
    marginTop: '1rem',
    textAlign: 'center',
    fontSize: '0.875rem',
    color: '#9ca3af',
  },
  switchBtn: {
    background: 'none',
    border: 'none',
    color: '#22c55e',
    cursor: 'pointer',
    fontWeight: 500,
    textDecoration: 'underline',
  },
}

export default function AuthModal({ isOpen, onClose, initialMode = 'login' }) {
  const [mode, setMode] = useState(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(null)
  
  const { signIn, signUp } = useAuth()

  if (!isOpen) return null

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    setLoading(true)

    try {
      if (mode === 'login') {
        await signIn(email, password)
        onClose()
      } else {
        const data = await signUp(email, password, displayName || email.split('@')[0])
        if (data.user && !data.session) {
          // Email confirmation required
          setSuccess('Check your email to confirm your account!')
        } else {
          onClose()
        }
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  return (
    <div style={modalStyles.overlay} onClick={handleOverlayClick}>
      <div style={modalStyles.modal}>
        <div style={modalStyles.header}>
          <h2 style={modalStyles.title}>
            {mode === 'login' ? 'Sign In' : 'Create Account'}
          </h2>
          <button onClick={onClose} style={modalStyles.closeBtn}>
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} style={modalStyles.form}>
          {mode === 'signup' && (
            <div>
              <label style={modalStyles.label}>Display Name</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                style={modalStyles.input}
                placeholder="Your name"
              />
            </div>
          )}

          <div>
            <label style={modalStyles.label}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={modalStyles.input}
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label style={modalStyles.label}>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              style={modalStyles.input}
              placeholder="••••••••"
            />
          </div>

          {error && <div style={modalStyles.error}>{error}</div>}
          {success && <div style={modalStyles.success}>{success}</div>}

          <button
            type="submit"
            disabled={loading}
            style={{
              ...modalStyles.submitBtn,
              ...(loading ? modalStyles.submitBtnDisabled : {}),
            }}
          >
            {loading ? 'Please wait...' : (mode === 'login' ? 'Sign In' : 'Create Account')}
          </button>
        </form>

        <div style={modalStyles.switchText}>
          {mode === 'login' ? (
            <>
              Don't have an account?{' '}
              <button
                onClick={() => { setMode('signup'); setError(null); setSuccess(null) }}
                style={modalStyles.switchBtn}
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <button
                onClick={() => { setMode('login'); setError(null); setSuccess(null) }}
                style={modalStyles.switchBtn}
              >
                Sign in
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
