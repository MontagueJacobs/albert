import { useState, useEffect, useCallback } from 'react'
import { Leaf, TrendingUp, ShoppingBag, Award, RefreshCw, Search as SearchIcon } from 'lucide-react'
import AddPurchase from './components/AddPurchase'
import Dashboard from './components/Dashboard'
import PurchaseList from './components/PurchaseList'
import ProfileSuggestions from './components/ProfileSuggestions'
import HowItWorks from './components/HowItWorks'
import AccountSync from './components/AccountSync'
import ScoreLookup from './components/ScoreLookup'
import { I18nProvider, useI18n, getSavedLang, saveLang } from './i18n.jsx'

function AppShell({ onPurchaseAdded, onSyncCompleted, activeTab, setActiveTab, purchases, insights, syncVersion }) {
  const { t, lang, setLang } = useI18n()

  const handleToggleLanguage = useCallback(() => {
    const nextLang = lang === 'nl' ? 'en' : 'nl'
    setLang(nextLang)
  }, [lang, setLang])

  return (
    <div className="container">
      <div className="header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1>
            <Leaf size={40} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '10px' }} />
            {t('app_title')}
          </h1>
          <p>{t('app_subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={handleToggleLanguage}
          className="btn btn-secondary"
          aria-label={t('toggle_language_aria')}
        >
          {t('toggle_language')}
        </button>
      </div>

      <div className="tabs">
        <button
          className={`tab ${activeTab === 'add' ? 'active' : ''}`}
          onClick={() => setActiveTab('add')}
        >
          <ShoppingBag size={18} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '5px' }} />
          {t('tab_add')}
        </button>

        <button
          className={`tab ${activeTab === 'dashboard' ? 'active' : ''}`}
          onClick={() => setActiveTab('dashboard')}
        >
          <TrendingUp size={18} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '5px' }} />
          {t('tab_dashboard')}
        </button>

        <button
          className={`tab ${activeTab === 'suggestions' ? 'active' : ''}`}
          onClick={() => setActiveTab('suggestions')}
        >
          <Leaf size={18} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '5px' }} />
          {t('tab_suggestions')}
        </button>

        <button
          className={`tab ${activeTab === 'lookup' ? 'active' : ''}`}
          onClick={() => setActiveTab('lookup')}
        >
          <SearchIcon size={18} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '5px' }} />
          {t('tab_lookup')}
        </button>

        <button
          className={`tab ${activeTab === 'sync' ? 'active' : ''}`}
          onClick={() => setActiveTab('sync')}
        >
          <RefreshCw size={18} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '5px' }} />
          {t('tab_sync')}
        </button>

        <button
          className={`tab ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          <Award size={18} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '5px' }} />
          {t('tab_history')}
        </button>

        <button
          className={`tab ${activeTab === 'how' ? 'active' : ''}`}
          onClick={() => setActiveTab('how')}
        >
          <Leaf size={18} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '5px' }} />
          {t('tab_how_it_works')}
        </button>
      </div>

      {activeTab === 'add' && <AddPurchase onPurchaseAdded={onPurchaseAdded} />}
      {activeTab === 'dashboard' && <Dashboard insights={insights} />}
      {activeTab === 'suggestions' && <ProfileSuggestions refreshKey={syncVersion} />}
      {activeTab === 'lookup' && <ScoreLookup />}
      {activeTab === 'sync' && <AccountSync onSyncCompleted={onSyncCompleted} />}
      {activeTab === 'history' && <PurchaseList purchases={purchases} />}
      {activeTab === 'how' && <HowItWorks />}
    </div>
  )
}

function App() {
  const [activeTab, setActiveTab] = useState('add')
  const [purchases, setPurchases] = useState([])
  const [insights, setInsights] = useState(null)
  const [lang, setLang] = useState(() => getSavedLang())
  const [syncVersion, setSyncVersion] = useState(0)

  const fetchPurchases = useCallback(async () => {
    try {
      const response = await fetch('/api/purchases')
      const data = await response.json()
      setPurchases(data)
    } catch (error) {
      console.error('Error fetching purchases:', error)
    }
  }, [])

  const fetchInsights = useCallback(async () => {
    try {
      const response = await fetch('/api/insights')
      const data = await response.json()
      setInsights(data)
    } catch (error) {
      console.error('Error fetching insights:', error)
    }
  }, [])

  useEffect(() => {
    fetchPurchases()
    fetchInsights()
  }, [fetchPurchases, fetchInsights])

  const handlePurchaseAdded = useCallback(() => {
    fetchPurchases()
    fetchInsights()
  }, [fetchPurchases, fetchInsights])

  const handleSyncCompleted = useCallback(() => {
    fetchPurchases()
    fetchInsights()
    setSyncVersion((prev) => prev + 1)
  }, [fetchPurchases, fetchInsights])

  const handleSetLang = useCallback((value) => {
    const next = value === 'en' ? 'en' : 'nl'
    saveLang(next)
    setLang(next)
  }, [])

  return (
    <I18nProvider lang={lang} setLang={handleSetLang}>
      <AppShell
        onPurchaseAdded={handlePurchaseAdded}
        onSyncCompleted={handleSyncCompleted}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        purchases={purchases}
        insights={insights}
        syncVersion={syncVersion}
      />
    </I18nProvider>
  )
}

export default App
