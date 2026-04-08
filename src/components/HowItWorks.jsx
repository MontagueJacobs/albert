import { useI18n } from '../i18n.jsx'
import { Leaf, Database, FlaskConical, BarChart3, Search, Scale, Info } from 'lucide-react'

const sectionIcons = [Database, Search, FlaskConical, BarChart3, Scale, Leaf]

const styles = {
  container: {
    background: 'var(--bg-card, #1e293b)',
    borderRadius: '12px',
    border: '1px solid var(--border, #334155)',
    padding: '1.75rem'
  },
  heading: {
    marginTop: 0,
    color: 'var(--text, #f3f4f6)',
    fontSize: '1.35rem'
  },
  intro: {
    color: 'var(--text-muted, #9ca3af)',
    lineHeight: 1.7,
    marginBottom: '0.5rem'
  },
  article: {
    padding: '1.15rem',
    borderRadius: '10px',
    background: 'var(--bg-hover, #334155)',
    border: '1px solid var(--border, #334155)'
  },
  articleHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.6rem',
    margin: '0 0 0.5rem 0'
  },
  articleIcon: {
    flexShrink: 0,
    padding: '0.35rem',
    borderRadius: '8px',
    background: 'var(--bg-secondary, rgba(255,255,255,0.06))',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  articleTitle: {
    margin: 0,
    fontSize: '1.05rem',
    fontWeight: 600,
    color: 'var(--text, #f3f4f6)'
  },
  articleBody: {
    margin: 0,
    color: 'var(--text-muted, #9ca3af)',
    lineHeight: 1.65,
    fontSize: '0.92rem'
  },
  scoreTable: {
    width: '100%',
    borderCollapse: 'collapse',
    marginTop: '0.75rem',
    fontSize: '0.85rem'
  },
  th: {
    textAlign: 'left',
    padding: '0.4rem 0.6rem',
    borderBottom: '1px solid var(--border, #334155)',
    color: 'var(--text, #f3f4f6)',
    fontWeight: 600,
    fontSize: '0.8rem'
  },
  td: {
    padding: '0.35rem 0.6rem',
    borderBottom: '1px solid var(--border, rgba(255,255,255,0.04))',
    color: 'var(--text-muted, #9ca3af)',
    fontSize: '0.82rem'
  },
  scoreBadge: (color) => ({
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '1.6rem',
    height: '1.6rem',
    borderRadius: '50%',
    background: color,
    color: '#fff',
    fontWeight: 700,
    fontSize: '0.75rem'
  }),
  sourceBox: {
    marginTop: '1.5rem',
    padding: '1rem 1.15rem',
    borderRadius: '10px',
    background: 'var(--bg-hover, #334155)',
    border: '1px solid var(--border, #334155)',
    display: 'flex',
    gap: '0.65rem',
    alignItems: 'flex-start'
  },
  sourceText: {
    margin: 0,
    color: 'var(--text-muted, #9ca3af)',
    lineHeight: 1.6,
    fontSize: '0.85rem'
  }
}

const scoreRows = [
  { score: 10, co2: '< 1',    color: '#22c55e' },
  { score: 9,  co2: '1 – 2',  color: '#22c55e' },
  { score: 8,  co2: '2 – 4',  color: '#84cc16' },
  { score: 7,  co2: '4 – 6',  color: '#84cc16' },
  { score: 6,  co2: '6 – 10', color: '#eab308' },
  { score: 5,  co2: '10 – 15',color: '#eab308' },
  { score: 4,  co2: '15 – 25',color: '#f97316' },
  { score: 3,  co2: '25 – 40',color: '#f97316' },
  { score: 2,  co2: '40 – 60',color: '#ef4444' },
  { score: 1,  co2: '60 – 100',color: '#ef4444' },
  { score: 0,  co2: '> 100',  color: '#ef4444' },
]

function HowItWorks() {
  const { t } = useI18n()
  const sections = t('how_sections') || []
  const tableHeaders = t('how_table_headers') || { score: 'Score', co2: 'kg CO₂ / kg', example: 'Example' }
  const tableExamples = t('how_table_examples') || {}

  return (
    <section className="how-section" style={{ marginTop: '1.5rem' }}>
      <div style={styles.container}>
        <h2 style={styles.heading}>{t('how_title')}</h2>
        <p style={styles.intro}>{t('how_intro')}</p>

        <div style={{ display: 'grid', gap: '1rem', marginTop: '1.5rem' }}>
          {sections.map((section, idx) => {
            const Icon = sectionIcons[idx] || Leaf
            const isScoreTable = idx === 3 // 4th section = score scale

            return (
              <article key={idx} style={styles.article}>
                <div style={styles.articleHeader}>
                  <div style={styles.articleIcon}>
                    <Icon size={18} style={{ color: 'var(--primary, #3b82f6)' }} />
                  </div>
                  <h3 style={styles.articleTitle}>{section.title}</h3>
                </div>
                <p style={styles.articleBody}>{section.body}</p>

                {isScoreTable && (
                  <table style={styles.scoreTable}>
                    <thead>
                      <tr>
                        <th style={styles.th}>{tableHeaders.score}</th>
                        <th style={styles.th}>{tableHeaders.co2}</th>
                        <th style={styles.th}>{tableHeaders.example}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scoreRows.map((row) => (
                        <tr key={row.score}>
                          <td style={styles.td}>
                            <span style={styles.scoreBadge(row.color)}>{row.score}</span>
                          </td>
                          <td style={styles.td}>{row.co2}</td>
                          <td style={styles.td}>{tableExamples[row.score] || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </article>
            )
          })}
        </div>

        {/* Data sources */}
        <div style={styles.sourceBox}>
          <Info size={18} style={{ color: 'var(--primary, #3b82f6)', flexShrink: 0, marginTop: '2px' }} />
          <p style={styles.sourceText}>{t('how_sources')}</p>
        </div>
      </div>
    </section>
  )
}

export default HowItWorks