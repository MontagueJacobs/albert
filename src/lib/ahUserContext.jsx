import { createContext, useContext, useEffect, useState, useCallback } from 'react'

/**
 * Anonymous session-based user context
 * - No login required
 * - Auto-generates a persistent session ID on first visit
 * - Users scrape their purchases which populate their account
 * - Session ID stored in localStorage for persistence
 */

const AHUserContext = createContext({
  sessionId: null,
  isReady: false,
  loading: true,
  resetSession: () => {},
})

const STORAGE_KEY = 'ah_session_id'

// Generate a random session ID
function generateSessionId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let result = 'sess_'
  for (let i = 0; i < 24; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

export function AHUserProvider({ children }) {
  const [sessionId, setSessionId] = useState(null)
  const [loading, setLoading] = useState(true)

  // Load or create session ID on mount
  useEffect(() => {
    let stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) {
      // First visit - generate new session ID
      stored = generateSessionId()
      localStorage.setItem(STORAGE_KEY, stored)
      console.log('[Session] Created new session:', stored)
    } else {
      console.log('[Session] Loaded existing session:', stored)
    }
    setSessionId(stored)
    setLoading(false)
  }, [])

  // Reset session (clears data and creates new session)
  const resetSession = useCallback(() => {
    const newId = generateSessionId()
    localStorage.setItem(STORAGE_KEY, newId)
    setSessionId(newId)
    console.log('[Session] Reset to new session:', newId)
  }, [])

  const value = {
    sessionId,
    isReady: !!sessionId,
    loading,
    resetSession,
    // Backwards compatibility
    ahEmail: sessionId,
    isIdentified: !!sessionId,
    setAHEmail: () => {}, // no-op
    clearAHEmail: resetSession,
  }

  return (
    <AHUserContext.Provider value={value}>
      {children}
    </AHUserContext.Provider>
  )
}

export function useAHUser() {
  const context = useContext(AHUserContext)
  if (!context) {
    throw new Error('useAHUser must be used within AHUserProvider')
  }
  return context
}

/**
 * Custom fetch that adds session ID header for API calls
 */
export function useAHFetch() {
  const { sessionId } = useAHUser()
  
  return useCallback(async (url, options = {}) => {
    const headers = {
      ...options.headers,
    }
    
    if (sessionId) {
      headers['X-Session-ID'] = sessionId
    }
    
    return fetch(url, {
      ...options,
      headers,
    })
  }, [sessionId])
}
