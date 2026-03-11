-- Migration: Add account protection disabled flag to user_ah_credentials
-- This tracks whether the user has already disabled the "controlecode" setting
-- so we can skip navigating to that page on future scrapes

-- Add new column to track if account protection is already disabled
ALTER TABLE user_ah_credentials 
ADD COLUMN IF NOT EXISTS account_protection_disabled boolean DEFAULT false;

-- Add comment explaining the column
COMMENT ON COLUMN user_ah_credentials.account_protection_disabled IS 
  'Whether the user has disabled account protection (geen controlecode) on their AH account';
