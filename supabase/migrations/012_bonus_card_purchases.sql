-- Migration: Make user_purchases work with bonus card only (no auth required)
-- This allows the bookmarklet to record purchases using just the bonus card

-- 1. Make user_id nullable (bonus card users won't have a user_id)
ALTER TABLE user_purchases ALTER COLUMN user_id DROP NOT NULL;

-- 2. Drop the foreign key constraint on user_id so NULL is allowed
-- First find and drop the constraint
DO $$
DECLARE
    constraint_name TEXT;
BEGIN
    SELECT tc.constraint_name INTO constraint_name
    FROM information_schema.table_constraints tc
    WHERE tc.table_name = 'user_purchases' 
      AND tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public';
    
    IF constraint_name IS NOT NULL THEN
        EXECUTE 'ALTER TABLE user_purchases DROP CONSTRAINT ' || constraint_name;
    END IF;
END
$$;

-- 3. Add unique constraint for bonus_card + product (for upsert deduplication)
-- Drop if exists first to make idempotent
DROP INDEX IF EXISTS idx_user_purchases_bonus_card_product;
CREATE UNIQUE INDEX idx_user_purchases_bonus_card_product 
    ON user_purchases(bonus_card_number, product_id) 
    WHERE bonus_card_number IS NOT NULL;

-- 4. Add unique constraint for user_id + product (for authenticated users)
DROP INDEX IF EXISTS idx_user_purchases_user_product;
CREATE UNIQUE INDEX idx_user_purchases_user_product 
    ON user_purchases(user_id, product_id) 
    WHERE user_id IS NOT NULL;

-- 5. Add last_seen_at column for tracking re-imports
ALTER TABLE user_purchases ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ DEFAULT NOW();

-- 6. Update RLS policies to allow bonus card access
DROP POLICY IF EXISTS "Bonus card users can view own purchases" ON user_purchases;
CREATE POLICY "Bonus card users can view own purchases" ON user_purchases
    FOR SELECT
    USING (
        auth.uid() = user_id 
        OR bonus_card_number IS NOT NULL  -- Allow service role to query by bonus card
    );

-- 7. Service role needs full access for bookmarklet ingestion
DROP POLICY IF EXISTS "Service role full access" ON user_purchases;
CREATE POLICY "Service role full access" ON user_purchases
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

COMMENT ON COLUMN user_purchases.bonus_card_number IS 'AH Bonuskaart number - allows purchase tracking without user authentication';
COMMENT ON COLUMN user_purchases.last_seen_at IS 'Last time this purchase was seen during a scrape (for dedup tracking)';
