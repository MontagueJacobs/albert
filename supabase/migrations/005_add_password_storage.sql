-- Migration: Add password storage to user_ah_credentials
-- Run this in your Supabase SQL editor
-- This allows users to save their AH login credentials for automatic scraping

-- Add new columns to user_ah_credentials table
ALTER TABLE user_ah_credentials 
  ADD COLUMN IF NOT EXISTS ah_password_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS sync_status TEXT DEFAULT 'never';

-- Rename encrypted_cookies to cookies_encrypted for consistency (if it exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_ah_credentials' AND column_name = 'encrypted_cookies'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'user_ah_credentials' AND column_name = 'cookies_encrypted'
  ) THEN
    ALTER TABLE user_ah_credentials RENAME COLUMN encrypted_cookies TO cookies_encrypted;
  END IF;
END $$;

-- Add cookies_encrypted column if it doesn't exist
ALTER TABLE user_ah_credentials 
  ADD COLUMN IF NOT EXISTS cookies_encrypted TEXT;

-- Add comment explaining the columns
COMMENT ON COLUMN user_ah_credentials.ah_password_encrypted IS 'AES-256 encrypted AH account password for automatic re-scraping';
COMMENT ON COLUMN user_ah_credentials.cookies_encrypted IS 'AES-256 encrypted session cookies from browser extension';
COMMENT ON COLUMN user_ah_credentials.last_sync_at IS 'Last time products were synced for this user';
COMMENT ON COLUMN user_ah_credentials.sync_status IS 'Status of last sync: success, error, never';

-- ============================================================================
-- Summary:
-- ============================================================================
-- 
-- user_ah_credentials table now has:
--   - ah_email: AH account email
--   - ah_password_encrypted: Encrypted password for auto-login
--   - cookies_encrypted: Encrypted session cookies from bookmarklet/extension
--   - cookies_updated_at: When cookies were last updated
--   - last_sync_at: When products were last synced
--   - sync_status: success/error/never
--
-- This allows:
--   1. Users to save their AH credentials once
--   2. Automatic re-scraping without entering password again
--   3. Tracking sync status per user
--
-- ============================================================================
