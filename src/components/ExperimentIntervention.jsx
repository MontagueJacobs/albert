import { useState, useEffect } from 'react'
import { ChevronRight, ChevronDown, ChevronUp, Lightbulb, BarChart3, Leaf, Flame } from 'lucide-react'
import { useI18n } from '../i18n.jsx'

// CO2 data for the learning page - common food categories with CO2/kg values
const CO2_CATEGORIES = [
  { 
    name: 'Beef / Rood vlees', nameNl: 'Rundvlees', 
    co2: 27, emoji: '🥩', color: '#ef4444',
    tip: 'Beef has the highest CO₂ footprint of all common foods.',
    tipNl: 'Rundvlees heeft de hoogste CO₂-voetafdruk van alle gangbare voedingsmiddelen.'
  },
  { 
    name: 'Lamb', nameNl: 'Lamsvlees', 
    co2: 24, emoji: '🍖', color: '#ef4444',
    tip: 'Lamb produces similar emissions to beef due to methane from digestion.',
    tipNl: 'Lamsvlees produceert vergelijkbare uitstoot als rundvlees door methaan uit de spijsvertering.'
  },
  { 
    name: 'Cheese', nameNl: 'Kaas', 
    co2: 13.5, emoji: '🧀', color: '#f97316',
    tip: 'It takes ~10 liters of milk to make 1 kg of cheese, concentrating the emissions.',
    tipNl: 'Er is ~10 liter melk nodig om 1 kg kaas te maken, wat de uitstoot concentreert.'
  },
  { 
    name: 'Chocolate', nameNl: 'Chocolade', 
    co2: 11.5, emoji: '🍫', color: '#f97316',
    tip: 'Cocoa farming drives deforestation, increasing its carbon footprint.',
    tipNl: 'Cacaoteelt veroorzaakt ontbossing, wat de CO₂-voetafdruk verhoogt.'
  },
  { 
    name: 'Pork', nameNl: 'Varkensvlees', 
    co2: 7.6, emoji: '🥓', color: '#eab308',
    tip: 'Pork has a much lower footprint than beef, about 3-4x less.',
    tipNl: 'Varkensvlees heeft een veel lagere voetafdruk dan rundvlees, ongeveer 3-4x minder.'
  },
  { 
    name: 'Chicken', nameNl: 'Kip', 
    co2: 6.9, emoji: '🍗', color: '#eab308',
    tip: 'Chicken is one of the lowest-emission meats available.',
    tipNl: 'Kip is een van de vleessoorten met de laagste uitstoot.'
  },
  { 
    name: 'Eggs', nameNl: 'Eieren', 
    co2: 4.7, emoji: '🥚', color: '#eab308',
    tip: 'Eggs are an efficient protein source with moderate emissions.',
    tipNl: 'Eieren zijn een efficiënte eiwitbron met gematigde uitstoot.'
  },
  { 
    name: 'Rice', nameNl: 'Rijst', 
    co2: 4.0, emoji: '🍚', color: '#84cc16',
    tip: 'Flooded rice paddies produce methane, making rice higher than other grains.',
    tipNl: 'Ondergelopen rijstvelden produceren methaan, waardoor rijst hoger scoort dan andere granen.'
  },
  { 
    name: 'Milk', nameNl: 'Melk', 
    co2: 3.2, emoji: '🥛', color: '#84cc16',
    tip: 'Plant-based milk alternatives typically have 2-3x lower emissions.',
    tipNl: 'Plantaardige melkalternatieven hebben doorgaans 2-3x lagere uitstoot.'
  },
  { 
    name: 'Bread', nameNl: 'Brood', 
    co2: 1.4, emoji: '🍞', color: '#22c55e',
    tip: 'Bread is one of the most climate-friendly staple foods.',
    tipNl: 'Brood is een van de meest klimaatvriendelijke basisvoedingsmiddelen.'
  },
  { 
    name: 'Potatoes', nameNl: 'Aardappelen', 
    co2: 0.5, emoji: '🥔', color: '#22c55e',
    tip: 'Root vegetables like potatoes have very low emissions.',
    tipNl: 'Wortelgroenten zoals aardappelen hebben een zeer lage uitstoot.'
  },
  { 
    name: 'Lentils', nameNl: 'Linzen', 
    co2: 0.9, emoji: '🫘', color: '#22c55e',
    tip: 'Legumes fix nitrogen naturally, needing less fertilizer.',
    tipNl: 'Peulvruchten binden stikstof van nature, waardoor minder kunstmest nodig is.'
  }
]

const KEY_INSIGHTS = {
  en: [
    'Red meat (beef, lamb) has 10-50x the CO₂ footprint of plant-based foods',
    'Cheese is surprisingly high because it concentrates milk emissions',
    'Switching one beef meal per week to chicken saves ~20 kg CO₂/year',
    'Local vs. imported matters less than what you eat — transport is usually <10% of food\'s footprint',
    'Plant proteins (lentils, beans, tofu) have the lowest emissions per gram of protein'
  ],
  nl: [
    'Rood vlees (rund, lam) heeft 10-50x de CO₂-voetafdruk van plantaardige voeding',
    'Kaas is verrassend hoog omdat het de melkuitstoot concentreert',
    'Eén rundvleesmaaltijd per week vervangen door kip bespaart ~20 kg CO₂/jaar',
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

  // Get quiz 1 & 2 results for summary
  const q1Score = session?.quiz1_data?.score
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

      {/* Quiz score summary */}
      {(q1Score != null || q2Score != null) && (
        <div style={styles.quizSummary}>
          <div style={styles.summaryTitle}>
            {isNl ? '📊 Jouw quiz resultaten tot nu toe' : '📊 Your quiz results so far'}
          </div>
          <div style={styles.summaryText}>
            {q1Score != null && (
              <span>Quiz 1 (algemeen): <strong>{q1Score}/100</strong></span>
            )}
            {q1Score != null && q2Score != null && <span> • </span>}
            {q2Score != null && (
              <span>Quiz 2 (persoonlijk): <strong>{q2Score}/100</strong></span>
            )}
            <br />
            <span style={{ fontSize: '0.8rem' }}>
              {isNl 
                ? 'Bekijk hieronder de werkelijke CO₂-waarden en probeer je score te verbeteren!'
                : 'View the actual CO₂ values below and try to improve your score!'}
            </span>
          </div>
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

      <button style={styles.nextBtn} onClick={handleContinue}>
        {isNl ? 'Ga door naar de volgende quiz' : 'Continue to the next quiz'}
        <ChevronRight size={20} />
      </button>
    </div>
  )
}
