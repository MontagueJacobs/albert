import { useState, useEffect, useCallback, useRef } from 'react'
import { Loader2, Lock, Mail, Eye, EyeOff, CheckCircle, AlertCircle, Info } from 'lucide-react'
import { useI18n } from '../i18n.jsx'

function AutoScrape({ onScrapeCompleted }) {
  const { t } = useI18n()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState(null)
  const [available, setAvailable] = useState(true)
  const pollRef = useRef(null)
  const lastCompletedRef = useRef(null)

  // Check if auto-scrape is available
  useEffect(() => {
    fetch('/api/auto-scrape/available')
      .then(res => res.json())
      .then(data => setAvailable(data.available))
      .catch(() => setAvailable(false))
  }, [])

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
      const res = await fetch('/api/auto-scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
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
  }, [email, password, starting, status, fetchStatus, t])

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
        background: '#fff3cd', 
        border: '1px solid #ffc107', 
        borderRadius: '12px',
        marginTop: '1rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
          <Info size={24} style={{ color: '#856404', flexShrink: 0, marginTop: '2px' }} />
          <div>
            <h4 style={{ margin: '0 0 0.5rem 0', color: '#856404' }}>{t('auto_scrape_not_available_title')}</h4>
            <p style={{ margin: 0, color: '#856404' }}>{t('auto_scrape_not_available_desc')}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ marginTop: '1.5rem' }}>
      <div style={{ 
        border: '1px solid #e0e7ff', 
        borderRadius: '12px', 
        padding: '1.5rem',
        background: 'linear-gradient(135deg, #f8faff 0%, #fff 100%)'
      }}>
        <h3 style={{ margin: '0 0 0.5rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Lock size={20} />
          {t('auto_scrape_title')}
        </h3>
        <p style={{ margin: '0 0 1rem 0', color: '#666', fontSize: '0.95rem' }}>
          {t('auto_scrape_description')}
        </p>

        {/* Security notice */}
        <div style={{ 
          padding: '0.75rem 1rem', 
          background: '#e8f4fd', 
          borderRadius: '8px', 
          marginBottom: '1rem',
          fontSize: '0.85rem',
          color: '#0369a1'
        }}>
          <strong>🔒 {t('auto_scrape_security_title')}</strong>
          <br />
          {t('auto_scrape_security_desc')}
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

          {error && (
            <div style={{ 
              padding: '0.75rem', 
              background: '#fee2e2', 
              border: '1px solid #fecaca',
              borderRadius: '8px', 
              marginBottom: '1rem',
              color: '#dc2626',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              <AlertCircle size={18} />
              {error}
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
                <Loader2 size={18} className="spin" style={{ animation: 'spin 1s linear infinite' }} />
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

        {/* Progress indicator */}
        {isRunning && status?.progress && (
          <div style={{ 
            marginTop: '1rem', 
            padding: '0.75rem', 
            background: '#f0f9ff', 
            borderRadius: '8px',
            fontSize: '0.9rem'
          }}>
            <strong>{t('auto_scrape_progress_label')}</strong> {status.progress}
          </div>
        )}

        {/* Last run info */}
        {lastRun && !isRunning && (
          <div style={{ 
            marginTop: '1rem', 
            padding: '0.75rem', 
            background: lastRun.status === 'success' ? '#dcfce7' : '#fee2e2', 
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.5rem'
          }}>
            {lastRun.status === 'success' ? (
              <CheckCircle size={18} style={{ color: '#16a34a', flexShrink: 0, marginTop: '2px' }} />
            ) : (
              <AlertCircle size={18} style={{ color: '#dc2626', flexShrink: 0, marginTop: '2px' }} />
            )}
            <div>
              <div style={{ fontWeight: 500 }}>
                {lastRun.status === 'success' ? t('auto_scrape_last_success') : t('auto_scrape_last_error')}
              </div>
              <div style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.25rem' }}>
                {formatDateTime(lastRun.completedAt)}
                {lastRun.productsFound > 0 && ` · ${lastRun.productsFound} ${t('auto_scrape_products_found')}`}
                {lastRun.productsStored > 0 && ` · ${lastRun.productsStored} ${t('auto_scrape_products_stored')}`}
              </div>
              {lastRun.error && (
                <div style={{ fontSize: '0.85rem', color: '#dc2626', marginTop: '0.25rem' }}>
                  {lastRun.error}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Logs section */}
        {status?.logs?.length > 0 && (
          <div style={{ marginTop: '1rem' }}>
            <details>
              <summary style={{ cursor: 'pointer', fontWeight: 500, marginBottom: '0.5rem' }}>
                {t('auto_scrape_logs_label')} ({status.logs.length})
              </summary>
              <div style={{ 
                border: '1px solid #e5e7eb', 
                background: '#f9fafb', 
                borderRadius: '8px', 
                maxHeight: '200px', 
                overflowY: 'auto', 
                padding: '0.75rem' 
              }}>
                <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: '0.75rem', whiteSpace: 'pre-wrap' }}>
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
