import app, { ensureCatalogLoaded, getCatalogMeta } from './app.js'

const PORT = process.env.PORT || 3001

// Global error handlers to prevent server crashes
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err.stack || err)
  // Don't exit - keep server running
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection at:', promise, 'reason:', reason)
  // Don't exit - keep server running
})

async function start() {
  try {
    const meta = await ensureCatalogLoaded()
    console.log(`📦 Catalog source: ${meta.source} (${meta.itemCount} items)`) // surface catalog status at startup
  } catch (err) {
    console.error('[server] Failed to ensure catalog is loaded:', err?.message || err)
  }

  const server = app.listen(PORT, () => {
    console.log(`🌱 Sustainable Shop API running on http://localhost:${PORT}`)
  })

  // Handle server errors
  server.on('error', (err) => {
    console.error('[server] Server error:', err)
  })
}

start()
