-- Track how each participant's cart was sourced:
--   'scraped'       = real AH bonus card data (best)
--   'self_selected' = participant picked 10 from 50 popular items (very good)
--   'predefined'    = auto-assigned based on diet from demographics (fallback)
-- All existing sessions used real scraped data, so backfill them.

ALTER TABLE experiment_sessions ADD COLUMN IF NOT EXISTS cart_source TEXT;

-- Backfill: every existing session that already passed the scrape step used real data
UPDATE experiment_sessions
SET cart_source = 'scraped'
WHERE cart_source IS NULL
  AND bonus_card IS NOT NULL
  AND current_step NOT IN ('consent', 'demographics', 'scrape');
