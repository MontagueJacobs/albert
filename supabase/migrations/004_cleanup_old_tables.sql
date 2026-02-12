-- Migration: Clean up old tables after consolidation
-- Run this AFTER confirming 003_consolidate_products.sql was successful
-- and that your app is working with the new 'products' table

-- ============================================================================
-- STEP 1: Update views to use new 'products' table
-- ============================================================================

-- Update product_popularity view to use 'products' instead of 'ah_products'
DROP VIEW IF EXISTS public.product_popularity;
CREATE OR REPLACE VIEW public.product_popularity AS
SELECT 
  p.id,
  p.name,
  p.normalized_name,
  p.url,
  p.image_url,
  p.price,
  p.base_score,
  p.seen_count,
  p.last_seen_at
FROM public.products p
ORDER BY p.seen_count DESC, p.last_seen_at DESC;

-- Update user_purchase_summary view (if it exists and references old tables)
DROP VIEW IF EXISTS public.user_purchase_summary;
CREATE OR REPLACE VIEW public.user_purchase_summary AS
SELECT 
  up.user_id,
  up.product_id,
  p.name AS product_name,
  p.image_url,
  p.price,
  p.base_score,
  up.quantity,
  up.purchased_at,
  1 AS purchase_count
FROM public.user_purchases up
LEFT JOIN public.products p ON up.product_id::text = p.id::text;

-- Grant access to views
GRANT SELECT ON public.product_popularity TO anon;
GRANT SELECT ON public.product_popularity TO authenticated;
GRANT SELECT ON public.user_purchase_summary TO authenticated;

-- ============================================================================
-- STEP 2: Drop old product_catalog_view (replaced by querying products directly)
-- ============================================================================

DROP VIEW IF EXISTS public.product_catalog_view;

-- ============================================================================
-- STEP 3: Drop old tables
-- ============================================================================

-- Drop the old ah_products table
DROP TABLE IF EXISTS public.ah_products CASCADE;

-- Drop the old product_catalog table  
DROP TABLE IF EXISTS public.product_catalog CASCADE;

-- ============================================================================
-- STEP 4: Clean up old functions that reference old tables
-- ============================================================================

-- Drop old upsert_user_product function if it references ah_products
DROP FUNCTION IF EXISTS public.upsert_user_product(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC);

-- The new upsert_product function from 003 migration handles this now

-- ============================================================================
-- Summary:
-- ============================================================================
-- 
-- REMOVED:
--   - ah_products table (data migrated to products)
--   - product_catalog table (data migrated to products)
--   - product_catalog_view (no longer needed)
--   - old upsert_user_product function
--
-- UPDATED:
--   - product_popularity view (now uses products table)
--   - user_purchase_summary view (now uses products table)
--
-- REMAINING TABLES:
--   - products (unified product catalog)
--   - users (user accounts)
--   - user_purchases (user purchase history)
--   - user_ah_credentials (encrypted AH cookies)
--
-- ============================================================================
