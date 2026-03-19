import { useState, useEffect, useCallback, useRef } from 'react'
import { Loader2, ShoppingCart, CheckCircle, AlertCircle, RefreshCw, Trash2, Monitor, ExternalLink, Bookmark, Puzzle } from 'lucide-react'
import { useI18n } from '../i18n.jsx'
import { useAHUser, useAHFetch } from '../lib/ahUserContext.jsx'
import { useBonusCard } from '../lib/bonusCardContext.jsx'

// Railway scraper URL - strip trailing slash to avoid // in paths
const RAILWAY_SCRAPER_URL = (import.meta.env.VITE_RAILWAY_SCRAPER_URL || '').replace(/\/+$/, '')

/**
 * AccountSync - Simplified one-click AH account sync
 * 
 * Flow:
 * 1. No cookies? Click "Login to Albert Heijn" -> Opens browser window
 * 2. User logs in (handles CAPTCHA themselves)
 * 3. Cookies saved, products scraped automatically
 * 4. Have cookies? Click "Sync Now" to resync
 * 
 * Remote mode (when local unavailable):
 * - Uses Railway backend with noVNC for visible browser
 */
function AccountSync({ onSyncCompleted }) {
  const { t, lang } = useI18n()
  const { sessionId } = useAHUser()
  const ahFetch = useAHFetch()
  const { login: bonusLogin } = useBonusCard()
  
  const [status, setStatus] = useState('idle') // 'idle', 'connecting', 'syncing', 'success', 'error'
  const [progress, setProgress] = useState('')
  const [error, setError] = useState(null)
  const [cookieStatus, setCookieStatus] = useState(null)
  const [lastSync, setLastSync] = useState(null)
  const [productsCount, setProductsCount] = useState(0)
  const [available, setAvailable] = useState(true)
  const [remoteAvailable, setRemoteAvailable] = useState(false)
  const [remoteSession, setRemoteSession] = useState(null)
  const [showVnc, setShowVnc] = useState(false)
  const pollRef = useRef(null)

  // Check if auto-scrape is available (local only)
  useEffect(() => {
    console.log('[AccountSync] Checking availability...')
    ahFetch('/api/auto-scrape/available')
      .then(res => {
        console.log('[AccountSync] Availability response status:', res.status)
        return res.json()
      })
      .then(data => {
        console.log('[AccountSync] Availability data:', data)
        setAvailable(data.available)
        
        // If local not available, check Railway remote scraper
        if (!data.available && RAILWAY_SCRAPER_URL) {
          fetch(`${RAILWAY_SCRAPER_URL}/health`)
            .then(res => {
              if (!res.ok) throw new Error(`HTTP ${res.status}`)
              const contentType = res.headers.get('content-type')
              if (!contentType || !contentType.includes('application/json')) {
                throw new Error('Not JSON response')
              }
              return res.json()
            })
            .then(health => {
              console.log('[AccountSync] Railway health:', health)
              setRemoteAvailable(health.vnc_available || health.status === 'ok')
            })
            .catch(err => {
              console.log('[AccountSync] Railway not available:', err.message)
              setRemoteAvailable(false)
            })
        }
      })
      .catch(err => {
        console.error('[AccountSync] Availability check failed:', err)
        setAvailable(false)
      })
  }, [ahFetch])

  // Fetch cookie status and last run info
  const fetchStatus = useCallback(async () => {
    try {
      // Check cookies
      const cookieRes = await ahFetch('/api/auto-scrape/cookies')
      const cookieData = await cookieRes.json()
      setCookieStatus(cookieData)
      
      // Check scrape status
      const statusRes = await ahFetch('/api/auto-scrape/status')
      const statusData = await statusRes.json()
      
      if (statusData?.lastRun?.productsStored) {
        setProductsCount(statusData.lastRun.productsStored)
        setLastSync(statusData.lastRun.completedAt)
      }
      
      if (statusData?.running) {
        setStatus('syncing')
        setProgress(statusData.progress || 'Syncing...')
      }
      
    } catch (err) {
      console.error('Failed to fetch status:', err)
    }
  }, [ahFetch])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  // Poll for status updates while syncing
  useEffect(() => {
    if (status === 'connecting' || status === 'syncing') {
      pollRef.current = setInterval(async () => {
        try {
          const res = await ahFetch('/api/auto-scrape/status')
          const data = await res.json()
          
          if (data.progress) {
            setProgress(data.progress)
          }
          
          if (!data.running) {
            clearInterval(pollRef.current)
            pollRef.current = null
            
            if (data.lastRun?.status === 'success') {
              setStatus('success')
              setProductsCount(data.lastRun.productsStored || data.lastRun.productsFound || 0)
              setLastSync(new Date().toISOString())
              fetchStatus()
              if (onSyncCompleted) onSyncCompleted()
            } else if (data.lastRun?.loginRequired) {
              // Cookies expired
              setStatus('idle')
              setError('Session expired. Please login again.')
              setCookieStatus({ hasCookies: false })
            } else {
              setStatus('error')
              setError(data.lastRun?.error || 'Sync failed')
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
  }, [status, fetchStatus, onSyncCompleted, ahFetch])

  // Start visual login flow (opens browser window for user to login)
  const handleLogin = useCallback(async () => {
    setStatus('connecting')
    setError(null)
    setProgress('Opening browser window...')
    
    try {
      const res = await ahFetch('/api/auto-scrape/visual-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      
      if (res.status === 501) {
        setError('This feature is only available when running locally.')
        setStatus('error')
        return
      }
      
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to start')
      }
      
      setProgress('Please log in to Albert Heijn in the browser window...')
      // Polling will take over from here
      
    } catch (err) {
      console.error('Login failed:', err)
      setError(err.message)
      setStatus('error')
    }
  }, [ahFetch])

  // Quick resync using saved cookies
  const handleSync = useCallback(async () => {
    setStatus('syncing')
    setError(null)
    setProgress('Starting sync...')
    
    try {
      const res = await ahFetch('/api/auto-scrape/with-cookies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      
      if (res.status === 400) {
        // Cookies expired, need to reconnect
        setError('Session expired. Please login again.')
        setStatus('idle')
        setCookieStatus({ hasCookies: false })
        return
      }
      
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to start sync')
      }
      
      setProgress('Syncing your purchases...')
      // Polling will take over from here
      
    } catch (err) {
      console.error('Sync failed:', err)
      setError(err.message)
      setStatus('error')
    }
  }, [ahFetch])

  // Disconnect (clear cookies)
  const handleDisconnect = useCallback(async () => {
    try {
      await ahFetch('/api/auto-scrape/cookies', { method: 'DELETE' })
      setCookieStatus({ hasCookies: false })
      setProductsCount(0)
      setLastSync(null)
      setStatus('idle')
    } catch (err) {
      console.error('Disconnect failed:', err)
    }
  }, [ahFetch])

  // Start remote scraper (Railway backend)
  const handleRemoteScrape = useCallback(async () => {
    if (!RAILWAY_SCRAPER_URL) {
      setError('Remote scraper not configured')
      return
    }
    
    setStatus('connecting')
    setError(null)
    setProgress(lang === 'nl' ? 'Remote browser starten...' : 'Starting remote browser...')
    
    try {
      const res = await fetch(`${RAILWAY_SCRAPER_URL}/api/scrape/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      
      const contentType = res.headers.get('content-type')
      if (!contentType || !contentType.includes('application/json')) {
        const text = await res.text()
        console.error('Non-JSON response from Railway:', text.substring(0, 200))
        throw new Error('Railway service returned invalid response - make sure it is deployed and running')
      }
      
      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Failed to start remote scraper')
      }
      
      const data = await res.json()
      setRemoteSession(data)
      setShowVnc(true)
      setProgress(lang === 'nl' ? 'Log in op de AH website in het browservenster hieronder' : 'Log in to the AH website in the browser window below')
      
      // Start polling for remote scraper status
      const pollRemoteStatus = async () => {
        try {
          const statusRes = await fetch(`${RAILWAY_SCRAPER_URL}${data.status_url}`)
          
          const contentType = statusRes.headers.get('content-type')
          if (!contentType || !contentType.includes('application/json')) {
            console.error('Non-JSON status response')
            setTimeout(pollRemoteStatus, 3000)
            return
          }
          
          const statusData = await statusRes.json()
          
          setProgress(statusData.message || 'Scraping...')
          
          if (statusData.status === 'complete') {
            setStatus('success')
            setProductsCount(statusData.products_scraped || 0)
            setShowVnc(false)
            
            // Save bonus card to localStorage
            if (statusData.bonus_card) {
              localStorage.setItem('ah_bonus_card', statusData.bonus_card)
              // Update bonus card context
              if (bonusLogin) {
                bonusLogin(statusData.bonus_card, {
                  ah_email: statusData.email,
                  last_scrape_at: new Date().toISOString()
                })
              }
            }
            
            if (onSyncCompleted) onSyncCompleted()
            return
          }
          
          if (statusData.status === 'error' || statusData.status === 'timeout') {
            setStatus('error')
            setError(statusData.error || 'Scraping failed')
            setShowVnc(false)
            return
          }
          
          // Continue polling
          setTimeout(pollRemoteStatus, 2000)
        } catch (err) {
          console.error('Remote status poll error:', err)
          setTimeout(pollRemoteStatus, 3000)
        }
      }
      
      // Start polling after a short delay
      setTimeout(pollRemoteStatus, 3000)
      
    } catch (err) {
      console.error('Remote scrape failed:', err)
      setError(err.message)
      setStatus('error')
    }
  }, [lang, bonusLogin, onSyncCompleted])

  const formatDate = (dateStr) => {
    if (!dateStr) return null
    try {
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
      }).format(new Date(dateStr))
    } catch (e) {
      return dateStr
    }
  }

  const hasCookies = cookieStatus?.hasCookies
  const isBusy = status === 'connecting' || status === 'syncing'

  // Not available locally - show alternative sync methods
  if (!available) {
    // No remote scraper configured - show bookmarklet and extension options
    if (!remoteAvailable && !RAILWAY_SCRAPER_URL) {
      return (
        <div style={{
          background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
          borderRadius: '16px',
          padding: '2rem',
          color: 'white',
          marginTop: '1rem'
        }}>
          <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.25rem' }}>
            {lang === 'nl' ? 'Sync Methodes' : 'Sync Methods'}
          </h3>
          
          {/* Bookmarklet Option */}
          <div style={{
            background: 'rgba(34, 197, 94, 0.1)',
            border: '1px solid rgba(34, 197, 94, 0.3)',
            borderRadius: '12px',
            padding: '1.25rem',
            marginBottom: '1rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <div style={{
                width: '40px',
                height: '40px',
                background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                borderRadius: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <Bookmark size={20} />
              </div>
              <div>
                <h4 style={{ margin: 0, fontSize: '1rem' }}>
                  {lang === 'nl' ? 'Bookmarklet (Aanbevolen)' : 'Bookmarklet (Recommended)'}
                </h4>
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', opacity: 0.7 }}>
                  {lang === 'nl' ? 'Eén klik sync - geen installatie' : 'One-click sync - no install needed'}
                </p>
              </div>
            </div>
            <a
              href="/bookmarklet.html"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.75rem 1.25rem',
                background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                color: 'white',
                textDecoration: 'none',
                borderRadius: '8px',
                fontWeight: 500,
                fontSize: '0.9rem'
              }}
            >
              <ExternalLink size={16} />
              {lang === 'nl' ? 'Bookmarklet Instellen' : 'Setup Bookmarklet'}
            </a>
          </div>

          {/* Extension Option */}
          <div style={{
            background: 'rgba(139, 92, 246, 0.1)',
            border: '1px solid rgba(139, 92, 246, 0.3)',
            borderRadius: '12px',
            padding: '1.25rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
              <div style={{
                width: '40px',
                height: '40px',
                background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                borderRadius: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <Puzzle size={20} />
              </div>
              <div>
                <h4 style={{ margin: 0, fontSize: '1rem' }}>
                  {lang === 'nl' ? 'Browser Extensie' : 'Browser Extension'}
                </h4>
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', opacity: 0.7 }}>
                  {lang === 'nl' ? 'Chrome/Firefox extensie' : 'Chrome/Firefox extension'}
                </p>
              </div>
            </div>
            <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', opacity: 0.8 }}>
              {lang === 'nl' 
                ? 'Download de extensie map en laad hem als "unpacked extension" in Chrome.' 
                : 'Download the extension folder and load it as an "unpacked extension" in Chrome.'}
            </p>
            <a
              href="https://github.com/MontagueJacobs/albert/tree/main/sustainable-shop-webapp/extension"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.75rem 1.25rem',
                background: 'rgba(139, 92, 246, 0.3)',
                color: 'white',
                textDecoration: 'none',
                borderRadius: '8px',
                fontWeight: 500,
                fontSize: '0.9rem'
              }}
            >
              <ExternalLink size={16} />
              {lang === 'nl' ? 'Download Extensie' : 'Download Extension'}
            </a>
          </div>

          {/* Instructions */}
          <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
            <h4 style={{ margin: '0 0 0.5rem', fontSize: '0.9rem', opacity: 0.9 }}>
              {lang === 'nl' ? 'Hoe het werkt:' : 'How it works:'}
            </h4>
            <ol style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.85rem', opacity: 0.7, lineHeight: 1.6 }}>
              <li>{lang === 'nl' ? 'Ga naar ah.nl en log in' : 'Go to ah.nl and log in'}</li>
              <li>{lang === 'nl' ? 'Ga naar "Eerder gekocht"' : 'Go to "Previously purchased"'}</li>
              <li>{lang === 'nl' ? 'Klik op de bookmarklet of extensie' : 'Click the bookmarklet or extension'}</li>
              <li>{lang === 'nl' ? 'Je producten worden automatisch gesynct!' : 'Your products sync automatically!'}</li>
            </ol>
          </div>
        </div>
      )
    }
    
    // Remote scraper available - show it
    return (
      <div style={{
        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
        borderRadius: '16px',
        padding: '2rem',
        color: 'white',
        marginTop: '1rem'
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
          <div style={{
            width: '56px',
            height: '56px',
            background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
            borderRadius: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Monitor size={28} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.25rem' }}>
              {lang === 'nl' ? 'Remote Browser Sync' : 'Remote Browser Sync'}
            </h3>
            <p style={{ margin: '0.25rem 0 0 0', opacity: 0.7, fontSize: '0.9rem' }}>
              {lang === 'nl' 
                ? 'Log in via een beveiligde browser in de cloud'
                : 'Log in via a secure browser in the cloud'}
            </p>
          </div>
        </div>

        {/* Progress/status messages */}
        {progress && (
          <div style={{
            background: 'rgba(139, 92, 246, 0.15)',
            border: '1px solid rgba(139, 92, 246, 0.3)',
            borderRadius: '12px',
            padding: '1rem',
            marginBottom: '1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem'
          }}>
            <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
            <span>{progress}</span>
          </div>
        )}

        {/* Error display */}
        {error && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '12px',
            padding: '1rem',
            marginBottom: '1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem'
          }}>
            <AlertCircle size={24} style={{ color: '#ef4444' }} />
            <div style={{ color: '#fca5a5' }}>{error}</div>
          </div>
        )}

        {/* Success display */}
        {status === 'success' && (
          <div style={{
            background: 'rgba(34, 197, 94, 0.15)',
            border: '1px solid rgba(34, 197, 94, 0.3)',
            borderRadius: '12px',
            padding: '1rem',
            marginBottom: '1rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem'
          }}>
            <CheckCircle size={24} style={{ color: '#22c55e' }} />
            <div>
              <div style={{ fontWeight: 500 }}>
                {t('sync_success') || 'Sync Complete!'}
              </div>
              <div style={{ fontSize: '0.85rem', opacity: 0.7 }}>
                {productsCount > 0 && `${productsCount} ${t('sync_products_imported') || 'products imported'}`}
              </div>
            </div>
          </div>
        )}

        {/* noVNC Browser Window */}
        {showVnc && remoteSession && (
          <div style={{
            marginBottom: '1rem',
            borderRadius: '12px',
            overflow: 'hidden',
            border: '2px solid rgba(139, 92, 246, 0.5)'
          }}>
            <div style={{
              background: 'rgba(139, 92, 246, 0.2)',
              padding: '0.5rem 1rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <span style={{ fontSize: '0.9rem', opacity: 0.9 }}>
                {lang === 'nl' ? 'AH Browser Venster' : 'AH Browser Window'}
              </span>
              <a 
                href={`${RAILWAY_SCRAPER_URL}/vnc.html`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#a78bfa', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
              >
                <ExternalLink size={14} />
                {lang === 'nl' ? 'Open in nieuw venster' : 'Open in new window'}
              </a>
            </div>
            <iframe
              src={`${RAILWAY_SCRAPER_URL}/vnc.html?autoconnect=true&resize=scale`}
              style={{
                width: '100%',
                height: '500px',
                border: 'none',
                background: '#000'
              }}
              title="Remote Browser"
            />
          </div>
        )}

        {/* Start button */}
        {status === 'idle' && (
          <button
            onClick={handleRemoteScrape}
            style={{
              width: '100%',
              padding: '1rem 1.5rem',
              background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
              border: 'none',
              borderRadius: '12px',
              color: 'white',
              fontWeight: 600,
              fontSize: '1rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem'
            }}
          >
            <Monitor size={20} />
            {lang === 'nl' ? 'Start Remote Sync' : 'Start Remote Sync'}
          </button>
        )}

        {/* How it works */}
        <div style={{ marginTop: '1.5rem', fontSize: '0.9rem', opacity: 0.7 }}>
          <p style={{ margin: '0 0 0.5rem 0', fontWeight: 500 }}>
            {lang === 'nl' ? 'Hoe werkt het:' : 'How it works:'}
          </p>
          <ol style={{ margin: 0, paddingLeft: '1.25rem' }}>
            <li>{lang === 'nl' ? 'Klik op "Start Remote Sync"' : 'Click "Start Remote Sync"'}</li>
            <li>{lang === 'nl' ? 'Een browser venster opent hieronder' : 'A browser window opens below'}</li>
            <li>{lang === 'nl' ? 'Log in op je AH account' : 'Log in to your AH account'}</li>
            <li>{lang === 'nl' ? 'Je aankopen worden automatisch opgehaald' : 'Your purchases are fetched automatically'}</li>
          </ol>
        </div>
      </div>
    )
  }

  return (
    <div style={{
      background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
      borderRadius: '16px',
      padding: '2rem',
      color: 'white',
      marginTop: '1rem'
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
        <div style={{
          width: '56px',
          height: '56px',
          background: 'linear-gradient(135deg, #00a0e2 0%, #0077b3 100%)',
          borderRadius: '12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <ShoppingCart size={28} />
        </div>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.25rem' }}>
            {t('sync_title') || 'Sync Your Purchases'}
          </h3>
          <p style={{ margin: '0.25rem 0 0 0', opacity: 0.7, fontSize: '0.9rem' }}>
            {hasCookies 
              ? (t('sync_connected') || 'Connected to Albert Heijn')
              : (t('sync_not_connected') || 'Connect your AH account to import purchases')
            }
          </p>
        </div>
      </div>

      {/* Connected status */}
      {hasCookies && !isBusy && status !== 'success' && (
        <div style={{
          background: 'rgba(34, 197, 94, 0.15)',
          border: '1px solid rgba(34, 197, 94, 0.3)',
          borderRadius: '12px',
          padding: '1rem',
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <CheckCircle size={24} style={{ color: '#22c55e' }} />
            <div>
              <div style={{ fontWeight: 500 }}>
                {t('sync_account_connected') || 'Account Connected'}
              </div>
              {lastSync && (
                <div style={{ fontSize: '0.85rem', opacity: 0.7 }}>
                  {t('sync_last_sync') || 'Last sync'}: {formatDate(lastSync)}
                  {productsCount > 0 && ` · ${productsCount} ${t('sync_products') || 'products'}`}
                </div>
              )}
            </div>
          </div>
          <button
            onClick={handleDisconnect}
            style={{
              background: 'none',
              border: 'none',
              color: '#ef4444',
              cursor: 'pointer',
              padding: '0.5rem',
              borderRadius: '6px'
            }}
            title={t('sync_disconnect') || 'Disconnect'}
          >
            <Trash2 size={18} />
          </button>
        </div>
      )}

      {/* Progress/Status display */}
      {isBusy && (
        <div style={{
          background: 'rgba(59, 130, 246, 0.15)',
          border: '1px solid rgba(59, 130, 246, 0.3)',
          borderRadius: '12px',
          padding: '1rem',
          marginBottom: '1rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Loader2 size={24} style={{ color: '#3b82f6', animation: 'spin 1s linear infinite' }} />
            <div>
              <div style={{ fontWeight: 500 }}>
                {status === 'connecting' 
                  ? (t('sync_connecting') || 'Connecting...')
                  : (t('sync_syncing') || 'Syncing...')
                }
              </div>
              <div style={{ fontSize: '0.85rem', opacity: 0.7 }}>
                {progress}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Success message */}
      {status === 'success' && (
        <div style={{
          background: 'rgba(34, 197, 94, 0.15)',
          border: '1px solid rgba(34, 197, 94, 0.3)',
          borderRadius: '12px',
          padding: '1rem',
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem'
        }}>
          <CheckCircle size={24} style={{ color: '#22c55e' }} />
          <div>
            <div style={{ fontWeight: 500 }}>
              {t('sync_success') || 'Sync Complete!'}
            </div>
            <div style={{ fontSize: '0.85rem', opacity: 0.7 }}>
              {productsCount > 0 && `${productsCount} ${t('sync_products_imported') || 'products imported'}`}
            </div>
          </div>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div style={{
          background: 'rgba(239, 68, 68, 0.15)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: '12px',
          padding: '1rem',
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem'
        }}>
          <AlertCircle size={24} style={{ color: '#ef4444' }} />
          <div style={{ color: '#fca5a5' }}>{error}</div>
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        {!hasCookies ? (
          // Not connected - show login button
          <button
            onClick={handleLogin}
            disabled={isBusy}
            style={{
              flex: 1,
              padding: '1rem 1.5rem',
              background: 'linear-gradient(135deg, #00a0e2 0%, #0077b3 100%)',
              border: 'none',
              borderRadius: '12px',
              color: 'white',
              fontWeight: 600,
              fontSize: '1rem',
              cursor: isBusy ? 'not-allowed' : 'pointer',
              opacity: isBusy ? 0.6 : 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem'
            }}
          >
            {isBusy ? (
              <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
            ) : (
              <ShoppingCart size={20} />
            )}
            {t('sync_login_button') || 'Login to Albert Heijn'}
          </button>
        ) : (
          // Connected - show sync button
          <button
            onClick={handleSync}
            disabled={isBusy}
            style={{
              flex: 1,
              padding: '1rem 1.5rem',
              background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
              border: 'none',
              borderRadius: '12px',
              color: 'white',
              fontWeight: 600,
              fontSize: '1rem',
              cursor: isBusy ? 'not-allowed' : 'pointer',
              opacity: isBusy ? 0.6 : 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem'
            }}
          >
            {isBusy ? (
              <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
            ) : (
              <RefreshCw size={20} />
            )}
            {t('sync_now_button') || 'Sync Now'}
          </button>
        )}
      </div>

      {/* How it works */}
      {!hasCookies && !isBusy && (
        <div style={{
          marginTop: '1.5rem',
          padding: '1rem',
          background: 'rgba(255,255,255,0.05)',
          borderRadius: '12px',
          fontSize: '0.9rem'
        }}>
          <div style={{ fontWeight: 500, marginBottom: '0.5rem' }}>
            {t('sync_how_it_works') || 'How it works:'}
          </div>
          <ol style={{ margin: 0, paddingLeft: '1.25rem', opacity: 0.8, lineHeight: 1.6 }}>
            <li>{t('sync_step_1') || 'Click the button above to open Albert Heijn login'}</li>
            <li>{t('sync_step_2') || 'Log in with your AH account (handle CAPTCHA if needed)'}</li>
            <li>{t('sync_step_3') || 'Your purchases will be imported automatically'}</li>
          </ol>
        </div>
      )}
    </div>
  )
}

export default AccountSync
