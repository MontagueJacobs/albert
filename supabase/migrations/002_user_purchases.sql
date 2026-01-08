-- User purchases table for per-user purchase history
-- Run this in your Supabase SQL editor

-- Create user_purchases table
CREATE TABLE IF NOT EXISTS user_purchases (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  price DECIMAL(10, 2),
  quantity INTEGER DEFAULT 1,
  source TEXT DEFAULT 'browser_extension',
  purchased_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index for faster lookups by user
CREATE INDEX IF NOT EXISTS idx_user_purchases_user_id ON user_purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_user_purchases_purchased_at ON user_purchases(purchased_at);

-- Enable Row Level Security (RLS)
ALTER TABLE user_purchases ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own purchases
CREATE POLICY "Users can view own purchases" ON user_purchases
  FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Users can insert their own purchases
CREATE POLICY "Users can insert own purchases" ON user_purchases
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy: Service role can insert purchases for any user (for backend ingestion)
CREATE POLICY "Service role can insert any purchases" ON user_purchases
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Policy: Service role can select any purchases (for backend operations)
CREATE POLICY "Service role can select any purchases" ON user_purchases
  FOR SELECT
  TO service_role
  USING (true);

-- Grant access to authenticated users
GRANT SELECT, INSERT ON user_purchases TO authenticated;

-- Grant full access to service role
GRANT ALL ON user_purchases TO service_role;

-- ============================================================================
-- User AH credentials table (for storing encrypted AH cookies per user)
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_ah_credentials (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  encrypted_cookies TEXT,  -- Encrypted AH session cookies
  cookies_updated_at TIMESTAMP WITH TIME ZONE,
  ah_email TEXT,  -- Optional: AH account email (for display only)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE user_ah_credentials ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see/manage their own credentials
CREATE POLICY "Users can view own credentials" ON user_ah_credentials
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own credentials" ON user_ah_credentials
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own credentials" ON user_ah_credentials
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own credentials" ON user_ah_credentials
  FOR DELETE
  USING (auth.uid() = user_id);

-- Service role full access
CREATE POLICY "Service role full access on credentials" ON user_ah_credentials
  FOR ALL
  TO service_role
  USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON user_ah_credentials TO authenticated;
GRANT ALL ON user_ah_credentials TO service_role;
