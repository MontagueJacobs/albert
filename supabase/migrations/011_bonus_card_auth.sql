-- Migration: Bonus Card Based Authentication
-- Users are identified by their AH bonus card number, no passwords needed

-- Add bonus card columns to user_ah_credentials (or create a simpler table)
-- Since we're moving away from passwords, let's create a cleaner table

CREATE TABLE IF NOT EXISTS ah_bonus_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bonus_card_number VARCHAR(255) UNIQUE NOT NULL,
    ah_email VARCHAR(255),
    name VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_scrape_at TIMESTAMPTZ,
    scrape_count INTEGER DEFAULT 0
);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_ah_bonus_users_card ON ah_bonus_users(bonus_card_number);
CREATE INDEX IF NOT EXISTS idx_ah_bonus_users_email ON ah_bonus_users(ah_email);

-- Enable RLS
ALTER TABLE ah_bonus_users ENABLE ROW LEVEL SECURITY;

-- Allow public read/write for now (thesis study with known participants)
CREATE POLICY "Allow public access" ON ah_bonus_users
    FOR ALL USING (true) WITH CHECK (true);

-- Add bonus_card_number to user_purchases for direct linking
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'user_purchases' AND column_name = 'bonus_card_number'
    ) THEN
        ALTER TABLE user_purchases ADD COLUMN bonus_card_number VARCHAR(255);
    END IF;
END
$$;

-- Index for purchase lookups by bonus card
CREATE INDEX IF NOT EXISTS idx_user_purchases_bonus_card ON user_purchases(bonus_card_number);

COMMENT ON TABLE ah_bonus_users IS 'Simplified user table - users identified by AH bonus card number during scraping';
COMMENT ON COLUMN ah_bonus_users.bonus_card_number IS 'The AH Bonuskaart number extracted from /klantenkaarten page';
