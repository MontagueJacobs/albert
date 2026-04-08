import { useState, useEffect } from 'react'
import { ChevronRight, ChevronDown, ChevronUp, Lightbulb, BarChart3, Leaf, Flame } from 'lucide-react'
import { useI18n } from '../i18n.jsx'
import QuizResultsReview from './QuizResultsReview.jsx'

// CO2 data for the learning page - values from Our World in Data (Poore & Nemecek 2018)
// Must match the OWID_EMISSIONS values used by the quiz scoring engine (server/co2Emissions.js)
// Sorted by CO2 descending (highest first)
const CO2_CATEGORIES = [
  { 
    name: 'Beef', nameNl: 'Rundvlees', 
    co2: 99.48, emoji: '🥩', color: '#ef4444',
    tip: 'Beef has by far the highest CO₂ footprint due to methane, land use, and low feed efficiency.',
    tipNl: 'Rundvlees heeft veruit de hoogste CO₂-voetafdruk door methaan, landgebruik en lage voederefficiëntie.'
  },
  { 
    name: 'Dark Chocolate', nameNl: 'Pure Chocolade', 
    co2: 46.65, emoji: '🍫', color: '#ef4444',
    tip: 'Cocoa farming drives deforestation, making chocolate one of the highest-emission foods.',
    tipNl: 'Cacaoteelt veroorzaakt ontbossing, waardoor chocolade een van de hoogste uitstoot heeft.'
  },
  { 
    name: 'Lamb', nameNl: 'Lamsvlees', 
    co2: 39.72, emoji: '🍖', color: '#ef4444',
    tip: 'Lamb produces very high emissions due to methane from digestion and low feed efficiency.',
    tipNl: 'Lamsvlees produceert zeer hoge uitstoot door methaan uit de spijsvertering en lage voederefficiëntie.'
  },
  { 
    name: 'Cheese', nameNl: 'Kaas', 
    co2: 23.88, emoji: '🧀', color: '#f97316',
    tip: 'It takes ~10 liters of milk to make 1 kg of cheese, concentrating the emissions.',
    tipNl: 'Er is ~10 liter melk nodig om 1 kg kaas te maken, wat de uitstoot concentreert.'
  },
  { 
    name: 'Pork', nameNl: 'Varkensvlees', 
    co2: 12.31, emoji: '🥓', color: '#eab308',
    tip: 'Pork has a much lower footprint than beef, about 3x less.',
    tipNl: 'Varkensvlees heeft een veel lagere voetafdruk dan rundvlees, ongeveer 3x minder.'
  },
  { 
    name: 'Chicken', nameNl: 'Kip', 
    co2: 9.87, emoji: '🍗', color: '#eab308',
    tip: 'Chicken is one of the lowest-emission meats available.',
    tipNl: 'Kip is een van de vleessoorten met de laagste uitstoot.'
  },
  { 
    name: 'Eggs', nameNl: 'Eieren', 
    co2: 4.67, emoji: '🥚', color: '#eab308',
    tip: 'Eggs are an efficient protein source with moderate emissions.',
    tipNl: 'Eieren zijn een efficiënte eiwitbron met gematigde uitstoot.'
  },
  { 
    name: 'Rice', nameNl: 'Rijst', 
    co2: 4.45, emoji: '🍚', color: '#84cc16',
    tip: 'Flooded rice paddies produce methane, making rice higher than other grains.',
    tipNl: 'Ondergelopen rijstvelden produceren methaan, waardoor rijst hoger scoort dan andere granen.'
  },
  { 
    name: 'Milk', nameNl: 'Melk', 
    co2: 3.15, emoji: '🥛', color: '#84cc16',
    tip: 'Plant-based milk alternatives typically have 2-3x lower emissions.',
    tipNl: 'Plantaardige melkalternatieven hebben doorgaans 2-3x lagere uitstoot.'
  },
  { 
    name: 'Bread / Wheat', nameNl: 'Brood / Tarwe', 
    co2: 1.57, emoji: '🍞', color: '#22c55e',
    tip: 'Bread is one of the most climate-friendly staple foods.',
    tipNl: 'Brood is een van de meest klimaatvriendelijke basisvoedingsmiddelen.'
  },
  { 
    name: 'Lentils', nameNl: 'Linzen', 
    co2: 1.79, emoji: '🫘', color: '#22c55e',
    tip: 'Legumes fix nitrogen naturally, needing less fertilizer.',
    tipNl: 'Peulvruchten binden stikstof van nature, waardoor minder kunstmest nodig is.'
  },
  { 
    name: 'Potatoes', nameNl: 'Aardappelen', 
    co2: 0.46, emoji: '🥔', color: '#22c55e',
    tip: 'Root vegetables like potatoes have very low emissions.',
    tipNl: 'Wortelgroenten zoals aardappelen hebben een zeer lage uitstoot.'
  }
]

const KEY_INSIGHTS = {
  en: [
    'Beef (99.5 kg), dark chocolate (46.7 kg) and lamb (39.7 kg) top the emissions chart',
    'Cheese (23.9 kg) is surprisingly high because it concentrates milk emissions',
    'Switching one beef meal per week to chicken saves ~24 kg CO₂/year',
    'Local vs. imported matters less than what you eat — transport is usually <10% of food\'s footprint',
    'Plant proteins (lentils, beans, tofu) have the lowest emissions per gram of protein'
  ],
  nl: [
    'Rundvlees (99,5 kg), pure chocolade (46,7 kg) en lam (39,7 kg) staan bovenaan de uitstootlijst',
    'Kaas (23,9 kg) is verrassend hoog omdat het de melkuitstoot concentreert',
    'Eén rundvleesmaaltijd per week vervangen door kip bespaart ~24 kg CO₂/jaar',
    'Lokaal vs. geïmporteerd maakt minder uit dan wát je eet — transport is meestal <10% van de voetafdruk',
    'Plantaardige eiwitten (linzen, bonen, tofu) hebben de laagste uitstoot per gram eiwit'
  ]
}

const styles = {
  container: {
    maxWidth: '700px',
    margin: '0 auto'
  },
  header: {
    textAlign: 'center',
    marginBottom: '1.5rem'
  },
  title: {
    fontSize: '1.25rem',
    fontWeight: '700',
    color: 'var(--text, #f3f4f6)',
    marginBottom: '0.5rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem'
  },
  subtitle: {
    color: 'var(--text-muted, #9ca3af)',
    fontSize: '0.9rem',
    lineHeight: '1.5'
  },
  // Quiz results summary
  quizSummary: {
    background: 'rgba(59, 130, 246, 0.08)',
    border: '1px solid rgba(59, 130, 246, 0.2)',
    borderRadius: '12px',
    padding: '1rem',
    marginBottom: '1.5rem'
  },
  summaryTitle: {
    fontSize: '0.85rem',
    fontWeight: '600',
    color: '#60a5fa',
    marginBottom: '0.5rem'
  },
  summaryText: {
    color: 'var(--text-muted, #9ca3af)',
    fontSize: '0.85rem',
    lineHeight: '1.5'
  },
  // CO2 bar chart
  chartSection: {
    marginBottom: '1.5rem'
  },
  chartTitle: {
    fontSize: '1rem',
    fontWeight: '600',
    color: 'var(--text, #f3f4f6)',
    marginBottom: '1rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem'
  },
  barRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    marginBottom: '0.4rem',
    cursor: 'pointer'
  },
  barLabel: {
    width: '110px',
    fontSize: '0.8rem',
    color: 'var(--text, #f3f4f6)',
    textAlign: 'right',
    flexShrink: 0
  },
  barContainer: {
    flex: 1,
    height: '24px',
    background: 'var(--bg-secondary, #1e293b)',
    borderRadius: '6px',
    overflow: 'hidden',
    position: 'relative'
  },
  barFill: {
    height: '100%',
    borderRadius: '6px',
    transition: 'width 0.8s ease',
    display: 'flex',
    alignItems: 'center',
    paddingLeft: '0.5rem'
  },
  barValue: {
    fontSize: '0.7rem',
    fontWeight: '600',
    color: 'white',
    whiteSpace: 'nowrap'
  },
  tipBox: {
    background: 'var(--bg-card, #1e293b)',
    border: '1px solid var(--border, #334155)',
    borderRadius: '8px',
    padding: '0.75rem',
    marginBottom: '0.75rem',
    fontSize: '0.8rem',
    color: 'var(--text-muted, #9ca3af)',
    lineHeight: '1.4'
  },
  // Key insights
  insightsSection: {
    background: 'rgba(34, 197, 94, 0.08)',
    border: '1px solid rgba(34, 197, 94, 0.2)',
    borderRadius: '16px',
    padding: '1.25rem',
    marginBottom: '1.5rem'
  },
  insightsTitle: {
    fontSize: '1rem',
    fontWeight: '600',
    color: '#22c55e',
    marginBottom: '0.75rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem'
  },
  insightItem: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '0.5rem',
    marginBottom: '0.5rem',
    fontSize: '0.85rem',
    color: 'var(--text, #f3f4f6)',
    lineHeight: '1.4'
  },
  insightBullet: {
    color: '#22c55e',
    fontWeight: '700',
    flexShrink: 0,
    marginTop: '1px'
  },
  // Detailed section (variant B only)
  detailedSection: {
    background: 'var(--bg-card, #1e293b)',
    borderRadius: '16px',
    padding: '1.25rem',
    marginBottom: '1.5rem',
    border: '1px solid var(--border, #334155)'
  },
  detailedTitle: {
    fontSize: '1rem',
    fontWeight: '600',
    color: 'var(--text, #f3f4f6)',
    marginBottom: '0.75rem'
  },
  detailedText: {
    color: 'var(--text-muted, #9ca3af)',
    fontSize: '0.85rem',
    lineHeight: '1.6'
  },
  nextBtn: {
    width: '100%',
    padding: '1rem',
    background: 'linear-gradient(135deg, #3b82f6, #667eea)',
    border: 'none',
    borderRadius: '12px',
    color: 'white',
    fontWeight: '600',
    fontSize: '1rem',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.5rem'
  },
  expandBtn: {
    background: 'none',
    border: 'none',
    color: '#60a5fa',
    cursor: 'pointer',
    fontSize: '0.8rem',
    padding: '0.25rem 0',
    display: 'flex',
    alignItems: 'center',
    gap: '0.25rem'
  }
}

export default function ExperimentIntervention({ session, onComplete }) {
  const { lang } = useI18n()
  const isNl = lang === 'nl'
  const [expandedTip, setExpandedTip] = useState(null)
  const [readTime, setReadTime] = useState(0)
  const [canContinue, setCanContinue] = useState(false)

  // Start reading timer - allow continuing after 15 seconds
  useEffect(() => {
    const timer = setTimeout(() => setCanContinue(true), 15000)
    return () => clearTimeout(timer)
  }, [])

  // Also allow continue immediately (but track read time)
  const handleContinue = () => {
    if (onComplete) onComplete()
  }

  const variant = session?.ab_variant || 'A'
  const maxCO2 = Math.max(...CO2_CATEGORIES.map(c => c.co2))

  // Get pre-quiz results for summary
  const q1Score = session?.quiz1_data?.score
  const q5Score = session?.quiz5_data?.score
  const q2Score = session?.quiz2_data?.score

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>
          <Lightbulb size={24} />
          {isNl ? 'Hoe schadelijk is jouw eten?' : 'How harmful is your food?'}
        </h2>
        <p style={styles.subtitle}>
          {isNl 
            ? 'Ontdek de werkelijke CO₂-uitstoot van veelvoorkomende voedingsproducten.'
            : 'Discover the real CO₂ emissions of common food products.'}
        </p>
      </div>

      {/* Detailed quiz results shown above via QuizResultsReview */}

      {/* Detailed pre-quiz results */}
      {(session?.quiz1_data || session?.quiz5_data || session?.quiz2_data) && (
        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ fontSize: '1rem', fontWeight: '600', color: 'var(--text, #f3f4f6)', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            📋 {isNl ? 'Jouw quiz resultaten' : 'Your quiz results'}
          </div>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted, #9ca3af)', marginBottom: '1rem', lineHeight: '1.5' }}>
            {isNl
              ? 'Bekijk hoe je het deed. Groene items had je goed, gele waren er net naast, en rode waren verder weg van de juiste positie.'
              : 'See how you did. Green items were correct, yellow were close, and red were further from the correct position.'}
          </p>
          <QuizResultsReview
            quizData={session.quiz1_data}
            quizLabel={isNl ? 'Quiz 1 – Algemene Producten' : 'Quiz 1 – General Products'}
            defaultOpen={true}
          />
          <QuizResultsReview
            quizData={session.quiz5_data}
            quizLabel={isNl ? 'Quiz 2 – AH Producten' : 'Quiz 2 – AH Products'}
            defaultOpen={false}
          />
          <QuizResultsReview
            quizData={session.quiz2_data}
            quizLabel={isNl ? 'Quiz 3 – Jouw Aankopen' : 'Quiz 3 – Your Purchases'}
            defaultOpen={false}
          />
        </div>
      )}

      {/* CO2 Bar Chart */}
      <div style={styles.chartSection}>
        <div style={styles.chartTitle}>
          <BarChart3 size={20} />
          {isNl ? 'CO₂-uitstoot per kg voedsel' : 'CO₂ emissions per kg of food'}
        </div>
        
        {CO2_CATEGORIES.map((cat, idx) => (
          <div key={cat.name}>
            <div 
              style={styles.barRow}
              onClick={() => setExpandedTip(expandedTip === idx ? null : idx)}
            >
              <div style={styles.barLabel}>
                {cat.emoji} {isNl ? cat.nameNl : cat.name}
              </div>
              <div style={styles.barContainer}>
                <div style={{
                  ...styles.barFill,
                  width: `${Math.max(8, (cat.co2 / maxCO2) * 100)}%`,
                  background: cat.color
                }}>
                  <span style={styles.barValue}>{cat.co2} kg</span>
                </div>
              </div>
            </div>
            {expandedTip === idx && (
              <div style={styles.tipBox}>
                💡 {isNl ? cat.tipNl : cat.tip}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Key Insights */}
      <div style={styles.insightsSection}>
        <div style={styles.insightsTitle}>
          <Leaf size={20} />
          {isNl ? 'Belangrijke inzichten' : 'Key Insights'}
        </div>
        {(isNl ? KEY_INSIGHTS.nl : KEY_INSIGHTS.en).map((insight, idx) => (
          <div key={idx} style={styles.insightItem}>
            <span style={styles.insightBullet}>•</span>
            <span>{insight}</span>
          </div>
        ))}
      </div>

      {/* Variant B: Extended detailed explanation */}
      {variant === 'B' && (
        <div style={styles.detailedSection}>
          <div style={styles.detailedTitle}>
            <Flame size={18} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '0.5rem' }} />
            {isNl ? 'Waarom verschilt de uitstoot zo?' : 'Why does emission vary so much?'}
          </div>
          <div style={styles.detailedText}>
            {isNl ? (
              <>
                <p>De CO₂-uitstoot van voedsel wordt bepaald door meerdere factoren:</p>
                <p style={{ marginTop: '0.5rem' }}><strong>🐄 Dierlijke producten:</strong> Koeien en schapen produceren methaan (een sterk broeikasgas) tijdens de spijsvertering. Daarnaast is er veel land en voer nodig, wat leidt tot ontbossing.</p>
                <p style={{ marginTop: '0.5rem' }}><strong>🌾 Plantaardige producten:</strong> Over het algemeen veel efficiënter. Er is minder land, water en energie nodig. Uitzondering: rijst produceert methaan door natte teelt.</p>
                <p style={{ marginTop: '0.5rem' }}><strong>🚚 Transport:</strong> Verrassend genoeg is transport vaak maar 5-10% van de totale voetafdruk. Wát je eet is belangrijker dan waar het vandaan komt.</p>
                <p style={{ marginTop: '0.5rem' }}><strong>💡 Tip:</strong> Eén dag per week geen vlees eten heeft meer impact dan een heel jaar alleen lokaal te kopen!</p>
              </>
            ) : (
              <>
                <p>The CO₂ footprint of food is determined by multiple factors:</p>
                <p style={{ marginTop: '0.5rem' }}><strong>🐄 Animal products:</strong> Cows and sheep produce methane (a potent greenhouse gas) during digestion. They also require lots of land and feed, driving deforestation.</p>
                <p style={{ marginTop: '0.5rem' }}><strong>🌾 Plant-based foods:</strong> Generally much more efficient. They need less land, water, and energy. Exception: rice produces methane through wet cultivation.</p>
                <p style={{ marginTop: '0.5rem' }}><strong>🚚 Transport:</strong> Surprisingly, transport is often only 5-10% of the total footprint. What you eat matters more than where it comes from.</p>
                <p style={{ marginTop: '0.5rem' }}><strong>💡 Tip:</strong> Going meat-free one day per week has more impact than buying only local products for a whole year!</p>
              </>
            )}
          </div>
        </div>
      )}

      {onComplete && (
        <button style={styles.nextBtn} onClick={handleContinue}>
          {isNl ? 'Ga door naar de volgende quiz' : 'Continue to the next quiz'}
          <ChevronRight size={20} />
        </button>
      )}
    </div>
  )
}
