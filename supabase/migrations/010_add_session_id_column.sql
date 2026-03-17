-- ============================================================================
-- Migration: Add session_id column for anonymous users
-- Run this in your Supabase SQL editor
-- ============================================================================
-- This enables anonymous scraping without requiring user authentication.
-- Users get a session_id stored in localStorage, which maps to their data.

-- Add session_id column (nullable since existing users won't have it)
ALTER TABLE user_ah_credentials 
ADD COLUMN IF NOT EXISTS session_id TEXT UNIQUE;

-- Make user_id nullable for anonymous users (they don't have auth.users entry)
-- First drop the existing constraint if it exists
ALTER TABLE user_ah_credentials 
ALTER COLUMN user_id DROP NOT NULL;

-- Make ah_email nullable for anonymous users
ALTER TABLE user_ah_credentials 
ALTER COLUMN ah_email DROP NOT NULL;

-- Add encrypted password column for storing AH credentials
ALTER TABLE user_ah_credentials 
ADD COLUMN IF NOT EXISTS ah_password_encrypted TEXT;

-- Add sync_status if it doesn't exist (some migrations may not have it)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_ah_credentials' AND column_name = 'sync_status'
  ) THEN
    ALTER TABLE user_ah_credentials ADD COLUMN sync_status TEXT DEFAULT 'pending';
  END IF;
END $$;

-- Create index on session_id for fast lookups
CREATE INDEX IF NOT EXISTS user_ah_credentials_session_id_idx 
ON user_ah_credentials(session_id) 
WHERE session_id IS NOT NULL;

-- ============================================================================
-- RLS Policies for anonymous users
-- ============================================================================
-- Service role can access all records (needed for server-side operations)
DROP POLICY IF EXISTS "Service role full access credentials" ON user_ah_credentials;
CREATE POLICY "Service role full access credentials" ON user_ah_credentials
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Note: Anonymous users are identified by session_id, not auth.uid()
-- The server handles access control via session ID headers

-- ============================================================================
-- Fix user_purchases table for anonymous users
-- ============================================================================
-- The original FK references auth.users(id), but anonymous users use 
-- user_ah_credentials.id as their user_id. We need to drop this constraint.

-- Drop the existing FK constraint (name may vary based on how table was created)
ALTER TABLE user_purchases 
DROP CONSTRAINT IF EXISTS user_purchases_user_id_fkey;

-- Add last_seen_at column for tracking when product was last seen in scrape
ALTER TABLE user_purchases 
ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Service role needs full access for backend operations
DROP POLICY IF EXISTS "Service role full access purchases" ON user_purchases;
CREATE POLICY "Service role full access purchases" ON user_purchases
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
