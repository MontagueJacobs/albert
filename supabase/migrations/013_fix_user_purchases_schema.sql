-- Migration: Fix user_purchases schema for bonus card support
-- This ensures the table has all required columns and constraints

-- ============================================================================
-- 1. Ensure bonus_card_number column exists
-- ============================================================================
ALTER TABLE user_purchases ADD COLUMN IF NOT EXISTS bonus_card_number VARCHAR(255);

-- ============================================================================
-- 2. Make user_id nullable (bonus card users won't have a user_id)
-- ============================================================================
ALTER TABLE user_purchases ALTER COLUMN user_id DROP NOT NULL;

-- ============================================================================
-- 3. Drop any foreign key constraint on user_id that requires auth.users
-- ============================================================================
DO $$
DECLARE
    constraint_name TEXT;
BEGIN
    -- Find foreign key constraints referencing auth.users
    FOR constraint_name IN
        SELECT tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage ccu 
            ON tc.constraint_name = ccu.constraint_name
        WHERE tc.table_name = 'user_purchases' 
          AND tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = 'public'
    LOOP
        EXECUTE 'ALTER TABLE user_purchases DROP CONSTRAINT IF EXISTS ' || constraint_name;
    END LOOP;
END
$$;

-- ============================================================================
-- 4. Ensure required columns exist
-- ============================================================================
ALTER TABLE user_purchases ADD COLUMN IF NOT EXISTS product_url TEXT;
ALTER TABLE user_purchases ADD COLUMN IF NOT EXISTS scraped_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE user_purchases ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE user_purchases ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'bookmarklet';

-- ============================================================================
-- 5. Update scraped_at for existing rows that might have NULL
-- ============================================================================
UPDATE user_purchases SET scraped_at = COALESCE(created_at, NOW()) WHERE scraped_at IS NULL;

-- ============================================================================
-- 6. Create unique indexes for upsert support (drop first to be idempotent)
-- ============================================================================
DROP INDEX IF EXISTS idx_user_purchases_bonus_card_product;
CREATE UNIQUE INDEX idx_user_purchases_bonus_card_product 
    ON user_purchases(bonus_card_number, product_id) 
    WHERE bonus_card_number IS NOT NULL;

DROP INDEX IF EXISTS idx_user_purchases_user_product;
CREATE UNIQUE INDEX idx_user_purchases_user_product 
    ON user_purchases(user_id, product_id) 
    WHERE user_id IS NOT NULL;

-- ============================================================================
-- 7. Create index for bonus card lookups
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_user_purchases_bonus_card ON user_purchases(bonus_card_number);

-- ============================================================================
-- 8. Update RLS policies for bonus card access
-- ============================================================================
DROP POLICY IF EXISTS "Users can view own purchases" ON user_purchases;
CREATE POLICY "Users can view own purchases" ON user_purchases
    FOR SELECT
    USING (
        auth.uid()::text = user_id::text
        OR bonus_card_number IS NOT NULL
    );

DROP POLICY IF EXISTS "Users can insert own purchases" ON user_purchases;
CREATE POLICY "Users can insert own purchases" ON user_purchases
    FOR INSERT
    WITH CHECK (
        auth.uid()::text = user_id::text
        OR bonus_card_number IS NOT NULL
    );

DROP POLICY IF EXISTS "Service role full access" ON user_purchases;
CREATE POLICY "Service role full access" ON user_purchases
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- ============================================================================
-- 9. Grant necessary permissions
-- ============================================================================
GRANT SELECT, INSERT, UPDATE ON user_purchases TO service_role;
GRANT SELECT, INSERT ON user_purchases TO authenticated;
GRANT SELECT, INSERT ON user_purchases TO anon;

-- ============================================================================
-- Done!
-- ============================================================================
COMMENT ON TABLE user_purchases IS 'User purchase history - supports both authenticated users and bonus card users';
COMMENT ON COLUMN user_purchases.bonus_card_number IS 'AH Bonuskaart number - allows tracking without authentication';
COMMENT ON COLUMN user_purchases.user_id IS 'Optional - NULL for bonus card only users';
