import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from './supabaseClient'

// Session ID key (matches ahUserContext.jsx)
const SESSION_ID_KEY = 'ah_session_id'

const AuthContext = createContext({
  user: null,
  session: null,
  loading: true,
  signIn: async () => {},
  signUp: async () => {},
  signOut: async () => {},
  getAccessToken: () => null
})

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      setLoading(false)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  const signIn = useCallback(async (email, password) => {
    if (!supabase) throw new Error('Supabase not configured')
    
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    })
    
    if (error) throw error
    return data
  }, [])

  const signUp = useCallback(async (email, password, displayName) => {
    if (!supabase) throw new Error('Supabase not configured')
    
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName }
      }
    })
    
    if (error) throw error
    return data
  }, [])

  const signOut = useCallback(async () => {
    if (!supabase) return
    
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }, [])

  const getAccessToken = useCallback(() => {
    return session?.access_token ?? null
  }, [session])

  const value = {
    user,
    session,
    loading,
    signIn,
    signUp,
    signOut,
    getAccessToken,
    isAuthenticated: !!user
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

// Helper hook for authenticated API calls
// Supports both JWT auth (Supabase) and session-based auth (X-Session-ID)
export function useAuthenticatedFetch() {
  const { getAccessToken } = useAuth()
  
  return useCallback(async (url, options = {}) => {
    const token = getAccessToken()
    const sessionId = localStorage.getItem(SESSION_ID_KEY)
    
    const headers = {
      ...options.headers,
      'Content-Type': 'application/json'
    }
    
    // Add JWT token if available
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
    
    // Also add session ID for session-based auth fallback
    if (sessionId) {
      headers['X-Session-ID'] = sessionId
    }
    
    return fetch(url, {
      ...options,
      headers
    })
  }, [getAccessToken])
}

export default AuthContext
