-- Migration: Create questionnaire_responses table for pre/post exposure surveys
-- Date: 2026-03-25

CREATE TABLE IF NOT EXISTS questionnaire_responses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bonus_card VARCHAR(20) NOT NULL,
  questionnaire_type VARCHAR(20) NOT NULL CHECK (questionnaire_type IN ('pre', 'post')),
  responses JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Unique constraint: one pre and one post response per bonus card
  UNIQUE(bonus_card, questionnaire_type)
);

-- Index for fast lookup by bonus card
CREATE INDEX IF NOT EXISTS idx_questionnaire_responses_bonus_card 
  ON questionnaire_responses(bonus_card);

-- Index for filtering by type
CREATE INDEX IF NOT EXISTS idx_questionnaire_responses_type 
  ON questionnaire_responses(questionnaire_type);

-- Enable Row Level Security
ALTER TABLE questionnaire_responses ENABLE ROW LEVEL SECURITY;

-- Policy: Allow inserts from service role (server-side)
CREATE POLICY "Allow service role full access" ON questionnaire_responses
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Comment for documentation
COMMENT ON TABLE questionnaire_responses IS 'Stores pre and post exposure questionnaire responses linked to bonus card numbers';
COMMENT ON COLUMN questionnaire_responses.questionnaire_type IS 'Either "pre" (before dashboard) or "post" (after viewing dashboard)';
COMMENT ON COLUMN questionnaire_responses.responses IS 'JSON object containing question IDs and their answers';
