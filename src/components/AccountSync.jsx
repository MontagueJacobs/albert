import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { RefreshCw, Loader2 } from 'lucide-react'
import { useI18n } from '../i18n.jsx'

function AccountSync({ onSyncCompleted }) {
  const { t } = useI18n()
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState(null)
  const [hostedGuide, setHostedGuide] = useState(false)
  const [ingestKey, setIngestKey] = useState('')
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

  // Load/save ingest key locally (used to generate bookmarklet with embedded key)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('ah_ingest_key') || ''
      if (saved) setIngestKey(saved)
    } catch (_) {
      // ignore
    }
  }, [])

  useEffect(() => {
    try {
      if (ingestKey) localStorage.setItem('ah_ingest_key', ingestKey)
    } catch (_) {
      // ignore
    }
  }, [ingestKey])

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
      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'scrape' })
      })
      if (res.status === 409) {
        setError(t('sync_conflict'))
      } else if (res.status === 501) {
        // Hosted env (e.g., Vercel) cannot run interactive scraping
        setError('Interactive scraping is not supported on the hosted version. Use the browser bookmarklet below to scrape from the AH site, then we will ingest to your account automatically.')
        setHostedGuide(true)
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

  // Hosted-friendly bookmarklet approach (no extension required)
  const BOOKMARKLET_HREF = useMemo(() => {
    const api = 'https://albert-eosin.vercel.app'
    // Safely embed the key; if empty, the bookmarklet will prompt on first use
    const embeddedKey = ingestKey ? JSON.stringify(ingestKey) : "''"
    const code = (
      `(()=>{try{const API='${api}';const KEY=${embeddedKey};function ex(){const links=document.querySelectorAll('a[href^="/producten/product/"], article a[href^="/producten/product/"]');const items=[];const seen=new Set();links.forEach(a=>{const url=new URL(a.href,location.origin).toString();if(seen.has(url))return;seen.add(url);let name=a.getAttribute('aria-label')||a.textContent||'';name=name.replace(/\\s+/g,' ').trim();if(!name){const title=a.closest('article')?.querySelector('[data-testhook="product-title"], h3, h2');name=(title?.textContent||'').trim()}const card=a.closest('article')||a.closest('[data-testhook="product-card"]')||a.parentElement;let price=null;const priceEl=card?.querySelector('[data-testhook="product-price"], [class*="price"], span:has(> sup)');const raw=priceEl?.textContent?.replace(',', '.').match(/(\\d+(\\.\\d{1,2})?)/);if(raw)price=parseFloat(raw[1]);const imgEl=card?.querySelector('img');const image=imgEl?.src||'';if(name){items.push({name,url,price,image,source:'ah_bonus'})}});return items}const items=ex();if(!items.length){alert('No products found yet. Scroll to load more and try again.');return}let ingest_key = KEY && typeof KEY==='string' && KEY.trim()? KEY.trim(): (localStorage.getItem('ah_ingest_key')||'').trim();if(!ingest_key){ingest_key=prompt('Enter your ingest key from the app');if(!ingest_key){alert('Ingest cancelled: no key provided');return}try{localStorage.setItem('ah_ingest_key',ingest_key)}catch(_){}}fetch(API+'/api/ingest/scrape',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ingest_key,items,source:'ah_bonus',scraped_at:new Date().toISOString()})}).then(r=>r.json().then(d=>({ok:r.ok,data:d,status:r.status}))).then(({ok,data,status})=>{if(!ok){const msg=(data&&data.error)||data?.detail||('ingest_failed ('+status+')');throw new Error(msg)}alert('Uploaded '+((data&&data.stored)||items.length)+' items.')}).catch(e=>{console.error('Scrape upload failed:',e);alert('Upload failed: '+e.message)})}catch(e){alert('Error: '+e.message)}})()`
    )
      .replace(/\n/g, '')
      .replace(/\s{2,}/g, ' ')
    return `javascript:${code}`
  }, [ingestKey])

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
      {hostedGuide && (
        <div style={{ border: '1px dashed #b5c2ff', background: '#f7f9ff', color: '#283a89', borderRadius: '12px', padding: '1rem', marginBottom: '1rem' }}>
          <h4 style={{ marginTop: 0, marginBottom: '0.5rem' }}>Scrape via bookmarklet (no install)</h4>
          <ol style={{ margin: 0, paddingLeft: '1.25rem' }}>
            <li>
              Open AH earlier-purchased page: {' '}
              <a href="https://www.ah.nl/bonus/eerder-gekocht" target="_blank" rel="noreferrer">ah.nl/bonus/eerder-gekocht</a>
            </li>
            <li>Make sure you’re logged in and scroll to load products.</li>
            <li>
              Drag this button to your bookmarks bar: {' '}
              <a href={BOOKMARKLET_HREF} style={{ padding: '0.35rem 0.6rem', borderRadius: '8px', background: '#3b82f6', color: '#fff', textDecoration: 'none' }}>AH: Scrape this page</a>
              <div style={{ fontSize: '0.85rem', color: '#49557a', marginTop: '0.4rem' }}>
                Tip: If you can’t see the bookmarks bar, press Ctrl+Shift+B (Windows/Linux) or Cmd+Shift+B (macOS).
              </div>
            </li>
            <li>On the AH page, click the bookmarklet you just saved. We’ll upload the items to your account automatically.</li>
          </ol>
          <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: '#eef3ff', borderRadius: '8px' }}>
            <div style={{ fontWeight: 600, marginBottom: '0.35rem' }}>Your ingest key</div>
            <div style={{ fontSize: '0.9rem', color: '#3a4784', marginBottom: '0.35rem' }}>
              Paste your personal ingest key here to embed it into the bookmarklet. If left empty, the bookmarklet will prompt for it the first time.
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input
                value={ingestKey}
                onChange={(e) => setIngestKey(e.target.value)}
                placeholder="paste ingest key"
                style={{ flex: 1, padding: '0.5rem 0.6rem', border: '1px solid #cbd5ff', borderRadius: '8px' }}
              />
              <button
                type="button"
                onClick={() => { try { navigator.clipboard.writeText(ingestKey || '') } catch (_) {} }}
                className="btn"
                style={{ padding: '0.45rem 0.7rem' }}
              >Copy</button>
            </div>
          </div>
        </div>
      )}
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
