import { useState, useEffect, useCallback, useRef } from 'react'
import { Loader2, ShoppingCart, CheckCircle, AlertCircle, RefreshCw, ExternalLink, User } from 'lucide-react'
import { useI18n } from '../i18n.jsx'
import { useAHUser, useAHFetch } from '../lib/ahUserContext'

// Helper function to format error messages for users
const formatError = (error) => {
  const errorMap = {
    'login_timeout': 'Login timed out. Please try again.',
    'login_required': 'Login required. The session may have expired.',
    'operation_in_progress': 'Another sync is already running. Please wait.',
    'not_supported_on_hosted': 'Visual login is only available when running locally.',
    'script_missing': 'Scraper script not found. Please check the installation.',
    'spawn_failed': 'Failed to start the browser. Please try again.'
  }
  return errorMap[error] || error
}

/**
 * EasyConnect - Simplified one-click AH account connection
 * 
 * Flow:
 * 1. User clicks "Connect AH Account"
 * 2. Browser window opens to AH login page
 * 3. User logs in (solves CAPTCHA if needed)
 * 4. We detect success, save cookies, and scrape products
 * 5. Future syncs: one-click "Sync Now" button
 */
function EasyConnect({ onSyncCompleted }) {
  const { t } = useI18n()
  const { ahEmail } = useAHUser()
  const ahFetch = useAHFetch()
  
  const [status, setStatus] = useState('idle') // 'idle', 'connecting', 'syncing', 'success', 'error'
  const [progress, setProgress] = useState('')
  const [error, setError] = useState(null)
  const [connectionStatus, setConnectionStatus] = useState(null) // AH account connection status
  const [lastSync, setLastSync] = useState(null)
  const [productsCount, setProductsCount] = useState(0)
  const pollRef = useRef(null)

  // Fetch AH connection status on mount
  const fetchConnectionStatus = useCallback(async () => {
    try {
      // Check cookies
      const cookieRes = await fetch('/api/auto-scrape/cookies')
      const cookieData = await cookieRes.json()
      
      // Check saved credentials (if have ahEmail)
      let savedCreds = null
      if (ahEmail) {
        try {
          const credRes = await ahFetch('/api/user/ah-credentials')
          if (credRes.ok) {
            savedCreds = await credRes.json()
          }
        } catch (e) {
          // Ignore
        }
      }
      
      // Check scrape status
      const statusRes = await fetch('/api/auto-scrape/status')
      const statusData = await statusRes.json()
      
      setConnectionStatus({
        hasCookies: cookieData?.hasCookies || false,
        cookieCount: cookieData?.cookieCount || 0,
        savedEmail: savedCreds?.ah_email || null,
        lastSyncAt: savedCreds?.last_sync_at || statusData?.lastRun?.completedAt || null,
        syncStatus: savedCreds?.sync_status || (statusData?.lastRun?.status) || null,
        productsStored: statusData?.lastRun?.productsStored || 0
      })
      
      if (statusData?.lastRun?.productsStored) {
        setProductsCount(statusData.lastRun.productsStored)
      }
      
      if (statusData?.running) {
        setStatus('syncing')
        setProgress(statusData.progress || 'Syncing...')
      }
      
    } catch (err) {
      console.error('Failed to fetch connection status:', err)
    }
  }, [ahEmail, ahFetch])

  useEffect(() => {
    fetchConnectionStatus()
  }, [fetchConnectionStatus])

  // Poll for status updates while syncing
  useEffect(() => {
    if (status === 'connecting' || status === 'syncing') {
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch('/api/auto-scrape/status')
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
              fetchConnectionStatus()
              if (onSyncCompleted) onSyncCompleted()
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
  }, [status, fetchConnectionStatus, onSyncCompleted])

  // Start visual login flow (opens browser window)
  const handleConnect = useCallback(async () => {
    setStatus('connecting')
    setError(null)
    setProgress('Opening browser window...')
    
    try {
      // Use ahFetch to send email header so purchases are saved to their account
      const res = await ahFetch('/api/auto-scrape/visual-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      
      if (res.status === 501) {
        setError('Visual login is only available when running locally.')
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
      console.error('Connect failed:', err)
      setError(err.message)
      setStatus('error')
    }
  }, [ahFetch])

  // Quick resync using saved cookies
  const handleResync = useCallback(async () => {
    setStatus('syncing')
    setError(null)
    setProgress('Starting sync...')
    
    try {
      // Use ahFetch to send email header so purchases are saved to their account
      const res = await ahFetch('/api/auto-scrape/with-cookies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      
      if (res.status === 400) {
        // Cookies expired, need to reconnect
        setError('Session expired. Please reconnect your account.')
        setStatus('idle')
        setConnectionStatus(prev => ({ ...prev, hasCookies: false }))
        return
      }
      
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to start sync')
      }
      
      setProgress('Syncing your purchases...')
      // Polling will take over from here
      
    } catch (err) {
      console.error('Resync failed:', err)
      setError(err.message)
      setStatus('error')
    }
  }, [ahFetch])

  // Disconnect (clear cookies)
  const handleDisconnect = useCallback(async () => {
    try {
      await fetch('/api/auto-scrape/cookies', { method: 'DELETE' })
      setConnectionStatus(prev => ({ ...prev, hasCookies: false }))
      setProductsCount(0)
    } catch (err) {
      console.error('Disconnect failed:', err)
    }
  }, [])

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

  const isConnected = connectionStatus?.hasCookies
  const isBusy = status === 'connecting' || status === 'syncing'

  return (
    <div style={{
      background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
      borderRadius: '16px',
      padding: '2rem',
      color: 'white'
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
            {isConnected ? 'Albert Heijn Connected' : 'Connect Albert Heijn'}
          </h3>
          <p style={{ margin: '0.25rem 0 0 0', opacity: 0.7, fontSize: '0.9rem' }}>
            {isConnected 
              ? `${productsCount} products synced`
              : 'Import your purchase history automatically'
            }
          </p>
        </div>
      </div>

      {/* Connection Status */}
      {isConnected && connectionStatus?.savedEmail && (
        <div style={{
          background: 'rgba(255,255,255,0.1)',
          borderRadius: '8px',
          padding: '0.75rem 1rem',
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem'
        }}>
          <User size={18} style={{ opacity: 0.7 }} />
          <span style={{ fontSize: '0.9rem' }}>{connectionStatus.savedEmail}</span>
          {connectionStatus.lastSyncAt && (
            <span style={{ marginLeft: 'auto', opacity: 0.6, fontSize: '0.8rem' }}>
              Last sync: {formatDate(connectionStatus.lastSyncAt)}
            </span>
          )}
        </div>
      )}

      {/* Progress indicator */}
      {isBusy && (
        <div style={{
          background: 'rgba(255,255,255,0.1)',
          borderRadius: '8px',
          padding: '1rem',
          marginBottom: '1rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
            <span>{progress}</span>
          </div>
          {status === 'connecting' && (
            <p style={{ margin: '0.75rem 0 0 0', opacity: 0.7, fontSize: '0.85rem' }}>
              A browser window will open. Please log in to your AH account.
            </p>
          )}
        </div>
      )}

      {/* Success message */}
      {status === 'success' && (
        <div style={{
          background: 'rgba(34, 197, 94, 0.2)',
          border: '1px solid rgba(34, 197, 94, 0.3)',
          borderRadius: '8px',
          padding: '1rem',
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem'
        }}>
          <CheckCircle size={20} style={{ color: '#22c55e' }} />
          <span>Successfully synced {productsCount} products!</span>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div style={{
          background: 'rgba(239, 68, 68, 0.2)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: '8px',
          padding: '1rem',
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem'
        }}>
          <AlertCircle size={20} style={{ color: '#ef4444', flexShrink: 0 }} />
          <div>
            <span>{formatError(error)}</span>
            {(error === 'login_timeout' || error.includes('timeout')) && (
              <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.85rem', opacity: 0.8 }}>
                Tip: Make sure to complete the login in the browser window that opens. You have 5 minutes.
              </p>
            )}
            {(error === 'login_required' || error.includes('login_required')) && (
              <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.85rem', opacity: 0.8 }}>
                Tip: The session may have expired. Try connecting again.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        {!isConnected ? (
          <button
            onClick={handleConnect}
            disabled={isBusy}
            style={{
              flex: 1,
              padding: '0.875rem 1.5rem',
              background: 'linear-gradient(135deg, #00a0e2 0%, #0077b3 100%)',
              color: 'white',
              border: 'none',
              borderRadius: '10px',
              fontSize: '1rem',
              fontWeight: 600,
              cursor: isBusy ? 'not-allowed' : 'pointer',
              opacity: isBusy ? 0.7 : 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              transition: 'transform 0.2s, box-shadow 0.2s',
              boxShadow: '0 4px 14px rgba(0, 160, 226, 0.3)'
            }}
            onMouseOver={e => !isBusy && (e.currentTarget.style.transform = 'translateY(-2px)')}
            onMouseOut={e => e.currentTarget.style.transform = 'translateY(0)'}
          >
            {isBusy ? (
              <>
                <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
                Connecting...
              </>
            ) : (
              <>
                <ExternalLink size={20} />
                Connect AH Account
              </>
            )}
          </button>
        ) : (
          <>
            <button
              onClick={handleResync}
              disabled={isBusy}
              style={{
                flex: 1,
                padding: '0.875rem 1.5rem',
                background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                color: 'white',
                border: 'none',
                borderRadius: '10px',
                fontSize: '1rem',
                fontWeight: 600,
                cursor: isBusy ? 'not-allowed' : 'pointer',
                opacity: isBusy ? 0.7 : 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                transition: 'transform 0.2s, box-shadow 0.2s',
                boxShadow: '0 4px 14px rgba(34, 197, 94, 0.3)'
              }}
              onMouseOver={e => !isBusy && (e.currentTarget.style.transform = 'translateY(-2px)')}
              onMouseOut={e => e.currentTarget.style.transform = 'translateY(0)'}
            >
              {isBusy ? (
                <>
                  <Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} />
                  Syncing...
                </>
              ) : (
                <>
                  <RefreshCw size={20} />
                  Sync Now
                </>
              )}
            </button>
            <button
              onClick={handleDisconnect}
              disabled={isBusy}
              style={{
                padding: '0.875rem 1rem',
                background: 'rgba(255,255,255,0.1)',
                color: 'white',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: '10px',
                fontSize: '0.9rem',
                cursor: isBusy ? 'not-allowed' : 'pointer',
                opacity: isBusy ? 0.5 : 1
              }}
            >
              Disconnect
            </button>
          </>
        )}
      </div>

      {/* Help text */}
      {!isConnected && !isBusy && (
        <p style={{
          margin: '1rem 0 0 0',
          fontSize: '0.85rem',
          opacity: 0.6,
          textAlign: 'center'
        }}>
          A browser window will open where you can securely log in to Albert Heijn.
          <br />
          Your credentials stay in your browser - we only save the session.
        </p>
      )}
    </div>
  )
}

export default EasyConnect
