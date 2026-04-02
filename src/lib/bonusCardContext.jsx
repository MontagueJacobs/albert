import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const BonusCardContext = createContext(null)

// Helper to extract card from URL (runs synchronously)
function getCardFromUrl() {
  const urlParams = new URLSearchParams(window.location.search)
  const cardFromUrl = urlParams.get('card')
  if (cardFromUrl && /^\d{13}$/.test(cardFromUrl)) {
    return cardFromUrl
  }
  return null
}

// Helper to get saved card from localStorage
function getSavedCard() {
  try {
    const saved = localStorage.getItem('ah_bonus_card')
    if (saved && /^\d{13}$/.test(saved)) {
      return saved
    }
  } catch (e) {}
  return null
}

export function BonusCardProvider({ children }) {
  // Initialize state synchronously from URL first, then localStorage
  // This ensures the correct card is available immediately on first render
  const [bonusCardNumber, setBonusCardNumber] = useState(() => {
    const fromUrl = getCardFromUrl()
    const fromStorage = getSavedCard()
    
    // URL always takes priority - this handles redirects with new cards
    if (fromUrl) {
      console.log('[BonusCard] Initial state from URL:', fromUrl.slice(-4))
      // Check if URL card differs from stored card - clear old data
      if (fromStorage && fromStorage !== fromUrl) {
        console.log('[BonusCard] New card from URL differs from stored card, switching')
      }
      // Save new card to localStorage immediately
      try {
        localStorage.setItem('ah_bonus_card', fromUrl)
      } catch (e) {}
      return fromUrl
    }
    
    // No URL param, use localStorage
    if (fromStorage) {
      console.log('[BonusCard] Initial state from localStorage:', fromStorage.slice(-4))
      return fromStorage
    }
    
    console.log('[BonusCard] No card found in URL or localStorage')
    return null
  })
  const [userInfo, setUserInfo] = useState(null)
  const [loading, setLoading] = useState(true)
  
  // Clean URL and fetch user info on mount
  useEffect(() => {
    // If card came from URL, clean up the URL
    const cardFromUrl = getCardFromUrl()
    if (cardFromUrl) {
      console.log('[BonusCard] Cleaning URL, card:', cardFromUrl.slice(-4))
      // Clean up URL (remove ?card= param but keep hash)
      const newUrl = window.location.pathname + window.location.hash
      window.history.replaceState({}, '', newUrl)
    }
    
    // Fetch user info if we have a card
    if (bonusCardNumber) {
      console.log('[BonusCard] Fetching user info for card:', bonusCardNumber.slice(-4))
      fetchUserInfo(bonusCardNumber)
    } else {
      setLoading(false)
    }
  }, []) // Only run once on mount - card is already set synchronously
  
  // Watch for URL changes (e.g., if user navigates back with a ?card= param)
  useEffect(() => {
    const handleUrlChange = () => {
      const cardFromUrl = getCardFromUrl()
      if (cardFromUrl && cardFromUrl !== bonusCardNumber) {
        console.log('[BonusCard] URL change detected, new card:', cardFromUrl.slice(-4))
        setBonusCardNumber(cardFromUrl)
        localStorage.setItem('ah_bonus_card', cardFromUrl)
        fetchUserInfo(cardFromUrl)
      }
    }
    
    window.addEventListener('popstate', handleUrlChange)
    return () => window.removeEventListener('popstate', handleUrlChange)
  }, [bonusCardNumber])
  
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
      websiteVariant: userInfo?.website_variant || null,
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
