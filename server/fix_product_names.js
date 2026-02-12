#!/usr/bin/env node
/**
 * Fix products with incorrect generic names (e.g., "Premium", "Biologisch")
 * by deriving the correct name from their URL slug.
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Generic names that indicate a bug
const GENERIC_NAMES = [
  'Premium', 'Biologisch', 'Bio', 'Nederlands', 'Holland', 'Fresh',
  'Nieuw', 'New', 'Sale', 'Aanbieding', 'Bonus', 'Actie'
];

/**
 * Generate display name from slug
 */
function slugToDisplayName(slug) {
  if (!slug) return null;
  let name = slug.replace(/-/g, ' ');
  name = name.replace(/\b[a-z]/g, c => c.toUpperCase());
  return name;
}

/**
 * Extract slug from URL
 */
function extractSlugFromUrl(url) {
  if (!url) return null;
  const match = url.match(/\/producten\/product\/[^/]+\/([^/?#]+)/);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Normalize product name for search/matching
 */
function normalizeProductName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fixProductNames() {
  console.log('Finding products with generic/incorrect names...\n');

  // Find products where name is a generic word
  const { data: badProducts, error } = await supabase
    .from('products')
    .select('id, name, normalized_name, url')
    .in('name', GENERIC_NAMES);

  if (error) {
    console.error('Error fetching products:', error.message);
    process.exit(1);
  }

  console.log(`Found ${badProducts.length} products with generic names\n`);

  if (badProducts.length === 0) {
    console.log('✅ No products need fixing!');
    return;
  }

  const updates = [];
  const unfixable = [];

  for (const product of badProducts) {
    const slug = extractSlugFromUrl(product.url);
    
    if (slug) {
      const correctName = slugToDisplayName(slug);
      const correctNormalized = normalizeProductName(correctName);
      
      updates.push({
        id: product.id,
        oldName: product.name,
        newName: correctName,
        newNormalized: correctNormalized
      });
    } else {
      unfixable.push(product);
    }
  }

  console.log(`Can fix: ${updates.length}`);
  console.log(`Cannot fix (no valid URL): ${unfixable.length}\n`);

  if (updates.length > 0) {
    console.log('Sample fixes:');
    updates.slice(0, 5).forEach(u => {
      console.log(`  ${u.id}: "${u.oldName}" → "${u.newName}"`);
    });
    console.log();

    // Apply fixes
    console.log('Applying fixes...');
    
    let fixed = 0;
    let failed = 0;
    
    for (const update of updates) {
      const { error: updateError } = await supabase
        .from('products')
        .update({
          name: update.newName,
          normalized_name: update.newNormalized
        })
        .eq('id', update.id);
      
      if (updateError) {
        console.error(`  Failed to fix ${update.id}: ${updateError.message}`);
        failed++;
      } else {
        fixed++;
      }
    }

    console.log(`\n✅ Fixed ${fixed} products`);
    if (failed > 0) {
      console.log(`❌ Failed to fix ${failed} products`);
    }
  }

  if (unfixable.length > 0) {
    console.log('\n⚠️  Products that could not be fixed (no valid URL):');
    unfixable.forEach(p => {
      console.log(`  ${p.id}: "${p.name}" - URL: ${p.url || '(none)'}`);
    });
  }
}

fixProductNames().catch(console.error);
