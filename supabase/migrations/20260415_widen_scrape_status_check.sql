-- Widen the details_scrape_status CHECK to include 'incomplete' and 'non_food'
-- used by the category scraper enrichment flow
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_details_scrape_status_check;
ALTER TABLE products ADD CONSTRAINT products_details_scrape_status_check
  CHECK (details_scrape_status IN ('pending', 'success', 'failed', 'not_found', 'incomplete', 'non_food'));
