import { useState, useEffect, useCallback } from 'react'
import { TrendingUp, ShoppingBag, Award, RefreshCw, Search as SearchIcon, Menu, X, ChevronRight, Sparkles, Target, BarChart3, HelpCircle, FlaskConical } from 'lucide-react'
import Dashboard from './components/Dashboard'
import ProductCatalog from './components/ProductCatalog'
import HowItWorks from './components/HowItWorks'
import ScoreLookup from './components/ScoreLookup'
import BonusCardLanding from './components/BonusCardLanding'
import Questionnaire from './components/Questionnaire'
import ExperimentFlow from './components/ExperimentFlow'
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
    id: 'experiment',
    emoji: '🧪',
    titleKey: 'tab_experiment',
    descKey: 'feature_experiment_desc',
    color: '#f59e0b'
  },
  {
    id: 'catalog',
    emoji: '🛒',
    titleKey: 'tab_catalog',
    descKey: 'feature_catalog_desc',
    color: '#16a34a'
  }
]

function AppShell({ onPurchaseAdded, onSyncCompleted, activeTab, setActiveTab, syncVersion, questionnaireType, theme, toggleTheme }) {
  const { t, lang, setLang } = useI18n()
  const isNl = lang === 'nl'
  const { bonusCardNumber, isAuthenticated: isBonusAuth, login: bonusLogin, logout: bonusLogout, resetSession, websiteVariant, setVariantOverride } = useBonusCard()
  const [menuOpen, setMenuOpen] = useState(false)

  const handleToggleLanguage = useCallback(() => {
    const nextLang = lang === 'nl' ? 'en' : 'nl'
    setLang(nextLang)
  }, [lang, setLang])

  // ThemeToggle kept for future use — currently XP is the only active theme
  // const ThemeToggle = () => (
  //   <button className="theme-toggle-btn" onClick={toggleTheme} title={theme === 'xp' ? 'Switch to dark theme' : 'Switch to XP theme'}>
  //     {theme === 'xp' ? '🌙' : '🪟'}
  //     <span>{theme === 'xp' ? 'Dark' : 'XP'}</span>
  //   </button>
  // )

  // ABToggle hidden — A/B testing disabled, variant A forced
  // const ABToggle = () => (
  //   <button
  //     className="theme-toggle-btn"
  //     onClick={() => setVariantOverride(websiteVariant === 'A' ? 'B' : 'A')}
  //     title={`Currently variant ${websiteVariant || '?'} — click to switch`}
  //     style={{ minWidth: 'auto' }}
  //   >
  //     <span style={{ fontSize: '0.75rem', fontWeight: 700 }}>{websiteVariant === 'B' ? 'B' : 'A'}</span>
  //     <span>A/B</span>
  //   </button>
  // )

  const navigateTo = (tab) => {
    setActiveTab(tab)
    setMenuOpen(false)
  }

  // Handle questionnaire completion
  const handleQuestionnaireComplete = (responses) => {
    if (questionnaireType === 'pre') {
      // After pre-questionnaire, navigate to dashboard
      setActiveTab('dashboard')
      window.location.hash = 'dashboard'
    } else {
      // After post-questionnaire, go back home
      setActiveTab('home')
      window.location.hash = ''
    }
  }

  // Questionnaire page - full screen, no menu
  if (activeTab === 'questionnaire') {
    return (
      <div className="app-wrapper">
        <header className="app-header">
          <div className="header-logo">
            <img src="/radboud-logo.png" alt="Radboud Universiteit" className="radboud-logo" />
          </div>
          <div className="header-actions">
            {/* <ABToggle /> */}
            <button className="lang-btn" onClick={handleToggleLanguage}>
              {lang === 'nl' ? 'EN' : 'NL'}
            </button>
            <button className="exit-btn" onClick={resetSession} title={isNl ? 'Sessie beëindigen' : 'End session'}>
              {isNl ? 'Exit' : 'Exit'}
            </button>
          </div>
        </header>
        <main className="page-content">
          <Questionnaire 
            type={questionnaireType || 'pre'} 
            onComplete={handleQuestionnaireComplete}
          />
        </main>
      </div>
    )
  }

  // Experiment page - full screen, no menu
  if (activeTab === 'experiment') {
    return (
      <div className="app-wrapper">
        <header className="app-header">
          <div className="header-logo">
            <img src="/radboud-logo.png" alt="Radboud Universiteit" className="radboud-logo" />
          </div>
          <div className="header-actions">
            {/* <ABToggle /> */}
            <button className="lang-btn" onClick={handleToggleLanguage}>
              {lang === 'nl' ? 'EN' : 'NL'}
            </button>
            <button className="exit-btn" onClick={resetSession} title={isNl ? 'Sessie beëindigen' : 'End session'}>
              {isNl ? 'Exit' : 'Exit'}
            </button>
          </div>
        </header>
        <main className="page-content">
          <ExperimentFlow 
            onComplete={() => {
              setActiveTab('dashboard')
              window.location.hash = 'dashboard'
            }}
            onBack={() => {
              setActiveTab('home')
              window.location.hash = ''
            }}
          />
        </main>
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
            <img src="/radboud-logo.png" alt="Radboud Universiteit" className="radboud-logo" />
          </div>
          
          <div className="header-actions">
            {/* <ABToggle /> */}
            <button className="lang-btn" onClick={handleToggleLanguage}>
              {lang === 'nl' ? 'EN' : 'NL'}
            </button>
            <button className="exit-btn" onClick={resetSession} title={isNl ? 'Sessie beëindigen' : 'End session'}>
              {isNl ? 'Exit' : 'Exit'}
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
          onAutoLogin={(cardNumber, userInfo) => {
            bonusLogin(cardNumber, userInfo)
          }}
          onStartScrape={() => window.location.href = '/bookmarklet.html'}
        />

        {/* Feature Cards - shown below landing */}
        <section className="features-section" style={{ marginTop: '1rem' }}>
          <h2 className="section-title">{t('features_title')}</h2>
          <div className="feature-grid">
            {features.map((feature) => (
              <button
                key={feature.id}
                className="feature-card"
                onClick={() => feature.href ? window.location.href = feature.href : navigateTo(feature.id)}
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
          <img src="/radboud-logo.png" alt="Radboud Universiteit" className="radboud-logo" />
        </button>
        
        <div className="header-actions">
          {/* <ABToggle /> */}
          <button className="lang-btn" onClick={handleToggleLanguage}>
            {lang === 'nl' ? 'EN' : 'NL'}
          </button>
          <button className="exit-btn" onClick={resetSession} title={isNl ? 'Sessie beëindigen' : 'End session'}>
            {isNl ? 'Exit' : 'Exit'}
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
          {activeTab === 'catalog' && <ProductCatalog />}
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
    // Handle questionnaire with params like #questionnaire?type=pre
    const tabPart = hash.split('?')[0]
    const validTabs = ['home', 'dashboard', 'lookup', 'catalog', 'how', 'questionnaire', 'experiment']
    return validTabs.includes(tabPart) ? tabPart : 'home'
  })
  
  // Extract questionnaire type from URL (pre or post)
  const [questionnaireType, setQuestionnaireType] = useState(() => {
    const hash = window.location.hash.slice(1)
    const params = new URLSearchParams(hash.split('?')[1] || '')
    return params.get('type') || 'pre'
  })
  
  const [lang, setLang] = useState(() => getSavedLang())
  const [syncVersion, setSyncVersion] = useState(0)

  // Theme state — persisted in localStorage
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('app-theme') || 'xp'
  })

  // Apply data-theme attribute to <html>
  useEffect(() => {
    if (theme === 'xp') {
      document.documentElement.setAttribute('data-theme', 'xp')
    } else {
      document.documentElement.removeAttribute('data-theme')
    }
    localStorage.setItem('app-theme', theme)
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === 'xp' ? 'dark' : 'xp')
  }, [])

  // Sync activeTab with URL hash
  useEffect(() => {
    // Update hash when tab changes
    if (activeTab === 'questionnaire') {
      window.location.hash = `questionnaire?type=${questionnaireType}`
    } else if (activeTab === 'experiment') {
      window.location.hash = 'experiment'
    } else if (activeTab !== 'home') {
      window.location.hash = activeTab
    } else {
      // Clear hash for home
      if (window.location.hash) {
        history.replaceState(null, '', window.location.pathname + window.location.search)
      }
    }
  }, [activeTab, questionnaireType])

  // Listen for browser back/forward navigation
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.slice(1)
      const tabPart = hash.split('?')[0]
      const validTabs = ['home', 'dashboard', 'lookup', 'catalog', 'how', 'questionnaire', 'experiment']
      setActiveTab(validTabs.includes(tabPart) ? tabPart : 'home')
      
      // Update questionnaire type if on questionnaire page
      if (tabPart === 'questionnaire') {
        const params = new URLSearchParams(hash.split('?')[1] || '')
        setQuestionnaireType(params.get('type') || 'pre')
      }
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
              questionnaireType={questionnaireType}
              theme={theme}
              toggleTheme={toggleTheme}
            />
          </I18nProvider>
        </BonusCardProvider>
      </AHUserProvider>
    </AuthProvider>
  )
}

export default App
