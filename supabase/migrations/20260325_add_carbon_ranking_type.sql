-- Migration: Add carbon_ranking type to questionnaire_responses
-- This migration extends the questionnaire_type check constraint to allow 'carbon_ranking'

-- Drop the existing check constraint
ALTER TABLE questionnaire_responses
DROP CONSTRAINT IF EXISTS questionnaire_responses_questionnaire_type_check;

-- Add the new check constraint with carbon_ranking
ALTER TABLE questionnaire_responses
ADD CONSTRAINT questionnaire_responses_questionnaire_type_check 
CHECK (questionnaire_type IN ('pre', 'post', 'carbon_ranking'));

-- Update the comment
COMMENT ON COLUMN questionnaire_responses.questionnaire_type IS 'Type: "pre" (before dashboard), "post" (after viewing dashboard), or "carbon_ranking" (product sorting game)';
COMMENT ON COLUMN questionnaire_responses.responses IS 'JSON object containing responses. For carbon_ranking: user_ranking, score, max_score, percentage, detailed_results';
