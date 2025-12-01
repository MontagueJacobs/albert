import { useI18n } from '../i18n.jsx'

function HowItWorks() {
  const { t } = useI18n()
  const sections = t('how_sections') || []

  return (
    <section className="how-section" style={{ marginTop: '1.5rem' }}>
      <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #e6e6e6', padding: '1.75rem' }}>
        <h2 style={{ marginTop: 0 }}>{t('how_title')}</h2>
        <p style={{ color: '#555', lineHeight: 1.6 }}>{t('how_intro')}</p>

        <div style={{ display: 'grid', gap: '1rem', marginTop: '1.5rem' }}>
          {sections.map((section, idx) => (
            <article key={idx} style={{ padding: '1rem', borderRadius: '10px', background: '#f7f9fc', border: '1px solid #e2e8f0' }}>
              <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.05rem' }}>{section.title}</h3>
              <p style={{ margin: 0, color: '#4a5568', lineHeight: 1.6 }}>{section.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}

export default HowItWorks