-- Deduplicate open-ended post-experiment feedback storage.
-- Keep `reflection` as canonical and remove `post_questionnaire_open`.

-- Backfill reflection from post_questionnaire_open for legacy rows where needed.
UPDATE experiment_sessions
SET reflection = post_questionnaire_open
WHERE reflection IS NULL
  AND post_questionnaire_open IS NOT NULL;

-- Remove duplicate column after backfill.
ALTER TABLE experiment_sessions
DROP COLUMN IF EXISTS post_questionnaire_open;
