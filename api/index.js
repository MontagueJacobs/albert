import app, { ensureCatalogLoaded } from '../server/app.js'

export default async function handler(req, res) {
  await ensureCatalogLoaded()
  return app(req, res)
}
