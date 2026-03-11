import { createContext, useContext, useEffect, useState, useCallback } from 'react'

/**
 * Simple AH Email-based "authentication"
 * - No password required
 * - Just identifies user by their AH email
 * - Stored in localStorage for persistence
 */

const AHUserContext = createContext({
  ahEmail: null,
  isIdentified: false,
  loading: true,
  setAHEmail: () => {},
  clearAHEmail: () => {},
})

const STORAGE_KEY = 'ah_user_email'

export function AHUserProvider({ children }) {
  const [ahEmail, setAHEmailState] = useState(null)
  const [loading, setLoading] = useState(true)

  // Load from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      setAHEmailState(stored)
    }
    setLoading(false)
  }, [])

  const setAHEmail = useCallback((email) => {
    if (email) {
      localStorage.setItem(STORAGE_KEY, email)
      setAHEmailState(email)
    }
  }, [])

  const clearAHEmail = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    setAHEmailState(null)
  }, [])

  const value = {
    ahEmail,
    isIdentified: !!ahEmail,
    loading,
    setAHEmail,
    clearAHEmail,
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
 * Custom fetch that adds ah_email header for API calls
 */
export function useAHFetch() {
  const { ahEmail } = useAHUser()
  
  return useCallback(async (url, options = {}) => {
    const headers = {
      ...options.headers,
    }
    
    if (ahEmail) {
      headers['X-AH-Email'] = ahEmail
    }
    
    return fetch(url, {
      ...options,
      headers,
    })
  }, [ahEmail])
}
