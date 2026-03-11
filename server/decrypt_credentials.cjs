#!/usr/bin/env node
/**
 * Decrypt and display all stored AH credentials
 * Usage: node decrypt_credentials.cjs [--csv]
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
const encryptionKey = process.env.COOKIES_ENCRYPTION_KEY || 'default-key-change-in-production'

const exportCsv = process.argv.includes('--csv')

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

function decryptPassword(encryptedValue) {
  if (!encryptedValue) return null
  try {
    const [ivHex, encrypted] = encryptedValue.split(':')
    const iv = Buffer.from(ivHex, 'hex')
    const decipher = crypto.createDecipheriv(
      'aes-256-cbc',
      crypto.scryptSync(encryptionKey, 'salt', 32),
      iv
    )
    return decipher.update(encrypted, 'hex', 'utf8') + decipher.final('utf8')
  } catch (e) {
    return `[DECRYPTION FAILED: ${e.message}]`
  }
}

async function main() {
  console.log('Fetching credentials from Supabase...\n')
  
  const { data, error } = await supabase
    .from('user_ah_credentials')
    .select('user_id, ah_email, ah_password_encrypted, created_at, updated_at')
  
  if (error) {
    console.error('Error fetching credentials:', error.message)
    process.exit(1)
  }
  
  if (!data || data.length === 0) {
    console.log('No credentials found.')
    process.exit(0)
  }
  
  console.log(`Found ${data.length} credential(s):\n`)
  
  // Prepare decrypted data
  const decryptedData = data.map(row => ({
    user_id: row.user_id,
    ah_email: row.ah_email || '',
    ah_password: decryptPassword(row.ah_password_encrypted) || '',
    created_at: row.created_at || '',
    updated_at: row.updated_at || ''
  }))
  
  // Export to CSV if requested
  if (exportCsv) {
    const csvHeader = 'user_id,ah_email,ah_password,created_at,updated_at'
    const csvRows = decryptedData.map(row => 
      `"${row.user_id}","${row.ah_email}","${row.ah_password.replace(/"/g, '""')}","${row.created_at}","${row.updated_at}"`
    )
    const csvContent = [csvHeader, ...csvRows].join('\n')
    
    const outputPath = path.join(__dirname, 'ah_credentials_export.csv')
    fs.writeFileSync(outputPath, csvContent)
    console.log(`CSV exported to: ${outputPath}\n`)
  }
  
  // Print to console
  console.log('='.repeat(80))
  
  for (const row of decryptedData) {
    console.log(`User ID:    ${row.user_id}`)
    console.log(`AH Email:   ${row.ah_email || '(not set)'}`)
    console.log(`AH Password: ${row.ah_password || '(not set)'}`)
    console.log(`Created:    ${row.created_at || 'N/A'}`)
    console.log(`Updated:    ${row.updated_at || 'N/A'}`)
    console.log('-'.repeat(80))
  }
  
  if (!exportCsv) {
    console.log('\nTip: Run with --csv to export to spreadsheet')
  }
}

main().catch(console.error)
