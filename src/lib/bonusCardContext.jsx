import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const BonusCardContext = createContext(null)

export function BonusCardProvider({ children }) {
  const [bonusCardNumber, setBonusCardNumber] = useState(null)
  const [userInfo, setUserInfo] = useState(null)
  const [loading, setLoading] = useState(true)
  
  // Check localStorage on mount
  useEffect(() => {
    const savedCard = localStorage.getItem('ah_bonus_card')
    if (savedCard) {
      setBonusCardNumber(savedCard)
      fetchUserInfo(savedCard)
    } else {
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
        // Card not found in system
        localStorage.removeItem('ah_bonus_card')
        setBonusCardNumber(null)
      }
    } catch (err) {
      console.error('Failed to fetch bonus user info:', err)
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
