-- Drop the legacy base_score column from products table.
-- Scoring is now 100% CO₂-based; base_score is no longer used.

ALTER TABLE products DROP COLUMN IF EXISTS base_score;
