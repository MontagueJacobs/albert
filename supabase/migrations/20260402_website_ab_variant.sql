-- A/B test: website CO2 display variant
-- Variant A (treatment) = colored CO2 scores (green/yellow/red)
-- Variant B (control)   = neutral/gray CO2 scores (same data, no color coding)

ALTER TABLE ah_bonus_users
  ADD COLUMN IF NOT EXISTS website_variant CHAR(1)
    CHECK (website_variant IN ('A', 'B'));

-- Index for querying by variant (useful for data analysis)
CREATE INDEX IF NOT EXISTS idx_ah_bonus_users_website_variant
  ON ah_bonus_users (website_variant);

COMMENT ON COLUMN ah_bonus_users.website_variant IS
  'A/B test variant: A = colored CO2 display (treatment), B = neutral CO2 display (control)';
