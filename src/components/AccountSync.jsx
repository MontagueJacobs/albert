import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { RefreshCw, Loader2, BookOpen, Zap } from 'lucide-react'
import { useI18n } from '../i18n.jsx'
import EasyConnect from './EasyConnect.jsx'
import AutoScrape from './AutoScrape.jsx'

function AccountSync({ onSyncCompleted }) {
  const { t } = useI18n()
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState(null)
  const [hostedGuide, setHostedGuide] = useState(false)
  const [scrapeMode, setScrapeMode] = useState('easy') // 'easy', 'auto' or 'manual'
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

  const handleStart = useCallback(() => {
    setHostedGuide(true)
  }, [])

  const logs = status?.logs ?? []
  const lastRun = status?.lastRun
  const durationLabel = lastRun?.durationMs ? `${(lastRun.durationMs / 1000).toFixed(1)}s` : 'N/A'
  const lastRunSummary = lastRun
    ? `${lastRun.status === 'success' ? t('sync_last_run_success') : t('sync_last_run_error')} · ${formatDateTime(lastRun.completedAt) || 'N/A'}`
    : t('sync_last_run_never')

  const currentStatus = status?.running ? t('sync_status_running') : t('sync_status_idle')
  const buttonDisabled = false
  const logLines = logs.slice(-30).map((entry) => {
    const timestamp = formatDateTime(entry.timestamp) || entry.timestamp
    const level = entry.stream.toUpperCase()
    return `[${timestamp}] ${level}: ${entry.message}`
  })

  // Hosted-friendly bookmarklet approach (no extension required)
  const BOOKMARKLET_HREF = useMemo(() => {
    const api = 'https://albert-eosin.vercel.app'
    const code = `(()=>{try{const API='${api}';function ex(){const links=document.querySelectorAll('a[href^="/producten/product/"], article a[href^="/producten/product/"]');const items=[];const seen=new Set();links.forEach(a=>{const url=new URL(a.href,location.origin).toString();if(seen.has(url))return;seen.add(url);let name=a.getAttribute('aria-label')||a.textContent||'';name=name.replace(/\\s+/g,' ').trim();if(!name){const title=a.closest('article')?.querySelector('[data-testhook="product-title"], h3, h2');name=(title?.textContent||'').trim()}const card=a.closest('article')||a.closest('[data-testhook="product-card"]')||a.parentElement;let price=null;const priceEl=card?.querySelector('[data-testhook="product-price"], [class*="price"], span:has(> sup)');const raw=priceEl?.textContent?.replace(',', '.').match(/(\\d+(\\.\\d{1,2})?)/);if(raw)price=parseFloat(raw[1]);const imgEl=card?.querySelector('img');const image=imgEl?.src||'';if(name){items.push({name,url,price,image,source:'ah_bonus'})}});return items}const items=ex();if(!items.length){alert('No products found yet. Scroll to load more and try again.');return}fetch(API+'/api/ingest/scrape',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items,source:'ah_bonus',scraped_at:new Date().toISOString()})}).then(r=>r.json().then(d=>({ok:r.ok,data:d}))).then(({ok,data})=>{if(!ok)throw new Error((data&&data.error)||'ingest_failed');alert('Uploaded '+((data&&data.stored)||items.length)+' items.')}).catch(e=>{console.error('Scrape upload failed:',e);alert('Upload failed: '+e.message)})}catch(e){alert('Error: '+e.message)}})()`
      .replace(/\n/g, '')
      .replace(/\s{2,}/g, ' ')
    return `javascript:${code}`
  }, [])

  return (
    <section style={{ marginTop: '1.5rem' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ margin: '0 0 0.5rem 0' }}>{t('sync_title')}</h3>
        <p style={{ margin: 0, color: '#aaa', maxWidth: '640px' }}>{t('sync_description')}</p>
      </div>

      {/* Mode toggle tabs */}
      <div style={{ 
        display: 'flex', 
        gap: '0.5rem', 
        marginBottom: '1.5rem',
        borderBottom: '2px solid #333',
        paddingBottom: '0'
      }}>
        <button
          type="button"
          onClick={() => setScrapeMode('easy')}
          style={{
            padding: '0.75rem 1.25rem',
            border: 'none',
            background: 'none',
            cursor: 'pointer',
            fontWeight: 500,
            fontSize: '0.95rem',
            color: scrapeMode === 'easy' ? '#3b82f6' : '#888',
            borderBottom: scrapeMode === 'easy' ? '2px solid #3b82f6' : '2px solid transparent',
            marginBottom: '-2px',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}
        >
          <Zap size={18} />
          Easy Connect
        </button>
        <button
          type="button"
          onClick={() => setScrapeMode('auto')}
          style={{
            padding: '0.75rem 1.25rem',
            border: 'none',
            background: 'none',
            cursor: 'pointer',
            fontWeight: 500,
            fontSize: '0.95rem',
            color: scrapeMode === 'auto' ? '#3b82f6' : '#888',
            borderBottom: scrapeMode === 'auto' ? '2px solid #3b82f6' : '2px solid transparent',
            marginBottom: '-2px',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}
        >
          <RefreshCw size={18} />
          {t('sync_mode_auto')}
        </button>
        <button
          type="button"
          onClick={() => setScrapeMode('manual')}
          style={{
            padding: '0.75rem 1.25rem',
            border: 'none',
            background: 'none',
            cursor: 'pointer',
            fontWeight: 500,
            fontSize: '0.95rem',
            color: scrapeMode === 'manual' ? '#3b82f6' : '#888',
            borderBottom: scrapeMode === 'manual' ? '2px solid #3b82f6' : '2px solid transparent',
            marginBottom: '-2px',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}
        >
          <BookOpen size={18} />
          {t('sync_mode_manual')}
        </button>
      </div>

      {/* Easy Connect mode - recommended */}
      {scrapeMode === 'easy' && (
        <EasyConnect onSyncCompleted={onSyncCompleted} />
      )}

      {/* Auto-scrape mode (advanced) */}
      {scrapeMode === 'auto' && (
        <AutoScrape onScrapeCompleted={onSyncCompleted} />
      )}

      {/* Manual/Bookmarklet mode */}
      {scrapeMode === 'manual' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div>
              <p style={{ marginTop: '0.25rem', fontSize: '0.85rem', color: 'var(--text-muted, #9ca3af)' }}>{t('sync_requires_auth')}</p>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleStart}
              disabled={buttonDisabled}
              style={{ minWidth: '180px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
            >
              <RefreshCw size={18} />
              {hostedGuide ? t('sync_button') : t('sync_show_guide')}
            </button>
          </div>

          {error && <div style={{ color: '#ef4444', marginBottom: '0.75rem' }}>{error}</div>}
          {hostedGuide && (
            <div style={{ border: '1px dashed rgba(99, 102, 241, 0.5)', background: 'rgba(99, 102, 241, 0.1)', color: 'var(--text, #f3f4f6)', borderRadius: '12px', padding: '1rem', marginBottom: '1rem' }}>
              <h4 style={{ marginTop: 0, marginBottom: '0.5rem', color: 'var(--text, #f3f4f6)' }}>{t('sync_bookmarklet_title')}</h4>
              <ol style={{ margin: 0, paddingLeft: '1.25rem', color: 'var(--text-muted, #9ca3af)' }}>
                <li>
                  {t('sync_bookmarklet_step1')}{' '}
                  <a href="https://www.ah.nl/bonus/eerder-gekocht" target="_blank" rel="noreferrer" style={{ color: '#60a5fa' }}>ah.nl/bonus/eerder-gekocht</a>
                </li>
                <li>{t('sync_bookmarklet_step2')}</li>
                <li>
                  {t('sync_bookmarklet_step3')}{' '}
                  <a href={BOOKMARKLET_HREF} style={{ padding: '0.35rem 0.6rem', borderRadius: '8px', background: '#3b82f6', color: '#fff', textDecoration: 'none' }}>AH: Scrape this page</a>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted, #9ca3af)', marginTop: '0.4rem' }}>
                    {t('sync_bookmarklet_tip')}
                  </div>
                </li>
                <li>{t('sync_bookmarklet_step4')}</li>
              </ol>
            </div>
          )}
          {status?.running && <div style={{ color: 'var(--text-muted, #9ca3af)', marginBottom: '0.75rem' }}>{t('sync_running_hint')}</div>}

          <div style={{ border: '1px solid var(--border, #334155)', borderRadius: '12px', padding: '1rem', background: 'var(--bg-card, #1e293b)' }}>
            {loading && !status ? (
              <div style={{ color: 'var(--text, #f3f4f6)' }}>{t('loading')}</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
                <div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted, #9ca3af)' }}>{t('sync_status_label')}</div>
                  <div style={{ fontWeight: 600, color: 'var(--text, #f3f4f6)' }}>{currentStatus}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted, #9ca3af)' }}>{t('sync_last_run_label')}</div>
                  <div style={{ fontWeight: 600, color: 'var(--text, #f3f4f6)' }}>{lastRunSummary}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted, #9ca3af)' }}>{t('sync_started_label')}</div>
                  <div style={{ fontWeight: 600, color: 'var(--text, #f3f4f6)' }}>{formatDateTime(lastRun?.startedAt) || 'N/A'}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted, #9ca3af)' }}>{t('sync_completed_label')}</div>
                  <div style={{ fontWeight: 600, color: 'var(--text, #f3f4f6)' }}>{formatDateTime(lastRun?.completedAt) || 'N/A'}</div>
                </div>
                <div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted, #9ca3af)' }}>{t('sync_duration_label')}</div>
                  <div style={{ fontWeight: 600, color: 'var(--text, #f3f4f6)' }}>{durationLabel}</div>
                </div>
              </div>
            )}

            <div style={{ marginTop: '1.25rem' }}>
              <h4 style={{ marginBottom: '0.5rem', color: 'var(--text, #f3f4f6)' }}>{t('sync_logs_label')}</h4>
              <div style={{ border: '1px solid var(--border, #334155)', background: 'var(--bg-hover, #334155)', borderRadius: '8px', maxHeight: '220px', overflowY: 'auto', padding: '0.75rem' }}>
                {logLines.length === 0 ? (
                  <div style={{ color: 'var(--text-muted, #9ca3af)', fontSize: '0.9rem' }}>{t('sync_no_logs')}</div>
                ) : (
                  <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: '0.8rem', whiteSpace: 'pre-wrap', color: 'var(--text, #f3f4f6)' }}>
                    {logLines.join('\n')}
                  </pre>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  )
}

export default AccountSync
