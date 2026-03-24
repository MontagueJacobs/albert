import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const BonusCardContext = createContext(null)

export function BonusCardProvider({ children }) {
  const [bonusCardNumber, setBonusCardNumber] = useState(null)
  const [userInfo, setUserInfo] = useState(null)
  const [loading, setLoading] = useState(true)
  
  // Check URL param and localStorage on mount
  useEffect(() => {
    // First check URL for ?card= parameter (from bookmarklet redirect)
    const urlParams = new URLSearchParams(window.location.search)
    const cardFromUrl = urlParams.get('card')
    
    // Bonus cards must be exactly 13 digits
    if (cardFromUrl && /^\d{13}$/.test(cardFromUrl)) {
      console.log('[BonusCard] Found valid card in URL:', cardFromUrl.slice(-4))
      // Save to localStorage and use it
      localStorage.setItem('ah_bonus_card', cardFromUrl)
      setBonusCardNumber(cardFromUrl)
      fetchUserInfo(cardFromUrl)
      // Clean up URL (remove ?card= param)
      const newUrl = window.location.pathname + window.location.hash
      window.history.replaceState({}, '', newUrl)
      return
    }
    
    // Otherwise check localStorage - validate format
    const savedCard = localStorage.getItem('ah_bonus_card')
    if (savedCard && /^\d{13}$/.test(savedCard)) {
      console.log('[BonusCard] Found valid card in localStorage:', savedCard.slice(-4))
      setBonusCardNumber(savedCard)
      fetchUserInfo(savedCard)
    } else {
      if (savedCard) {
        console.warn('[BonusCard] Invalid card format in localStorage:', savedCard?.length, 'chars - clearing')
        localStorage.removeItem('ah_bonus_card')
      }
      setLoading(false)
    }
  }, [])
  
  const fetchUserInfo = async (cardNumber) => {
    setLoading(true)
    try {
      const response = await fetch(`/api/bonus/${cardNumber}/user`)
      if (response.ok) {
        const data = await response.json()
        setUserInfo(data)
      } else {
        // User info not found, but keep the card number - purchases might still exist
        // The user can still view their purchases even without an ah_bonus_users record
        console.log('[BonusCard] User info not found, but keeping card for purchase lookups')
        setUserInfo(null)
      }
    } catch (err) {
      console.error('Failed to fetch bonus user info:', err)
      // Keep the card number even on error
      setUserInfo(null)
    } finally {
      setLoading(false)
    }
  }
  
  const login = useCallback((cardNumber, info = null) => {
    setBonusCardNumber(cardNumber)
    localStorage.setItem('ah_bonus_card', cardNumber)
    if (info) {
      setUserInfo(info)
    } else {
      fetchUserInfo(cardNumber)
    }
  }, [])
  
  const logout = useCallback(() => {
    setBonusCardNumber(null)
    setUserInfo(null)
    localStorage.removeItem('ah_bonus_card')
  }, [])
  
  const refresh = useCallback(() => {
    if (bonusCardNumber) {
      fetchUserInfo(bonusCardNumber)
    }
  }, [bonusCardNumber])
  
  // API fetch helper that uses bonus card
  const bonusFetch = useCallback(async (endpoint, options = {}) => {
    if (!bonusCardNumber) {
      throw new Error('No bonus card number')
    }
    
    // Replace /api/user/... with /api/bonus/:cardNumber/...
    let url = endpoint
    if (endpoint.startsWith('/api/user/')) {
      const path = endpoint.replace('/api/user/', '')
      url = `/api/bonus/${bonusCardNumber}/${path}`
    }
    
    return fetch(url, options)
  }, [bonusCardNumber])
  
  return (
    <BonusCardContext.Provider value={{
      bonusCardNumber,
      userInfo,
      loading,
      isAuthenticated: !!bonusCardNumber,
      login,
      logout,
      refresh,
      bonusFetch,
    }}>
      {children}
    </BonusCardContext.Provider>
  )
}

export function useBonusCard() {
  const context = useContext(BonusCardContext)
  if (!context) {
    throw new Error('useBonusCard must be used within a BonusCardProvider')
  }
  return context
}
