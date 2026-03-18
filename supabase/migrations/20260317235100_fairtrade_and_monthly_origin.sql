-- Migration: Add Fairtrade certification and monthly origin tracking
-- Fairtrade products get a sustainability bonus
-- Monthly origin allows tracking seasonal sourcing variations

-- ============================================================================
-- Add Fairtrade certification column
-- ============================================================================

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS is_fairtrade BOOLEAN DEFAULT NULL;

-- ============================================================================
-- Add monthly origin tracking (JSONB)
-- Format: {"jan": "Netherlands", "feb": "Netherlands", "mar": "Spain", ...}
-- This captures seasonal variations in where products are sourced from
-- ============================================================================

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS origin_by_month JSONB DEFAULT NULL;

-- ============================================================================
-- Create indexes for new columns
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_products_is_fairtrade ON products(is_fairtrade) WHERE is_fairtrade = true;
CREATE INDEX IF NOT EXISTS idx_products_origin_by_month ON products USING GIN (origin_by_month);

-- ============================================================================
-- Update the function to include new fields
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
  p_ingredients TEXT,
  p_is_fairtrade BOOLEAN DEFAULT NULL,
  p_origin_by_month JSONB DEFAULT NULL
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
    is_fairtrade = COALESCE(p_is_fairtrade, is_fairtrade),
    origin_by_month = COALESCE(p_origin_by_month, origin_by_month),
    details_scraped_at = NOW(),
    details_scrape_status = 'success',
    updated_at = NOW()
  WHERE id = p_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Comments for documentation
-- ============================================================================

COMMENT ON COLUMN products.is_fairtrade IS 'Product has Fairtrade certification';
COMMENT ON COLUMN products.origin_by_month IS 'Monthly origin tracking in JSONB format: {"jan": "Country", "feb": "Country", ...}';
