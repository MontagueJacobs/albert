import app, { ensureCatalogLoaded } from '../server/app.js'

export default async function handler(req, res) {
  // Ensure catalog has been loaded before handling any request
  await ensureCatalogLoaded()
  // Delegate to the Express app for all API subpaths
  return app(req, res)
}
