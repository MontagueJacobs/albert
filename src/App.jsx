import { useState, useEffect, useCallback } from 'react'
import { Leaf, TrendingUp, ShoppingBag, Award, RefreshCw, Search as SearchIcon, Menu, X, ChevronRight, Sparkles, Target, BarChart3, History, HelpCircle, LogOut } from 'lucide-react'
import Dashboard from './components/Dashboard'
import PurchaseList from './components/PurchaseList'
import ProfileSuggestions from './components/ProfileSuggestions'
import HowItWorks from './components/HowItWorks'
import AccountSync from './components/AccountSync'
import ScoreLookup from './components/ScoreLookup'
import AHLanding from './components/AHLanding'
import { AHUserProvider, useAHUser } from './lib/ahUserContext'
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
    id: 'suggestions',
    emoji: '🌱',
    titleKey: 'tab_suggestions',
    descKey: 'feature_suggestions_desc',
    color: '#22c55e'
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
  const { ahEmail, clearEmail } = useAHUser()
  const [menuOpen, setMenuOpen] = useState(false)

  const handleToggleLanguage = useCallback(() => {
    const nextLang = lang === 'nl' ? 'en' : 'nl'
    setLang(nextLang)
  }, [lang, setLang])

  const navigateTo = (tab) => {
    setActiveTab(tab)
    setMenuOpen(false)
  }

  // Show landing page if no AH email is set
  if (!ahEmail) {
    return (
      <div className="app-wrapper">
        <header className="app-header">
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
        
        <AHLanding />
      </div>
    )
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
            <div className="user-email-display">
              <span className="user-email">{ahEmail}</span>
              <button className="logout-btn" onClick={clearEmail} title="Log out">
                <LogOut size={16} />
              </button>
            </div>
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

        {/* Hero Section */}
        <section className="hero">
          <div className="hero-content">
            <h1 className="hero-title">{t('app_title')}</h1>
            <p className="hero-subtitle">{t('app_subtitle')}</p>
            <div className="hero-cta">
              <button className="btn btn-primary btn-lg" onClick={() => navigateTo('sync')}>
                <RefreshCw size={20} />
                {t('get_started')}
              </button>
              <button className="btn btn-outline btn-lg" onClick={() => navigateTo('how')}>
                {t('learn_more')}
              </button>
            </div>
          </div>
          <div className="hero-visual">
            <div className="hero-icon-circle">
              <Leaf size={80} />
            </div>
          </div>
        </section>

        {/* Feature Cards */}
        <section className="features-section">
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
          <div className="user-email-display">
            <span className="user-email">{ahEmail}</span>
            <button className="logout-btn" onClick={clearEmail} title="Log out">
              <LogOut size={16} />
            </button>
          </div>
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
          {activeTab === 'dashboard' && <Dashboard />}
          {activeTab === 'suggestions' && <ProfileSuggestions refreshKey={syncVersion} />}
          {activeTab === 'lookup' && <ScoreLookup />}
          {activeTab === 'sync' && <AccountSync onSyncCompleted={onSyncCompleted} />}
          {activeTab === 'history' && <PurchaseList />}
          {activeTab === 'how' && <HowItWorks />}
        </div>
      </main>
    </div>
  )
}

function App() {
  const [activeTab, setActiveTab] = useState(() => {
    try {
      return localStorage.getItem('activeTab') || 'home'
    } catch {
      return 'home'
    }
  })
  const [lang, setLang] = useState(() => getSavedLang())
  const [syncVersion, setSyncVersion] = useState(0)

  // Persist active tab to localStorage
  const handleSetActiveTab = useCallback((tab) => {
    setActiveTab(tab)
    try {
      localStorage.setItem('activeTab', tab)
    } catch {
      // Ignore storage errors
    }
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
    <AHUserProvider>
      <I18nProvider lang={lang} setLang={handleSetLang}>
        <AppShell
          onPurchaseAdded={handlePurchaseAdded}
          onSyncCompleted={handleSyncCompleted}
          activeTab={activeTab}
          setActiveTab={handleSetActiveTab}
          syncVersion={syncVersion}
        />
      </I18nProvider>
    </AHUserProvider>
  )
}

export default App
