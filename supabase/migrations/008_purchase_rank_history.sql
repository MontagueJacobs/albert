-- Track purchase rank history over multiple scrapes
-- This allows us to see how product purchase order changes over time
-- and detect new purchases when a product jumps to rank 1

-- Create purchase_rank_history table
CREATE TABLE IF NOT EXISTS purchase_rank_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  purchase_rank INTEGER NOT NULL,  -- Position when sorted by "laatst gekocht" (1 = most recent)
  scraped_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),  -- When this scrape was performed
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_purchase_rank_user_id ON purchase_rank_history(user_id);
CREATE INDEX IF NOT EXISTS idx_purchase_rank_product_id ON purchase_rank_history(product_id);
CREATE INDEX IF NOT EXISTS idx_purchase_rank_scraped_at ON purchase_rank_history(scraped_at);
CREATE INDEX IF NOT EXISTS idx_purchase_rank_user_product ON purchase_rank_history(user_id, product_id);

-- Enable Row Level Security (RLS)
ALTER TABLE purchase_rank_history ENABLE ROW LEVEL SECURITY;

-- Policies
DROP POLICY IF EXISTS "Users can view own rank history" ON purchase_rank_history;
DROP POLICY IF EXISTS "Users can insert own rank history" ON purchase_rank_history;
DROP POLICY IF EXISTS "Service role can insert any rank history" ON purchase_rank_history;
DROP POLICY IF EXISTS "Service role can select any rank history" ON purchase_rank_history;

-- Policy: Users can only see their own rank history
CREATE POLICY "Users can view own rank history" ON purchase_rank_history
  FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Users can insert their own rank history
CREATE POLICY "Users can insert own rank history" ON purchase_rank_history
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy: Service role can insert rank history for any user
CREATE POLICY "Service role can insert any rank history" ON purchase_rank_history
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Policy: Service role can select any rank history
CREATE POLICY "Service role can select any rank history" ON purchase_rank_history
  FOR SELECT
  TO service_role
  USING (true);

-- Grant permissions
GRANT ALL ON purchase_rank_history TO service_role;
GRANT SELECT, INSERT ON purchase_rank_history TO authenticated;

-- Add helpful view for analyzing rank changes
CREATE OR REPLACE VIEW purchase_rank_changes AS
SELECT 
  r1.user_id,
  r1.product_id,
  r1.product_name,
  r1.purchase_rank as current_rank,
  r1.scraped_at as current_scrape,
  r2.purchase_rank as previous_rank,
  r2.scraped_at as previous_scrape,
  COALESCE(r2.purchase_rank, 999) - r1.purchase_rank as rank_change  -- Positive = moved up (more recent purchase)
FROM purchase_rank_history r1
LEFT JOIN LATERAL (
  SELECT purchase_rank, scraped_at
  FROM purchase_rank_history r2
  WHERE r2.user_id = r1.user_id
    AND r2.product_id = r1.product_id
    AND r2.scraped_at < r1.scraped_at
  ORDER BY r2.scraped_at DESC
  LIMIT 1
) r2 ON true
WHERE r1.scraped_at = (
  SELECT MAX(scraped_at) 
  FROM purchase_rank_history 
  WHERE user_id = r1.user_id
);

COMMENT ON TABLE purchase_rank_history IS 
  'Tracks purchase rank (position when sorted by last purchased) across multiple scrapes. Lower rank = more recently purchased.';

COMMENT ON VIEW purchase_rank_changes IS 
  'Shows rank changes between the most recent scrape and the previous one. Positive rank_change means a more recent purchase.';
