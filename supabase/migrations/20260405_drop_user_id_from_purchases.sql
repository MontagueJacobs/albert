-- Migration: Remove user_id column from user_purchases
-- user_id was a UUID referencing auth.users(id), but we now identify users
-- exclusively by bonus_card_number. The user_id column has been NULL for all
-- records created via the current (bonus card) flow.

-- 1. Drop the unique partial index on (user_id, product_id)
DROP INDEX IF EXISTS idx_user_purchases_user_product;

-- 2. Drop the old user_id index (if it exists from early migrations)
DROP INDEX IF EXISTS idx_user_purchases_user_id;

-- 3. Drop RLS policies that reference user_id
DROP POLICY IF EXISTS "Users can view own purchases" ON user_purchases;
DROP POLICY IF EXISTS "Users can insert own purchases" ON user_purchases;
DROP POLICY IF EXISTS "Users can delete own purchases" ON user_purchases;
DROP POLICY IF EXISTS "Users can update own purchases" ON user_purchases;

-- 3b. Drop the view that depends on user_id (must happen before column drop)
DROP VIEW IF EXISTS public.user_purchase_summary;

-- 4. Drop the user_id column itself
ALTER TABLE user_purchases DROP COLUMN IF EXISTS user_id;

-- 5. Recreate clean RLS policies (bonus_card_number only)
DROP POLICY IF EXISTS "Bonus card users can view own purchases" ON user_purchases;
CREATE POLICY "Bonus card users can view own purchases" ON user_purchases
    FOR SELECT
    USING (bonus_card_number IS NOT NULL);

DROP POLICY IF EXISTS "Bonus card users can insert purchases" ON user_purchases;
CREATE POLICY "Bonus card users can insert purchases" ON user_purchases
    FOR INSERT
    WITH CHECK (bonus_card_number IS NOT NULL);

DROP POLICY IF EXISTS "Bonus card users can update purchases" ON user_purchases;
CREATE POLICY "Bonus card users can update purchases" ON user_purchases
    FOR UPDATE
    USING (bonus_card_number IS NOT NULL);

DROP POLICY IF EXISTS "Service role full access" ON user_purchases;
CREATE POLICY "Service role full access" ON user_purchases
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- 6. Update grants (add UPDATE for anon since bookmarklet now updates last_seen_at)
GRANT SELECT, INSERT, UPDATE ON user_purchases TO service_role;
GRANT SELECT, INSERT ON user_purchases TO authenticated;
GRANT SELECT, INSERT ON user_purchases TO anon;

-- 7. user_purchase_summary view already dropped above (step 3b)

COMMENT ON TABLE user_purchases IS 'User purchase history — identified by bonus_card_number only (user_id removed)';
