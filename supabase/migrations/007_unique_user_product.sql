-- Add unique constraint on (user_id, product_id) to prevent duplicate purchases
-- This allows re-scraping the "eerder gekocht" page without creating duplicates
-- Run this in your Supabase SQL editor

-- First, remove any existing duplicates (keep the earliest one)
DELETE FROM user_purchases a
USING user_purchases b
WHERE a.id > b.id
AND a.user_id = b.user_id
AND a.product_id = b.product_id;

-- Add the unique constraint
ALTER TABLE user_purchases
DROP CONSTRAINT IF EXISTS user_purchases_user_product_unique;

ALTER TABLE user_purchases 
ADD CONSTRAINT user_purchases_user_product_unique 
UNIQUE (user_id, product_id);

-- Add last_seen_at column to track when product was last scraped
ALTER TABLE user_purchases
ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP WITH TIME ZONE;

-- Update existing rows to set last_seen_at = created_at
UPDATE user_purchases 
SET last_seen_at = created_at 
WHERE last_seen_at IS NULL;

-- Allow service role to update purchases
DROP POLICY IF EXISTS "Service role can update any purchases" ON user_purchases;
CREATE POLICY "Service role can update any purchases" ON user_purchases
  FOR UPDATE
  TO service_role
  USING (true);

-- Grant update to service role
GRANT UPDATE ON user_purchases TO service_role;

COMMENT ON CONSTRAINT user_purchases_user_product_unique ON user_purchases IS 
  'Prevents duplicate entries for the same product per user. On re-scrape, existing entries are updated instead of duplicated.';
