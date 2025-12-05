import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient.js'

function Auth({ onProfileReady }) {
  const [user, setUser] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!supabase) return
    const current = supabase.auth.getUser().then(({ data }) => setUser(data?.user || null))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null)
    })
    return () => sub?.subscription?.unsubscribe?.()
  }, [])

  const signInWithGoogle = useCallback(async () => {
    if (!supabase) {
      setError('Supabase not configured')
      return
    }
    setError(null)
    setLoading(true)
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({ provider: 'google' })
      if (error) throw error
      // Redirect handled by Supabase; after return, onAuthStateChange will fire
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const signOut = useCallback(async () => {
    if (!supabase) return
    await supabase.auth.signOut()
  }, [])

  useEffect(() => {
    // When userss is present, ensure a profile row exists server-side and get ingest_key
    const ensureProfile = async () => {
      if (!user) return
      try {
        // Try to fetch profile via server using a stored ingest key (if any)
        // If missing, create via /api/profile/register and persist the key locally
        const storedKey = localStorage.getItem('ah_ingest_key') || ''
        let ingest_key = storedKey
        if (storedKey) {
          const res = await fetch(`/api/profile?ingest_key=${encodeURIComponent(storedKey)}`)
          if (res.ok) {
            const data = await res.json()
            ingest_key = data.ingest_key
          } else {
            ingest_key = ''
          }
        }
        if (!ingest_key) {
          const res = await fetch('/api/profile/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ display_name: user.email || user.user_metadata?.name || null })
          })
          const data = await res.json()
          if (!res.ok) throw new Error(data?.error || 'profile_register_failed')
          ingest_key = data.ingest_key
          localStorage.setItem('ah_ingest_key', ingest_key)
        }
        onProfileReady?.({ ingest_key })
      } catch (e) {
        console.error('Profile ensure failed:', e)
      }
    }
    ensureProfile()
  }, [user, onProfileReady])

  if (!supabase) return null
  return (
    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
      {user ? (
        <>
          <span style={{ fontSize: '0.9rem', color: '#444' }}>{user.email || 'Signed in'}</span>
          <button className="btn btn-secondary" onClick={signOut}>Sign out</button>
        </>
      ) : (
        <button className="btn btn-secondary" onClick={signInWithGoogle} disabled={loading}>
          {loading ? 'Redirecting…' : 'Sign in with Google'}
        </button>
      )}
      {error && <span style={{ color: '#c0392b', marginLeft: '0.5rem' }}>{error}</span>}
    </div>
  )
}

export default Auth
