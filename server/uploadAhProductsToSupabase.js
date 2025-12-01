import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import crypto from 'crypto'
import { normalizeProductName } from './productCatalog.js'

dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.join(__dirname, '..', '..')

function parseArgs() {
  const args = process.argv.slice(2)
  const result = {
    file: null,
    table: process.env.SUPABASE_PRODUCTS_TABLE || 'ah_products'
  }

  for (const arg of args) {
    if (arg.startsWith('--file=')) {
      result.file = arg.slice('--file='.length)
    } else if (arg.startsWith('--table=')) {
      result.table = arg.slice('--table='.length)
    } else if (!result.file) {
      result.file = arg
    }
  }

  return result
}

const { file: inputFileRaw, table: tableName } = parseArgs()
const inputFile = inputFileRaw
  ? path.resolve(PROJECT_ROOT, inputFileRaw)
  : path.join(PROJECT_ROOT, 'cleaned_products.json')

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const schema = process.env.SUPABASE_SCHEMA || 'public'

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.')
  console.error('   Please set them before running the upload script.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { persistSession: false },
  db: { schema }
})

function deriveId(name, url) {
  if (url && typeof url === 'string') {
    try {
      const parsed = new URL(url)
      const segments = parsed.pathname.split('/').filter(Boolean)
      if (segments.length > 0) {
        return segments[segments.length - 1].toLowerCase()
      }
    } catch (err) {
      // Ignore malformed URL
    }
  }
  const hash = crypto.createHash('sha1').update(name).digest('hex')
  return `ah_${hash.slice(0, 24)}`
}

async function loadProducts(filename) {
  const raw = await fs.readFile(filename, 'utf8')
  const data = JSON.parse(raw)
  if (!Array.isArray(data)) {
    throw new Error(`Expected an array in ${filename}`)
  }
  return data
}

function buildPayload(records) {
  const seen = new Set()
  const payload = []

  for (const item of records) {
    const name = typeof item.name === 'string' ? item.name.trim() : null
    if (!name) continue

    const url = typeof item.url === 'string' ? item.url.trim() : null
    const imageUrl = typeof item.image_url === 'string' ? item.image_url.trim() : null
    const id = deriveId(name, url)
    if (!id || seen.has(id)) continue

    seen.add(id)
    payload.push({
      id,
      name,
      normalized_name: normalizeProductName(name),
      url,
      image_url: imageUrl,
      source: item.source || 'cleaned_products.json',
      tags: item.tags || null
    })
  }

  return payload
}

async function chunkedUpsert(rows, size = 500) {
  for (let index = 0; index < rows.length; index += size) {
    const chunk = rows.slice(index, index + size)
    const { error } = await supabase.from(tableName).upsert(chunk, { onConflict: 'id' })
    if (error) {
      throw new Error(`Supabase upsert failed at chunk ${index / size}: ${error.message}`)
    }
    console.log(`   • Uploaded ${Math.min(index + size, rows.length)} / ${rows.length}`)
  }
}

async function run() {
  console.log(`🚀 Uploading AH product list from ${inputFile} into ${schema}.${tableName}`)
  const records = await loadProducts(inputFile)
  const payload = buildPayload(records)

  if (payload.length === 0) {
    console.warn('⚠️ No records found to upload. Exiting.')
    return
  }

  await chunkedUpsert(payload)
  console.log(`✅ Uploaded ${payload.length} records to ${tableName}`)
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Upload failed:', err.message)
    process.exit(1)
  })
