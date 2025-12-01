import app, { ensureCatalogLoaded, getCatalogMeta } from './app.js'

const PORT = process.env.PORT || 3001

async function start() {
  try {
    const meta = await ensureCatalogLoaded()
    console.log(`📦 Catalog source: ${meta.source} (${meta.itemCount} items)`) // surface catalog status at startup
  } catch (err) {
    console.error('[server] Failed to ensure catalog is loaded:', err?.message || err)
  }

  app.listen(PORT, () => {
    console.log(`🌱 Sustainable Shop API running on http://localhost:${PORT}`)
  })
}

start()
