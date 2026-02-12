import { useState, useEffect, useCallback, useRef } from 'react'
import { Loader2, Lock, Mail, Eye, EyeOff, CheckCircle, AlertCircle, Info, Cookie, RefreshCw, Trash2 } from 'lucide-react'
import { useI18n } from '../i18n.jsx'
import { useAuth, useAuthenticatedFetch } from '../lib/authContext'

function AutoScrape({ onScrapeCompleted }) {
  const { t } = useI18n()
  const { user, isAuthenticated } = useAuth()
  const authFetch = useAuthenticatedFetch()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [saveCredentials, setSaveCredentials] = useState(true) // Default to save
  const [savedCredentials, setSavedCredentials] = useState(null) // Saved AH credentials status
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState(null)
  const [available, setAvailable] = useState(true)
  const [cookieStatus, setCookieStatus] = useState(null)
  const [capturingCookies, setCapturingCookies] = useState(false)
  const [mode, setMode] = useState('credentials') // 'cookies' or 'credentials'
  const pollRef = useRef(null)
  const lastCompletedRef = useRef(null)

  // Check if auto-scrape is available
  useEffect(() => {
    fetch('/api/auto-scrape/available')
      .then(res => res.json())
      .then(data => setAvailable(data.available))
      .catch(() => setAvailable(false))
  }, [])

  // Check cookie status
  const fetchCookieStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/auto-scrape/cookies')
      if (res.ok) {
        const data = await res.json()
        setCookieStatus(data)
      }
    } catch (err) {
      console.error('Failed to fetch cookie status:', err)
    }
  }, [])

  // Check if user has saved AH credentials
  const fetchSavedCredentials = useCallback(async () => {
    if (!isAuthenticated) {
      setSavedCredentials(null)
      return
    }
    try {
      const res = await authFetch('/api/user/ah-credentials')
      if (res.ok) {
        const data = await res.json()
        setSavedCredentials(data)
        if (data.ah_email) {
          setEmail(data.ah_email)
        }
      }
    } catch (err) {
      console.error('Failed to fetch saved credentials:', err)
    }
  }, [isAuthenticated, authFetch])

  useEffect(() => {
    fetchCookieStatus()
    fetchSavedCredentials()
  }, [fetchCookieStatus, fetchSavedCredentials])

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/auto-scrape/status')
      if (!res.ok) throw new Error('status request failed')
      const json = await res.json()
      setStatus(json)
      setError(null)
    } catch (err) {
      console.error('Failed to fetch auto-scrape status:', err)
      setError(t('auto_scrape_error_status'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  // Polling while scraping is in progress
  useEffect(() => {
    if (!status) return

    if (status.running) {
      if (!pollRef.current) {
        pollRef.current = setInterval(() => {
          fetchStatus()
        }, 2000) // Poll every 2 seconds for more responsive UI
      }
    } else if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }

    // Notify parent when scrape completes
    const completedAt = status?.lastRun?.completedAt
    if (!status.running && completedAt && completedAt !== lastCompletedRef.current) {
      lastCompletedRef.current = completedAt
      if (typeof onScrapeCompleted === 'function') {
        onScrapeCompleted()
      }
    }
  }, [status, fetchStatus, onScrapeCompleted])

  useEffect(() => () => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault()
    
    if (!email || !password) {
      setError(t('auto_scrape_error_credentials'))
      return
    }
    
    if (starting || status?.running) return
    
    setStarting(true)
    setError(null)
    
    try {
      // Use authFetch if authenticated to allow credential saving
      const fetchFn = isAuthenticated ? authFetch : fetch
      const res = await fetchFn('/api/auto-scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          email, 
          password,
          save_credentials: isAuthenticated && saveCredentials 
        })
      })
      
      if (res.status === 409) {
        setError(t('auto_scrape_conflict'))
      } else if (res.status === 501) {
        setError(t('auto_scrape_not_supported'))
      } else if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        throw new Error(payload?.error || 'failed to start auto-scrape')
      } else {
        // Clear password after successful start for security
        setPassword('')
        fetchStatus()
      }
    } catch (err) {
      console.error('Failed to start auto-scrape:', err)
      setError(t('auto_scrape_error_generic'))
    } finally {
      setStarting(false)
    }
  }, [email, password, starting, status, fetchStatus, t, isAuthenticated, authFetch, saveCredentials])

  // Start scrape using saved credentials (resync)
  const handleResync = useCallback(async () => {
    if (starting || status?.running) return
    if (!savedCredentials?.ah_email) {
      setError('No saved credentials found')
      return
    }
    
    setStarting(true)
    setError(null)
    
    try {
      const res = await authFetch('/api/auto-scrape/resync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      
      if (res.status === 404) {
        setError(t('auto_scrape_no_saved_credentials'))
      } else if (res.status === 409) {
        setError(t('auto_scrape_conflict'))
      } else if (res.status === 501) {
        setError(t('auto_scrape_not_supported'))
      } else if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        throw new Error(payload?.error || 'failed to start resync')
      } else {
        fetchStatus()
      }
    } catch (err) {
      console.error('Failed to start resync:', err)
      setError(t('auto_scrape_error_generic'))
    } finally {
      setStarting(false)
    }
  }, [starting, status, savedCredentials, fetchStatus, t, authFetch])

  // Start scrape with cookies
  const handleCookieScrape = useCallback(async () => {
    if (starting || status?.running) return
    
    setStarting(true)
    setError(null)
    
    try {
      // Use authenticated fetch to associate purchases with user
      const res = await authFetch('/api/auto-scrape/with-cookies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      
      if (res.status === 400) {
        const data = await res.json()
        if (data.error === 'no_cookies') {
          setError(t('auto_scrape_no_cookies'))
        } else {
          setError(data.message || t('auto_scrape_error_generic'))
        }
      } else if (res.status === 409) {
        setError(t('auto_scrape_conflict'))
      } else if (!res.ok) {
        throw new Error('failed to start')
      } else {
        fetchStatus()
      }
    } catch (err) {
      console.error('Failed to start cookie scrape:', err)
      setError(t('auto_scrape_error_generic'))
    } finally {
      setStarting(false)
    }
  }, [starting, status, fetchStatus, t, authFetch])

  // Start cookie capture (manual login)
  const handleCaptureCookies = useCallback(async () => {
    if (capturingCookies || status?.running) return
    
    setCapturingCookies(true)
    setError(null)
    
    try {
      const res = await fetch('/api/auto-scrape/capture-cookies', {
        method: 'POST'
      })
      
      if (res.status === 501) {
        setError(t('auto_scrape_capture_not_supported'))
      } else if (res.status === 409) {
        setError(t('auto_scrape_conflict'))
      } else if (!res.ok) {
        throw new Error('failed to start cookie capture')
      } else {
        // Poll for completion
        const pollCapture = setInterval(async () => {
          const statusRes = await fetch('/api/auto-scrape/capture-cookies/status')
          const statusData = await statusRes.json()
          
          if (!statusData.running) {
            clearInterval(pollCapture)
            setCapturingCookies(false)
            fetchCookieStatus()
          }
        }, 2000)
      }
    } catch (err) {
      console.error('Failed to start cookie capture:', err)
      setError(t('auto_scrape_error_generic'))
      setCapturingCookies(false)
    }
  }, [capturingCookies, status, fetchCookieStatus, t])

  // Delete cookies
  const handleDeleteCookies = useCallback(async () => {
    try {
      await fetch('/api/auto-scrape/cookies', { method: 'DELETE' })
      fetchCookieStatus()
    } catch (err) {
      console.error('Failed to delete cookies:', err)
    }
  }, [fetchCookieStatus])

  const formatDateTime = useCallback((value) => {
    if (!value) return null
    try {
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
      }).format(new Date(value))
    } catch (_err) {
      return value
    }
  }, [])

  const lastRun = status?.lastRun
  const isRunning = status?.running || starting

  if (!available) {
    return (
      <div style={{ 
        padding: '1.5rem', 
        background: 'rgba(245, 158, 11, 0.15)', 
        border: '1px solid rgba(245, 158, 11, 0.3)', 
        borderRadius: '12px',
        marginTop: '1rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
          <Info size={24} style={{ color: '#f59e0b', flexShrink: 0, marginTop: '2px' }} />
          <div>
            <h4 style={{ margin: '0 0 0.5rem 0', color: '#f59e0b' }}>{t('auto_scrape_not_available_title')}</h4>
            <p style={{ margin: 0, color: 'var(--text-muted, #9ca3af)' }}>{t('auto_scrape_not_available_desc')}</p>
          </div>
        </div>
      </div>
    )
  }

  const hasCookies = cookieStatus?.hasCookies

  return (
    <div style={{ marginTop: '1.5rem' }}>
      <div style={{ 
        border: '1px solid var(--border, #334155)', 
        borderRadius: '12px', 
        padding: '1.5rem',
        background: 'var(--bg-card, #1e293b)'
      }}>
        <h3 style={{ margin: '0 0 0.5rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text, #f3f4f6)' }}>
          <Lock size={20} />
          {t('auto_scrape_title')}
        </h3>
        <p style={{ margin: '0 0 1rem 0', color: 'var(--text-muted, #9ca3af)', fontSize: '0.95rem' }}>
          {t('auto_scrape_description')}
        </p>

        {/* Mode tabs */}
        <div style={{ 
          display: 'flex', 
          gap: '0.5rem', 
          marginBottom: '1rem',
          borderBottom: '1px solid var(--border, #334155)',
          paddingBottom: '0.5rem'
        }}>
          <button
            type="button"
            onClick={() => setMode('cookies')}
            style={{
              padding: '0.5rem 1rem',
              background: mode === 'cookies' ? '#e0e7ff' : 'transparent',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: mode === 'cookies' ? 600 : 400,
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem'
            }}
          >
            <Cookie size={16} />
            {t('auto_scrape_mode_cookies')}
            {hasCookies && <CheckCircle size={14} style={{ color: '#16a34a' }} />}
          </button>
          <button
            type="button"
            onClick={() => setMode('credentials')}
            style={{
              padding: '0.5rem 1rem',
              background: mode === 'credentials' ? '#e0e7ff' : 'transparent',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: mode === 'credentials' ? 600 : 400,
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem'
            }}
          >
            <Lock size={16} />
            {t('auto_scrape_mode_credentials')}
          </button>
        </div>

        {/* Cookie mode */}
        {mode === 'cookies' && (
          <div>
            {/* Cookie status */}
            <div style={{ 
              padding: '1rem', 
              background: hasCookies ? '#dcfce7' : '#fef3c7', 
              borderRadius: '8px', 
              marginBottom: '1rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Cookie size={20} style={{ color: hasCookies ? '#16a34a' : '#d97706' }} />
                <div>
                  <div style={{ fontWeight: 500 }}>
                    {hasCookies ? t('auto_scrape_cookies_valid') : t('auto_scrape_cookies_none')}
                  </div>
                  {hasCookies && (
                    <div style={{ fontSize: '0.85rem', color: '#666' }}>
                      {cookieStatus.cookieCount} {t('auto_scrape_cookies_count')}
                    </div>
                  )}
                </div>
              </div>
              {hasCookies && (
                <button
                  type="button"
                  onClick={handleDeleteCookies}
                  style={{
                    padding: '0.4rem',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#ef4444'
                  }}
                  title={t('auto_scrape_delete_cookies')}
                >
                  <Trash2 size={18} />
                </button>
              )}
            </div>

            {/* How it works */}
            <div style={{ 
              padding: '0.75rem 1rem', 
              background: 'rgba(59, 130, 246, 0.1)', 
              borderRadius: '8px', 
              marginBottom: '1rem',
              fontSize: '0.85rem',
              color: 'var(--text, #f3f4f6)'
            }}>
              <strong>ℹ️ {t('auto_scrape_cookie_how_title')}</strong>
              <ol style={{ margin: '0.5rem 0 0 1.25rem', padding: 0, color: 'var(--text-muted, #9ca3af)' }}>
                <li>{t('auto_scrape_cookie_step1')}</li>
                <li>{t('auto_scrape_cookie_step2')}</li>
                <li>{t('auto_scrape_cookie_step3')}</li>
              </ol>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              {!hasCookies ? (
                <button
                  type="button"
                  onClick={handleCaptureCookies}
                  disabled={capturingCookies || isRunning}
                  className="btn btn-primary"
                  style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '0.5rem',
                    padding: '0.75rem 1.25rem'
                  }}
                >
                  {capturingCookies ? (
                    <>
                      <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
                      {t('auto_scrape_capturing')}
                    </>
                  ) : (
                    <>
                      <Cookie size={18} />
                      {t('auto_scrape_capture_button')}
                    </>
                  )}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleCookieScrape}
                    disabled={isRunning}
                    className="btn btn-primary"
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '0.5rem',
                      padding: '0.75rem 1.25rem'
                    }}
                  >
                    {isRunning ? (
                      <>
                        <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
                        {t('auto_scrape_button_running')}
                      </>
                    ) : (
                      <>
                        <RefreshCw size={18} />
                        {t('auto_scrape_with_cookies_button')}
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleCaptureCookies}
                    disabled={capturingCookies || isRunning}
                    className="btn"
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '0.5rem',
                      padding: '0.75rem 1.25rem',
                      background: 'var(--bg-hover, #334155)',
                      border: '1px solid var(--border, #334155)',
                      color: 'var(--text, #f3f4f6)'
                    }}
                  >
                    <Cookie size={18} />
                    {t('auto_scrape_refresh_cookies')}
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Credentials mode */}
        {mode === 'credentials' && (
          <div>
            {/* Warning about CAPTCHA */}
            <div style={{ 
              padding: '0.75rem 1rem', 
              background: 'rgba(245, 158, 11, 0.15)', 
              borderRadius: '8px', 
              marginBottom: '1rem',
              fontSize: '0.85rem',
              color: '#fbbf24'
            }}>
              <strong>⚠️ {t('auto_scrape_captcha_warning_title')}</strong>
              <br />
              <span style={{ color: 'var(--text-muted, #9ca3af)' }}>{t('auto_scrape_captcha_warning_desc')}</span>
            </div>

            {/* Security notice */}
            <div style={{ 
              padding: '0.75rem 1rem', 
              background: 'rgba(59, 130, 246, 0.15)', 
              borderRadius: '8px', 
              marginBottom: '1rem',
              fontSize: '0.85rem',
              color: '#60a5fa'
            }}>
              <strong>🔒 {t('auto_scrape_security_title')}</strong>
              <br />
              <span style={{ color: 'var(--text-muted, #9ca3af)' }}>{t('auto_scrape_security_desc')}</span>
            </div>

            {/* Credentials form */}
            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: '1rem' }}>
                <label htmlFor="ah-email" style={{ display: 'block', marginBottom: '0.4rem', fontWeight: 500 }}>
                  <Mail size={16} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '0.4rem' }} />
                  {t('auto_scrape_email_label')}
                </label>
                <input
                  id="ah-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('auto_scrape_email_placeholder')}
                  disabled={isRunning}
                  style={{
                    width: '100%',
                    padding: '0.6rem 0.8rem',
                    borderRadius: '8px',
                    border: '1px solid #d1d5db',
                    fontSize: '1rem'
                  }}
                  autoComplete="email"
                />
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label htmlFor="ah-password" style={{ display: 'block', marginBottom: '0.4rem', fontWeight: 500 }}>
                  <Lock size={16} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '0.4rem' }} />
                  {t('auto_scrape_password_label')}
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    id="ah-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t('auto_scrape_password_placeholder')}
                    disabled={isRunning}
                    style={{
                      width: '100%',
                      padding: '0.6rem 2.5rem 0.6rem 0.8rem',
                      borderRadius: '8px',
                      border: '1px solid #d1d5db',
                      fontSize: '1rem'
                    }}
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{
                      position: 'absolute',
                      right: '0.5rem',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: '0.25rem',
                      color: '#666'
                    }}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {/* Save credentials checkbox (only for authenticated users) */}
              {isAuthenticated && (
                <div style={{ marginBottom: '1rem' }}>
                  <label style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '0.5rem',
                    cursor: 'pointer',
                    fontSize: '0.9rem'
                  }}>
                    <input
                      type="checkbox"
                      checked={saveCredentials}
                      onChange={(e) => setSaveCredentials(e.target.checked)}
                      disabled={isRunning}
                      style={{ width: '18px', height: '18px' }}
                    />
                    <span>{t('auto_scrape_save_credentials') || 'Save credentials for future syncs'}</span>
                  </label>
                  <p style={{ 
                    margin: '0.25rem 0 0 1.75rem', 
                    fontSize: '0.8rem', 
                    color: '#666' 
                  }}>
                    {t('auto_scrape_save_credentials_hint') || 'Your password is encrypted and stored securely'}
                  </p>
                </div>
              )}

              {/* Show saved credentials status */}
              {isAuthenticated && savedCredentials?.ah_email && (
                <div style={{ 
                  padding: '0.75rem 1rem', 
                  background: '#dcfce7', 
                  borderRadius: '8px', 
                  marginBottom: '1rem',
                  fontSize: '0.85rem',
                  color: '#166534',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <CheckCircle size={18} />
                    <div>
                      <strong>{t('auto_scrape_credentials_saved') || 'Credentials saved'}</strong>
                      <div style={{ fontSize: '0.8rem', opacity: 0.9 }}>
                        {savedCredentials.ah_email} 
                        {savedCredentials.last_sync_at && (
                          <> · {t('auto_scrape_last_sync') || 'Last sync'}: {formatDateTime(savedCredentials.last_sync_at)}</>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleResync}
                    disabled={isRunning}
                    className="btn"
                    style={{ 
                      padding: '0.4rem 0.75rem',
                      fontSize: '0.85rem',
                      background: '#166534',
                      color: 'white',
                      border: 'none',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem'
                    }}
                  >
                    <RefreshCw size={14} />
                    {t('auto_scrape_resync') || 'Resync'}
                  </button>
                </div>
              )}

              <button
                type="submit"
                className="btn btn-primary"
                disabled={isRunning || !email || !password}
                style={{ 
                  width: '100%', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  gap: '0.5rem',
                  padding: '0.75rem 1rem'
                }}
              >
                {isRunning ? (
                  <>
                    <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
                    {t('auto_scrape_button_running')}
                  </>
                ) : (
                  <>
                    <Lock size={18} />
                    {t('auto_scrape_button')}
                  </>
                )}
              </button>
            </form>
          </div>
        )}

        {/* Error display */}
        {error && (
          <div style={{ 
            padding: '0.75rem', 
            background: 'rgba(239, 68, 68, 0.15)', 
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '8px', 
            marginTop: '1rem',
            color: '#ef4444',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            <AlertCircle size={18} />
            {error}
          </div>
        )}

        {/* Progress indicator */}
        {isRunning && status?.progress && (
          <div style={{ 
            marginTop: '1rem', 
            padding: '0.75rem', 
            background: 'rgba(59, 130, 246, 0.15)', 
            borderRadius: '8px',
            fontSize: '0.9rem',
            color: 'var(--text, #f3f4f6)'
          }}>
            <strong>{t('auto_scrape_progress_label')}</strong> {status.progress}
          </div>
        )}

        {/* Last run info */}
        {lastRun && !isRunning && (
          <div style={{ 
            marginTop: '1rem', 
            padding: '0.75rem', 
            background: lastRun.status === 'success' ? 'rgba(34, 197, 94, 0.15)' : (lastRun.loginRequired ? 'rgba(245, 158, 11, 0.15)' : 'rgba(239, 68, 68, 0.15)'), 
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.5rem'
          }}>
            {lastRun.status === 'success' ? (
              <CheckCircle size={18} style={{ color: '#22c55e', flexShrink: 0, marginTop: '2px' }} />
            ) : lastRun.loginRequired ? (
              <Cookie size={18} style={{ color: '#f59e0b', flexShrink: 0, marginTop: '2px' }} />
            ) : (
              <AlertCircle size={18} style={{ color: '#ef4444', flexShrink: 0, marginTop: '2px' }} />
            )}
            <div>
              <div style={{ fontWeight: 500, color: lastRun.loginRequired ? '#f59e0b' : 'var(--text, #f3f4f6)' }}>
                {lastRun.status === 'success' 
                  ? t('auto_scrape_last_success') 
                  : lastRun.loginRequired
                    ? t('auto_scrape_login_required_title')
                    : t('auto_scrape_last_error')}
              </div>
              {lastRun.loginRequired ? (
                <div style={{ fontSize: '0.85rem', color: 'var(--text-muted, #9ca3af)', marginTop: '0.25rem' }}>
                  {t('auto_scrape_login_required_desc')}
                </div>
              ) : (
                <>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted, #9ca3af)', marginTop: '0.25rem' }}>
                    {formatDateTime(lastRun.completedAt)}
                    {lastRun.productsFound > 0 && ` · ${lastRun.productsFound} ${t('auto_scrape_products_found')}`}
                    {lastRun.productsStored > 0 && ` · ${lastRun.productsStored} ${t('auto_scrape_products_stored')}`}
                  </div>
                  {lastRun.error && !lastRun.loginRequired && (
                    <div style={{ fontSize: '0.85rem', color: '#ef4444', marginTop: '0.25rem' }}>
                      {lastRun.error}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* Logs section */}
        {status?.logs?.length > 0 && (
          <div style={{ marginTop: '1rem' }}>
            <details>
              <summary style={{ cursor: 'pointer', fontWeight: 500, marginBottom: '0.5rem', color: 'var(--text, #f3f4f6)' }}>
                {t('auto_scrape_logs_label')} ({status.logs.length})
              </summary>
              <div style={{ 
                border: '1px solid var(--border, #334155)', 
                background: 'var(--bg-hover, #334155)', 
                borderRadius: '8px', 
                maxHeight: '200px', 
                overflowY: 'auto', 
                padding: '0.75rem' 
              }}>
                <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: '0.75rem', whiteSpace: 'pre-wrap', color: 'var(--text, #f3f4f6)' }}>
                  {status.logs.map((entry, i) => (
                    `[${entry.timestamp?.split('T')[1]?.split('.')[0] || ''}] ${entry.message}\n`
                  )).join('')}
                </pre>
              </div>
            </details>
          </div>
        )}
      </div>
    </div>
  )
}

export default AutoScrape
