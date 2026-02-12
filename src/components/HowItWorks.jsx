import { useI18n } from '../i18n.jsx'

// Dark mode styles
const styles = {
  container: {
    background: 'var(--bg-card, #1e293b)',
    borderRadius: '12px',
    border: '1px solid var(--border, #334155)',
    padding: '1.75rem'
  },
  heading: {
    marginTop: 0,
    color: 'var(--text, #f3f4f6)'
  },
  intro: {
    color: 'var(--text-muted, #9ca3af)',
    lineHeight: 1.6
  },
  article: {
    padding: '1rem',
    borderRadius: '10px',
    background: 'var(--bg-hover, #334155)',
    border: '1px solid var(--border, #334155)'
  },
  articleTitle: {
    margin: '0 0 0.5rem 0',
    fontSize: '1.05rem',
    color: 'var(--text, #f3f4f6)'
  },
  articleBody: {
    margin: 0,
    color: 'var(--text-muted, #9ca3af)',
    lineHeight: 1.6
  }
}

function HowItWorks() {
  const { t } = useI18n()
  const sections = t('how_sections') || []

  return (
    <section className="how-section" style={{ marginTop: '1.5rem' }}>
      <div style={styles.container}>
        <h2 style={styles.heading}>{t('how_title')}</h2>
        <p style={styles.intro}>{t('how_intro')}</p>

        <div style={{ display: 'grid', gap: '1rem', marginTop: '1.5rem' }}>
          {sections.map((section, idx) => (
            <article key={idx} style={styles.article}>
              <h3 style={styles.articleTitle}>{section.title}</h3>
              <p style={styles.articleBody}>{section.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

export default HowItWorks