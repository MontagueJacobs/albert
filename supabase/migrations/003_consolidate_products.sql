-- Migration: Consolidate product_catalog and ah_products into a single 'products' table
-- Run this in your Supabase SQL editor
-- This script is idempotent - safe to run multiple times

-- ============================================================================
-- STEP 1: Create the new unified 'products' table
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.products (
  -- Primary key: use AH product ID (e.g., "wi123456") or generated UUID
  id TEXT PRIMARY KEY,
  
  -- Basic product info (from ah_products)
  name TEXT NOT NULL,
  normalized_name TEXT,
  url TEXT,
  image_url TEXT,
  price DECIMAL(10, 2),
  
  -- Sustainability scoring (from product_catalog)
  base_score INTEGER DEFAULT 5 CHECK (base_score BETWEEN 0 AND 10),
  categories TEXT[] DEFAULT '{}',
  adjustments JSONB DEFAULT '[]',
  suggestions TEXT[] DEFAULT '{}',
  notes TEXT,
  
  -- Alternative names for matching (from product_catalog.names)
  alt_names TEXT[] DEFAULT '{}',
  
  -- Metadata
  source TEXT DEFAULT 'scraped',  -- 'scraped', 'manual', 'api'
  tags JSONB DEFAULT '{}',
  seen_count INTEGER DEFAULT 1,
  contributed_by UUID[] DEFAULT '{}',  -- Users who contributed this product
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_products_normalized_name ON products(normalized_name);
CREATE INDEX IF NOT EXISTS idx_products_name_gin ON products USING gin(to_tsvector('simple', name));
CREATE INDEX IF NOT EXISTS idx_products_categories ON products USING gin(categories);
CREATE INDEX IF NOT EXISTS idx_products_last_seen ON products(last_seen_at DESC);

-- ============================================================================
-- STEP 2: Migrate data from ah_products (scraped products)
-- ============================================================================

INSERT INTO products (id, name, normalized_name, url, image_url, source, tags, updated_at, last_seen_at)
SELECT 
  id,
  name,
  normalized_name,
  url,
  image_url,
  COALESCE(source, 'scraped'),
  COALESCE(tags, '{}'),
  COALESCE(updated_at, NOW()),
  COALESCE(updated_at, NOW())
FROM ah_products
ON CONFLICT (id) DO UPDATE SET
  name = COALESCE(EXCLUDED.name, products.name),
  normalized_name = COALESCE(EXCLUDED.normalized_name, products.normalized_name),
  url = COALESCE(EXCLUDED.url, products.url),
  image_url = COALESCE(EXCLUDED.image_url, products.image_url),
  updated_at = NOW();

-- ============================================================================
-- STEP 3: Migrate data from product_catalog (sustainability scores)
-- This updates existing products or inserts new ones
-- ============================================================================

INSERT INTO products (id, name, normalized_name, alt_names, base_score, categories, adjustments, suggestions, notes, source)
SELECT 
  id,
  names[1],  -- Use first name as primary name
  LOWER(REGEXP_REPLACE(names[1], '[^a-zA-Z0-9]', '', 'g')),
  names,
  base_score,
  categories,
  adjustments,
  suggestions,
  notes,
  'curated'
FROM product_catalog
ON CONFLICT (id) DO UPDATE SET
  base_score = EXCLUDED.base_score,
  categories = EXCLUDED.categories,
  adjustments = EXCLUDED.adjustments,
  suggestions = EXCLUDED.suggestions,
  notes = EXCLUDED.notes,
  alt_names = EXCLUDED.alt_names,
  updated_at = NOW();

-- ============================================================================
-- STEP 4: Enable Row Level Security
-- ============================================================================

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- Everyone can read products (it's a public catalog)
DROP POLICY IF EXISTS "Anyone can view products" ON products;
CREATE POLICY "Anyone can view products" ON products
  FOR SELECT
  USING (true);

-- Only service role can insert/update products
DROP POLICY IF EXISTS "Service role can manage products" ON products;
CREATE POLICY "Service role can manage products" ON products
  FOR ALL
  TO service_role
  USING (true);

-- Authenticated users can insert new products (from scraping)
DROP POLICY IF EXISTS "Authenticated users can insert products" ON products;
CREATE POLICY "Authenticated users can insert products" ON products
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Grant permissions
GRANT SELECT ON products TO anon;
GRANT SELECT ON products TO authenticated;
GRANT ALL ON products TO service_role;

-- ============================================================================
-- STEP 5: Update user_purchases to reference products table
-- ============================================================================

-- Add foreign key constraint if not exists (soft reference for flexibility)
-- We don't enforce FK because products might not exist yet when user purchases

-- ============================================================================
-- STEP 6: Create helper function for upserting products
-- ============================================================================

CREATE OR REPLACE FUNCTION upsert_product(
  p_id TEXT,
  p_name TEXT,
  p_normalized_name TEXT DEFAULT NULL,
  p_url TEXT DEFAULT NULL,
  p_image_url TEXT DEFAULT NULL,
  p_price DECIMAL DEFAULT NULL,
  p_source TEXT DEFAULT 'scraped',
  p_user_id UUID DEFAULT NULL
)
RETURNS TEXT AS $$
DECLARE
  v_normalized TEXT;
BEGIN
  -- Generate normalized name if not provided
  v_normalized := COALESCE(p_normalized_name, LOWER(REGEXP_REPLACE(p_name, '[^a-zA-Z0-9]', '', 'g')));
  
  INSERT INTO products (id, name, normalized_name, url, image_url, price, source, contributed_by, last_seen_at)
  VALUES (
    p_id,
    p_name,
    v_normalized,
    p_url,
    p_image_url,
    p_price,
    p_source,
    CASE WHEN p_user_id IS NOT NULL THEN ARRAY[p_user_id] ELSE '{}' END,
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    name = COALESCE(EXCLUDED.name, products.name),
    normalized_name = COALESCE(EXCLUDED.normalized_name, products.normalized_name),
    url = COALESCE(EXCLUDED.url, products.url),
    image_url = COALESCE(EXCLUDED.image_url, products.image_url),
    price = COALESCE(EXCLUDED.price, products.price),
    seen_count = products.seen_count + 1,
    contributed_by = (
      SELECT ARRAY_AGG(DISTINCT u)
      FROM UNNEST(ARRAY_CAT(products.contributed_by, CASE WHEN p_user_id IS NOT NULL THEN ARRAY[p_user_id] ELSE '{}' END)) AS u
    ),
    last_seen_at = NOW(),
    updated_at = NOW();
  
  RETURN p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION upsert_product TO authenticated;
GRANT EXECUTE ON FUNCTION upsert_product TO service_role;

-- ============================================================================
-- STEP 7: Create view for backward compatibility with product_catalog queries
-- ============================================================================

CREATE OR REPLACE VIEW product_catalog_view AS
SELECT 
  id,
  COALESCE(alt_names, ARRAY[name]) AS names,
  base_score,
  categories,
  adjustments,
  suggestions,
  notes
FROM products
WHERE base_score IS NOT NULL;

-- ============================================================================
-- OPTIONAL: Drop old tables (uncomment when ready)
-- ============================================================================

-- WARNING: Only run these after confirming migration is successful!
-- DROP TABLE IF EXISTS ah_products;
-- DROP TABLE IF EXISTS product_catalog;

-- ============================================================================
-- Summary of changes:
-- ============================================================================
-- 
-- OLD SCHEMA:
--   product_catalog: id, names[], base_score, categories[], adjustments, suggestions[], notes
--   ah_products: id, name, normalized_name, url, image_url, source, tags, updated_at
--
-- NEW SCHEMA:
--   products: Combined table with all fields from both + additional metadata
--   user_purchases: Links users to products (unchanged)
--
-- The 'products' table now serves as:
--   1. Master product catalog (all scraped products)
--   2. Sustainability scoring database (base_score, categories, adjustments)
--   3. Product metadata store (images, urls, prices)
--
-- ============================================================================
