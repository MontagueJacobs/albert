#!/usr/bin/env node
/**
 * Run database migrations via REST API
 * Usage: node run_migration.js
 */

const https = require('https');
require('dotenv').config();

// Configuration from .env
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://your-project.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'your-service-role-key';

// SQL statements to execute
const migrations = [
  `ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_fairtrade BOOLEAN DEFAULT NULL`,
  `ALTER TABLE public.products ADD COLUMN IF NOT EXISTS origin_by_month JSONB DEFAULT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_products_is_fairtrade ON products(is_fairtrade) WHERE is_fairtrade = true`,
  `CREATE INDEX IF NOT EXISTS idx_products_origin_by_month ON products USING GIN (origin_by_month)`,
];

async function executeSQL(sql) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`);
    
    const data = JSON.stringify({ query: sql });
    
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ success: true, data: body });
        } else {
          resolve({ success: false, status: res.statusCode, error: body });
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function runMigrations() {
  console.log('Running migrations...\n');
  
  for (let i = 0; i < migrations.length; i++) {
    const sql = migrations[i];
    console.log(`[${i + 1}/${migrations.length}] ${sql.slice(0, 60)}...`);
    
    try {
      const result = await executeSQL(sql);
      if (result.success) {
        console.log('    ✓ Success\n');
      } else {
        console.log(`    ⚠ Status ${result.status}: ${result.error}\n`);
      }
    } catch (err) {
      console.log(`    ✗ Error: ${err.message}\n`);
    }
  }
  
  console.log('\n--- Verifying columns ---');
  
  // Verify using supabase-js
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  
  const { data, error } = await supabase
    .from('products')
    .select('id, is_fairtrade, origin_by_month')
    .limit(1);
    
  if (error) {
    console.log('❌ Columns still missing:', error.message);
    console.log('\n🔧 Please run this SQL manually in Supabase Dashboard > SQL Editor:');
    console.log('---');
    migrations.forEach(sql => console.log(sql + ';'));
    console.log('---');
  } else {
    console.log('✅ Migration successful! Columns are ready.');
  }
}

runMigrations().catch(console.error);
