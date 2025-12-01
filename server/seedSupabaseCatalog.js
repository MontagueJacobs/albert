import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { PRODUCT_CATALOG } from './productCatalog.js'

dotenv.config()

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const tableName = process.env.SUPABASE_CATALOG_TABLE || 'product_catalog'
const schema = process.env.SUPABASE_SCHEMA || 'public'

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.')
  console.error('   Please set them before running the seed script.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { persistSession: false },
  db: { schema }
})

function toTextArray(value) {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    return value
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return []
}

async function seed() {
  console.log(`🚀 Seeding ${PRODUCT_CATALOG.length} catalog entries into Supabase table ${schema}.${tableName}`)

  const payload = PRODUCT_CATALOG.map((entry) => ({
    id: entry.id,
    names: toTextArray(entry.names),
    base_score: entry.baseScore ?? 5,
    categories: toTextArray(entry.categories),
    adjustments: entry.adjustments ?? [],
    suggestions: toTextArray(entry.suggestions),
    notes: entry.notes ?? null
  }))

  const { error } = await supabase.from(tableName).upsert(payload, {
    onConflict: 'id'
  })

  if (error) {
    console.error('❌ Failed to seed catalog:', error.message)
    process.exit(1)
  }

  console.log('✅ Supabase catalog seeding complete!')
  process.exit(0)
}

seed()
  .catch((err) => {
    console.error('❌ Unexpected error while seeding catalog:', err)
    process.exit(1)
  })
