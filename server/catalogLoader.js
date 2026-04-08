import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import { PRODUCT_CATALOG, CATALOG_INDEX as FALLBACK_INDEX, normalizeProductName } from './productCatalog.js'

// Ensure environment is loaded from webapp root regardless of cwd
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
dotenv.config({ path: path.join(__dirname, '..', '.env') })

const DEFAULT_REFRESH_INTERVAL_MS = 15 * 60 * 1000
const REFRESH_INTERVAL_MS = Number.parseInt(process.env.CATALOG_REFRESH_INTERVAL_MS ?? `${DEFAULT_REFRESH_INTERVAL_MS}`, 10) || DEFAULT_REFRESH_INTERVAL_MS
// Use unified 'products' table, fallback to product_catalog for backward compatibility
const SUPABASE_TABLE = process.env.SUPABASE_CATALOG_TABLE || 'products'
const SUPABASE_SCHEMA = process.env.SUPABASE_SCHEMA || 'public'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY

const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
      db: { schema: SUPABASE_SCHEMA }
    })
  : null

let catalogEntries = PRODUCT_CATALOG
let catalogIndex = FALLBACK_INDEX
let catalogSource = supabase ? 'supabase:pending' : 'local:fallback'
let lastRefreshTs = 0
let lastError = null
let inFlightPromise = null

function toStringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => `${item}`.trim()).filter(Boolean)
  }
  if (typeof value === 'string') {
    return value
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return []
}

function buildIndex(entries) {
  return entries.map((entry) => ({
    ...entry,
    normalizedNames: (entry.names || []).map((name) => normalizeProductName(name))
  }))
}

async function fetchSupabaseCatalog() {
  if (!supabase) return null
  
  // Fetch from unified 'products' table
  const { data, error } = await supabase
    .from(SUPABASE_TABLE)
    .select('id, name, alt_names, categories')
    .order('id', { ascending: true })
    .limit(2000)

  if (error) {
    // Log the error but don't try legacy table - it was dropped
    console.error(`[catalogLoader] Supabase error: ${error.message}`)
    console.log('[catalogLoader] Using fallback local catalog')
    return null  // Will fall back to local PRODUCT_CATALOG
  }

  if (!data || data.length === 0) {
    console.log('[catalogLoader] No products with scores found in Supabase, using local catalog')
    return null
  }

  // Transform unified products format
  return data
    .map((row) => {
      // alt_names contains alternative names, name is the primary name
      const names = row.alt_names?.length > 0 
        ? toStringArray(row.alt_names) 
        : [row.name].filter(Boolean)
      
      const id = typeof row.id === 'string' && row.id.trim().length > 0
        ? row.id.trim()
        : names[0] || null

      if (!id || names.length === 0) {
        return null
      }

      return {
        id,
        names,
        categories: toStringArray(row.categories)
      }
    })
    .filter(Boolean)
}

export function getCatalogEntries() {
  return catalogEntries
}

export function getCatalogIndex() {
  return catalogIndex
}

export function getCatalogMeta() {
  return {
    source: catalogSource,
    supabaseEnabled: Boolean(supabase),
    lastRefreshTs,
    itemCount: catalogEntries.length,
    lastError
  }
}

export async function refreshCatalog({ force = false } = {}) {
  if (!supabase) {
    lastRefreshTs = Date.now()
    catalogSource = 'local:fallback'
    lastError = null
    return getCatalogMeta()
  }

  const now = Date.now()
  if (!force && now - lastRefreshTs < REFRESH_INTERVAL_MS) {
    return getCatalogMeta()
  }

  if (inFlightPromise) {
    return inFlightPromise
  }

  inFlightPromise = (async () => {
    try {
      const records = await fetchSupabaseCatalog()
      if (records && records.length > 0) {
        catalogEntries = records
        catalogIndex = buildIndex(records)
        catalogSource = `supabase:${SUPABASE_TABLE}`
        lastError = null
      } else {
        // Keep fallback if Supabase table is empty
        catalogEntries = PRODUCT_CATALOG
        catalogIndex = FALLBACK_INDEX
        catalogSource = 'local:fallback'
        lastError = null
      }
    } catch (err) {
      console.error('[catalogLoader] Failed to refresh catalog from Supabase:', err.message)
      lastError = err.message
      catalogEntries = PRODUCT_CATALOG
      catalogIndex = FALLBACK_INDEX
      catalogSource = 'local:fallback'
    } finally {
      lastRefreshTs = Date.now()
      inFlightPromise = null
    }
    return getCatalogMeta()
  })()

  return inFlightPromise
}

export async function ensureCatalogLoaded() {
  if (!supabase) {
    return getCatalogMeta()
  }
  if (catalogSource === 'supabase:pending' || Date.now() - lastRefreshTs > REFRESH_INTERVAL_MS) {
    return refreshCatalog({ force: true })
  }
  return getCatalogMeta()
}

export const catalogReady = (async () => {
  try {
    await refreshCatalog({ force: true })
  } catch (err) {
    // Already logged in refreshCatalog
    return getCatalogMeta()
  }
  return getCatalogMeta()
})()

export const supabaseEnabled = Boolean(supabase)

export { normalizeProductName }
