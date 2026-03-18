/**
 * Sync origin_by_month data from detailed-scraped products (wi* IDs) 
 * to their browser-scraped duplicates
 */
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
dotenv.config()

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
)

async function syncOriginData() {
  console.log('📦 Fetching products with origin_by_month data...')
  
  // Get all products with origin data
  const { data: productsWithOrigin, error: fetchError } = await supabase
    .from('products')
    .select('id, name, url, origin_by_month')
    .not('origin_by_month', 'is', null)
  
  if (fetchError) {
    console.error('Failed to fetch products:', fetchError)
    return
  }
  
  console.log(`Found ${productsWithOrigin.length} products with origin data`)
  
  // Build lookup by URL (most reliable match)
  const originByUrl = {}
  for (const p of productsWithOrigin) {
    if (p.url) {
      originByUrl[p.url] = p.origin_by_month
    }
  }
  
  // Get all products WITHOUT origin data
  const { data: productsWithoutOrigin, error: fetchError2 } = await supabase
    .from('products')
    .select('id, name, url, origin_by_month')
    .is('origin_by_month', null)
  
  if (fetchError2) {
    console.error('Failed to fetch products without origin:', fetchError2)
    return
  }
  
  console.log(`Found ${productsWithoutOrigin.length} products WITHOUT origin data`)
  
  // Find matches and update
  let updated = 0
  let failed = 0
  
  for (const p of productsWithoutOrigin) {
    if (p.url && originByUrl[p.url]) {
      console.log(`  Syncing: ${p.name} (${p.id})`)
      
      const { error: updateError } = await supabase
        .from('products')
        .update({ origin_by_month: originByUrl[p.url] })
        .eq('id', p.id)
      
      if (updateError) {
        console.error(`    Failed: ${updateError.message}`)
        failed++
      } else {
        console.log(`    ✓ Updated`)
        updated++
      }
    }
  }
  
  console.log(`\n✅ Sync complete: ${updated} updated, ${failed} failed`)
}

syncOriginData().catch(console.error)
