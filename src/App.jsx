import { useState, useEffect, useCallback } from 'react'
import { Leaf, TrendingUp, ShoppingBag, Award, RefreshCw, Search as SearchIcon, Menu, X, ChevronRight, Sparkles, Target, BarChart3, History, HelpCircle } from 'lucide-react'
import Dashboard from './components/Dashboard'
import PurchaseList from './components/PurchaseList'
import HowItWorks from './components/HowItWorks'
import AccountSync from './components/AccountSync'
import ScoreLookup from './components/ScoreLookup'
import BonusCardLanding from './components/BonusCardLanding'
import { AuthProvider } from './lib/authContext'
import { AHUserProvider } from './lib/ahUserContext.jsx'
import { BonusCardProvider, useBonusCard } from './lib/bonusCardContext.jsx'
import { I18nProvider, useI18n, getSavedLang, saveLang } from './i18n.jsx'

// Feature cards for the homepage
const features = [
  {
    id: 'dashboard',
    emoji: '📊',
    titleKey: 'tab_dashboard',
    descKey: 'feature_dashboard_desc',
    color: '#3b82f6'
  },
  {
    id: 'lookup',
    emoji: '🔍',
    titleKey: 'tab_lookup',
    descKey: 'feature_lookup_desc',
    color: '#8b5cf6'
  },
  {
    id: 'sync',
    emoji: '🔄',
    titleKey: 'tab_sync',
    descKey: 'feature_sync_desc',
    color: '#f59e0b'
  },
  {
    id: 'history',
    emoji: '📜',
    titleKey: 'tab_history',
    descKey: 'feature_history_desc',
    color: '#ec4899'
  }
]

function AppShell({ onPurchaseAdded, onSyncCompleted, activeTab, setActiveTab, syncVersion }) {
  const { t, lang, setLang } = useI18n()
  const { bonusCardNumber, isAuthenticated: isBonusAuth, login: bonusLogin, logout: bonusLogout } = useBonusCard()
  const [menuOpen, setMenuOpen] = useState(false)

  const handleToggleLanguage = useCallback(() => {
    const nextLang = lang === 'nl' ? 'en' : 'nl'
    setLang(nextLang)
  }, [lang, setLang])

  const navigateTo = (tab) => {
    setActiveTab(tab)
    setMenuOpen(false)
  }

  // Homepage / Landing view
  if (activeTab === 'home') {
    return (
      <div className="app-wrapper">
        {/* Header */}
        <header className="app-header">
          <button className="menu-toggle" onClick={() => setMenuOpen(!menuOpen)}>
            {menuOpen ? <X size={24} /> : <Menu size={24} />}
            <span>Menu</span>
          </button>
          
          <div className="header-logo">
            <Leaf size={28} className="logo-icon" />
            <span className="logo-text">Sustainable Shop</span>
          </div>
          
          <div className="header-actions">
            <button className="lang-btn" onClick={handleToggleLanguage}>
              {lang === 'nl' ? 'EN' : 'NL'}
            </button>
          </div>
        </header>

        {/* Slide-out Menu */}
        <div className={`slide-menu ${menuOpen ? 'open' : ''}`}>
          <nav className="menu-nav">
            {features.map((feature) => (
              <button
                key={feature.id}
                className="menu-item"
                onClick={() => navigateTo(feature.id)}
              >
                <span className="menu-emoji">{feature.emoji}</span>
                <span className="menu-label">{t(feature.titleKey)}</span>
                <ChevronRight size={18} className="menu-arrow" />
              </button>
            ))}
            <button className="menu-item" onClick={() => navigateTo('how')}>
              <span className="menu-emoji">❓</span>
              <span className="menu-label">{t('tab_how_it_works')}</span>
              <ChevronRight size={18} className="menu-arrow" />
            </button>
          </nav>
        </div>
        {menuOpen && <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />}

        {/* Bonus Card Landing - Main Entry Point */}
        <BonusCardLanding 
          onBonusCardSubmit={(cardNumber, userInfo) => {
            bonusLogin(cardNumber, userInfo)
            navigateTo('dashboard')
          }}
          onStartScrape={() => navigateTo('sync')}
        />

        {/* Feature Cards - shown below landing */}
        <section className="features-section" style={{ marginTop: '1rem' }}>
          <h2 className="section-title">{t('features_title')}</h2>
          <div className="feature-grid">
            {features.map((feature) => (
              <button
                key={feature.id}
                className="feature-card"
                onClick={() => navigateTo(feature.id)}
                style={{ '--card-accent': feature.color }}
              >
                <span className="feature-emoji">{feature.emoji}</span>
                <h3 className="feature-title">{t(feature.titleKey)}</h3>
                <p className="feature-desc">{t(feature.descKey)}</p>
                <span className="feature-link">
                  {t('explore')} <ChevronRight size={16} />
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>
    )
  }

  // Interior page view
  return (
    <div className="app-wrapper">
      {/* Header */}
      <header className="app-header">
        <button className="menu-toggle" onClick={() => setMenuOpen(!menuOpen)}>
          {menuOpen ? <X size={24} /> : <Menu size={24} />}
          <span>Menu</span>
        </button>
        
        <button className="header-logo" onClick={() => setActiveTab('home')}>
          <Leaf size={28} className="logo-icon" />
          <span className="logo-text">Sustainable Shop</span>
        </button>
        
        <div className="header-actions">
          <button className="lang-btn" onClick={handleToggleLanguage}>
            {lang === 'nl' ? 'EN' : 'NL'}
          </button>
        </div>
      </header>

      {/* Slide-out Menu */}
      <div className={`slide-menu ${menuOpen ? 'open' : ''}`}>
        <nav className="menu-nav">
          <button className="menu-item" onClick={() => navigateTo('home')}>
            <span className="menu-emoji">🏠</span>
            <span className="menu-label">{t('home')}</span>
            <ChevronRight size={18} className="menu-arrow" />
          </button>
          {features.map((feature) => (
            <button
              key={feature.id}
              className={`menu-item ${activeTab === feature.id ? 'active' : ''}`}
              onClick={() => navigateTo(feature.id)}
            >
              <span className="menu-emoji">{feature.emoji}</span>
              <span className="menu-label">{t(feature.titleKey)}</span>
              <ChevronRight size={18} className="menu-arrow" />
            </button>
          ))}
          <button 
            className={`menu-item ${activeTab === 'how' ? 'active' : ''}`}
            onClick={() => navigateTo('how')}
          >
            <span className="menu-emoji">❓</span>
            <span className="menu-label">{t('tab_how_it_works')}</span>
            <ChevronRight size={18} className="menu-arrow" />
          </button>
        </nav>
      </div>
      {menuOpen && <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />}

      {/* Page Content */}
      <main className="page-content">
        <div className="breadcrumb">
          <button onClick={() => setActiveTab('home')}>{t('home')}</button>
          <ChevronRight size={14} />
          <span>{t(`tab_${activeTab === 'how' ? 'how_it_works' : activeTab}`)}</span>
        </div>
        
        <div className="content-card">
          {activeTab === 'dashboard' && <Dashboard syncVersion={syncVersion} />}
          {activeTab === 'lookup' && <ScoreLookup />}
          {activeTab === 'sync' && <AccountSync onSyncCompleted={onSyncCompleted} />}
          {activeTab === 'history' && <PurchaseList syncVersion={syncVersion} />}
          {activeTab === 'how' && <HowItWorks />}
        </div>
      </main>
    </div>
  )
}

function App() {
  // Read initial tab from URL hash (e.g., #dashboard)
  const [activeTab, setActiveTab] = useState(() => {
    const hash = window.location.hash.slice(1) // Remove #
    const validTabs = ['home', 'dashboard', 'lookup', 'sync', 'history', 'how']
    return validTabs.includes(hash) ? hash : 'home'
  })
  const [lang, setLang] = useState(() => getSavedLang())
  const [syncVersion, setSyncVersion] = useState(0)

  // Sync activeTab with URL hash
  useEffect(() => {
    // Update hash when tab changes
    if (activeTab !== 'home') {
      window.location.hash = activeTab
    } else {
      // Clear hash for home
      if (window.location.hash) {
        history.replaceState(null, '', window.location.pathname)
      }
    }
  }, [activeTab])

  // Listen for browser back/forward navigation
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1)
      const validTabs = ['home', 'dashboard', 'lookup', 'sync', 'history', 'how']
      setActiveTab(validTabs.includes(hash) ? hash : 'home')
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  const handleSetLang = useCallback((value) => {
    const next = value === 'en' ? 'en' : 'nl'
    saveLang(next)
    setLang(next)
  }, [])

  // Purchases and insights are now fetched at the component level
  // (Dashboard, PurchaseList) using authenticated endpoints
  // This keeps the App component simpler

  const handlePurchaseAdded = useCallback(() => {
    setSyncVersion((prev) => prev + 1)
  }, [])

  const handleSyncCompleted = useCallback(() => {
    setSyncVersion((prev) => prev + 1)
  }, [])

  return (
    <AuthProvider>
      <AHUserProvider>
        <BonusCardProvider>
          <I18nProvider lang={lang} setLang={handleSetLang}>
            <AppShell
              onPurchaseAdded={handlePurchaseAdded}
              onSyncCompleted={handleSyncCompleted}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              syncVersion={syncVersion}
            />
          </I18nProvider>
        </BonusCardProvider>
      </AHUserProvider>
    </AuthProvider>
  )
}

export default App
