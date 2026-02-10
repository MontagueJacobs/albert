-- Migration: Add detailed product information columns
-- These fields will be populated by scraping individual AH product pages
-- Run this in your Supabase SQL editor

-- ============================================================================
-- Add new columns to the products table for detailed product information
-- ============================================================================

-- Dietary information
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_vegan BOOLEAN DEFAULT NULL;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_vegetarian BOOLEAN DEFAULT NULL;

-- Organic/Bio certification
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_organic BOOLEAN DEFAULT NULL;

-- Nutri-Score (A, B, C, D, E, or NULL if not available)
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS nutri_score CHAR(1) DEFAULT NULL 
  CHECK (nutri_score IS NULL OR nutri_score IN ('A', 'B', 'C', 'D', 'E'));

-- Origin/Country of product
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS origin_country TEXT DEFAULT NULL;

-- Additional useful fields from product pages
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS brand TEXT DEFAULT NULL;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS unit_size TEXT DEFAULT NULL;  -- e.g., "500g", "1L"
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS allergens TEXT[] DEFAULT '{}';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS ingredients TEXT DEFAULT NULL;

-- Track when we last scraped the detailed info
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS details_scraped_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;

-- Track scraping status to avoid re-scraping too often
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS details_scrape_status TEXT DEFAULT 'pending'
  CHECK (details_scrape_status IN ('pending', 'success', 'failed', 'not_found'));

-- ============================================================================
-- Create indexes for new columns used in queries
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_products_is_vegan ON products(is_vegan) WHERE is_vegan = true;
CREATE INDEX IF NOT EXISTS idx_products_is_organic ON products(is_organic) WHERE is_organic = true;
CREATE INDEX IF NOT EXISTS idx_products_nutri_score ON products(nutri_score);
CREATE INDEX IF NOT EXISTS idx_products_origin_country ON products(origin_country);
CREATE INDEX IF NOT EXISTS idx_products_details_status ON products(details_scrape_status);

-- ============================================================================
-- Create a view for products that need detail scraping
-- ============================================================================

CREATE OR REPLACE VIEW products_pending_details AS
SELECT id, name, url, details_scrape_status, details_scraped_at
FROM products
WHERE url IS NOT NULL 
  AND url != ''
  AND (details_scrape_status = 'pending' 
       OR details_scraped_at IS NULL 
       OR details_scraped_at < NOW() - INTERVAL '30 days')
ORDER BY seen_count DESC, last_seen_at DESC
LIMIT 1000;

-- ============================================================================
-- Function to update product details (called from the scraper)
-- ============================================================================

CREATE OR REPLACE FUNCTION update_product_details(
  p_id TEXT,
  p_is_vegan BOOLEAN,
  p_is_vegetarian BOOLEAN,
  p_is_organic BOOLEAN,
  p_nutri_score CHAR(1),
  p_origin_country TEXT,
  p_brand TEXT,
  p_unit_size TEXT,
  p_allergens TEXT[],
  p_ingredients TEXT
) RETURNS void AS $$
BEGIN
  UPDATE products SET
    is_vegan = p_is_vegan,
    is_vegetarian = p_is_vegetarian,
    is_organic = p_is_organic,
    nutri_score = p_nutri_score,
    origin_country = p_origin_country,
    brand = p_brand,
    unit_size = p_unit_size,
    allergens = p_allergens,
    ingredients = p_ingredients,
    details_scraped_at = NOW(),
    details_scrape_status = 'success',
    updated_at = NOW()
  WHERE id = p_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON COLUMN products.is_vegan IS 'Product is suitable for vegans (no animal products)';
COMMENT ON COLUMN products.is_vegetarian IS 'Product is suitable for vegetarians';
COMMENT ON COLUMN products.is_organic IS 'Product has organic/biological certification';
COMMENT ON COLUMN products.nutri_score IS 'Nutri-Score rating from A (best) to E (worst)';
COMMENT ON COLUMN products.origin_country IS 'Country of origin (e.g., Netherlands, Spain, etc.)';
COMMENT ON COLUMN products.brand IS 'Product brand name';
COMMENT ON COLUMN products.unit_size IS 'Package size (e.g., 500g, 1L)';
COMMENT ON COLUMN products.allergens IS 'List of allergens';
COMMENT ON COLUMN products.ingredients IS 'Full ingredients list';
