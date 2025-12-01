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
const SUPABASE_TABLE = process.env.SUPABASE_CATALOG_TABLE || 'product_catalog'
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

function normalizeAdjustment(adjustment) {
  if (Array.isArray(adjustment)) {
    return adjustment.map(normalizeAdjustment).filter(Boolean)
  }
  if (!adjustment || typeof adjustment !== 'object') return null
  const code = typeof adjustment.code === 'string' && adjustment.code.trim().length > 0
    ? adjustment.code.trim()
    : typeof adjustment.id === 'string'
      ? adjustment.id.trim()
      : null
  const deltaValue = adjustment.delta ?? adjustment.value ?? null
  const delta = typeof deltaValue === 'number' ? deltaValue : Number.parseFloat(deltaValue)
  if (!code || Number.isNaN(delta)) return null
  return { code, delta }
}

function normalizeAdjustments(value) {
  if (!value) return []
  if (Array.isArray(value)) {
    return value.map(normalizeAdjustment).filter(Boolean)
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return normalizeAdjustments(parsed)
    } catch (err) {
      return []
    }
  }
  if (typeof value === 'object') {
    return Object.values(value).map(normalizeAdjustment).filter(Boolean)
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
  const { data, error } = await supabase
    .from(SUPABASE_TABLE)
    .select('id, names, base_score, categories, adjustments, suggestions, notes')
    .order('id', { ascending: true })
    .limit(2000)

  if (error) {
    throw new Error(`Supabase fetch error: ${error.message}`)
  }

  if (!data || data.length === 0) {
    return []
  }

  return data
    .map((row) => {
      const names = toStringArray(row.names)
      const id = typeof row.id === 'string' && row.id.trim().length > 0
        ? row.id.trim()
        : names[0] || null

      if (!id || names.length === 0) {
        return null
      }

      return {
        id,
        names,
        baseScore: typeof row.base_score === 'number'
          ? row.base_score
          : typeof row.baseScore === 'number'
            ? row.baseScore
            : 5,
        categories: toStringArray(row.categories),
        adjustments: normalizeAdjustments(row.adjustments),
        suggestions: toStringArray(row.suggestions),
        notes: typeof row.notes === 'string' ? row.notes : null
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
