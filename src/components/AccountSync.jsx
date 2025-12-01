import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { RefreshCw, Loader2 } from 'lucide-react'
import { useI18n } from '../i18n.jsx'

function AccountSync({ onSyncCompleted }) {
  const { t } = useI18n()
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState(null)
  const pollRef = useRef(null)
  const lastCompletedRef = useRef(null)

  const statusFormatter = useMemo(() => new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }), [])

  const formatDateTime = useCallback((value) => {
    if (!value) return null
    try {
      return statusFormatter.format(new Date(value))
    } catch (_err) {
      return value
    }
  }, [statusFormatter])

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/sync/status')
      if (!res.ok) throw new Error('status request failed')
      const json = await res.json()
      setStatus(json)
      setError(null)
    } catch (err) {
      console.error('Failed to fetch sync status:', err)
      setError(t('sync_error_status'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  useEffect(() => {
    if (!status) return

    if (status.running) {
      if (!pollRef.current) {
        pollRef.current = setInterval(() => {
          fetchStatus()
        }, 3000)
      }
    } else if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }

    const completedAt = status?.lastRun?.completedAt
    if (!status.running && completedAt && completedAt !== lastCompletedRef.current) {
      lastCompletedRef.current = completedAt
      if (typeof onSyncCompleted === 'function') {
        onSyncCompleted()
      }
    }
  }, [status, fetchStatus, onSyncCompleted])

  useEffect(() => () => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const handleStart = useCallback(async () => {
    if (starting || status?.running) return
    setStarting(true)
    setError(null)

    try {
      const res = await fetch('/api/sync', { method: 'POST' })
      if (res.status === 409) {
        setError(t('sync_conflict'))
      } else if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        throw new Error(payload?.error || 'failed to start sync')
      } else {
        fetchStatus()
      }
    } catch (err) {
      console.error('Failed to start sync:', err)
      setError(t('sync_error_generic'))
    } finally {
      setStarting(false)
    }
  }, [starting, status, fetchStatus, t])

  const logs = status?.logs ?? []
  const lastRun = status?.lastRun
  const durationLabel = lastRun?.durationMs ? `${(lastRun.durationMs / 1000).toFixed(1)}s` : 'N/A'
  const lastRunSummary = lastRun
    ? `${lastRun.status === 'success' ? t('sync_last_run_success') : t('sync_last_run_error')} · ${formatDateTime(lastRun.completedAt) || 'N/A'}`
    : t('sync_last_run_never')

  const currentStatus = status?.running ? t('sync_status_running') : t('sync_status_idle')
  const buttonDisabled = starting || status?.running
  const logLines = logs.slice(-30).map((entry) => {
    const timestamp = formatDateTime(entry.timestamp) || entry.timestamp
    const level = entry.stream.toUpperCase()
    return `[${timestamp}] ${level}: ${entry.message}`
  })

  return (
    <section style={{ marginTop: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <div>
          <h3 style={{ margin: 0 }}>{t('sync_title')}</h3>
          <p style={{ marginTop: '0.35rem', color: '#555', maxWidth: '640px' }}>{t('sync_description')}</p>
          <p style={{ marginTop: '0.25rem', fontSize: '0.85rem', color: '#777' }}>{t('sync_requires_auth')}</p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleStart}
          disabled={buttonDisabled}
          style={{ minWidth: '180px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
        >
          {buttonDisabled ? <Loader2 size={18} className="spin" /> : <RefreshCw size={18} />}
          {buttonDisabled ? t('sync_button_running') : t('sync_button')}
        </button>
      </div>

      {error && <div style={{ color: '#c0392b', marginBottom: '0.75rem' }}>{error}</div>}
      {status?.running && <div style={{ color: '#555', marginBottom: '0.75rem' }}>{t('sync_running_hint')}</div>}

      <div style={{ border: '1px solid #e6e6e6', borderRadius: '12px', padding: '1rem', background: '#fff' }}>
        {loading && !status ? (
          <div>{t('loading')}</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
            <div>
              <div style={{ fontSize: '0.8rem', color: '#666' }}>{t('sync_status_label')}</div>
              <div style={{ fontWeight: 600 }}>{currentStatus}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.8rem', color: '#666' }}>{t('sync_last_run_label')}</div>
              <div style={{ fontWeight: 600 }}>{lastRunSummary}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.8rem', color: '#666' }}>{t('sync_started_label')}</div>
              <div style={{ fontWeight: 600 }}>{formatDateTime(lastRun?.startedAt) || 'N/A'}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.8rem', color: '#666' }}>{t('sync_completed_label')}</div>
              <div style={{ fontWeight: 600 }}>{formatDateTime(lastRun?.completedAt) || 'N/A'}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.8rem', color: '#666' }}>{t('sync_duration_label')}</div>
              <div style={{ fontWeight: 600 }}>{durationLabel}</div>
            </div>
          </div>
        )}

        <div style={{ marginTop: '1.25rem' }}>
          <h4 style={{ marginBottom: '0.5rem' }}>{t('sync_logs_label')}</h4>
          <div style={{ border: '1px solid #f0f0f0', background: '#fafafa', borderRadius: '8px', maxHeight: '220px', overflowY: 'auto', padding: '0.75rem' }}>
            {logLines.length === 0 ? (
              <div style={{ color: '#777', fontSize: '0.9rem' }}>{t('sync_no_logs')}</div>
            ) : (
              <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: '0.8rem', whiteSpace: 'pre-wrap' }}>
                {logLines.join('\n')}
              </pre>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

export default AccountSync
