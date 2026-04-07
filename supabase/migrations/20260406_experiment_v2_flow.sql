-- Experiment V2: Restructured flow with consent → scrape → 3 pre-quizzes →
-- closed questionnaire → learning+dashboard → 3 post-quizzes →
-- closed questionnaire → open questionnaire → complete

-- Add columns for quiz 5 & 6 (AH-specific product ranking pools)
ALTER TABLE experiment_sessions ADD COLUMN IF NOT EXISTS quiz5_data JSONB;
ALTER TABLE experiment_sessions ADD COLUMN IF NOT EXISTS quiz6_data JSONB;
ALTER TABLE experiment_sessions ADD COLUMN IF NOT EXISTS quiz5_item_ids TEXT[];
ALTER TABLE experiment_sessions ADD COLUMN IF NOT EXISTS quiz6_item_ids TEXT[];

-- Add questionnaire response columns for the restructured flow
-- pre_questionnaire = combined closed Likert (awareness + self-perception)
-- post_questionnaire_closed = Likert scales after learning
-- post_questionnaire_open  = open-ended reflection after learning
ALTER TABLE experiment_sessions ADD COLUMN IF NOT EXISTS pre_questionnaire JSONB;
ALTER TABLE experiment_sessions ADD COLUMN IF NOT EXISTS post_questionnaire_closed JSONB;
ALTER TABLE experiment_sessions ADD COLUMN IF NOT EXISTS post_questionnaire_open JSONB;

-- Widen the current_step CHECK to accept both legacy and new flow step names
ALTER TABLE experiment_sessions DROP CONSTRAINT IF EXISTS experiment_sessions_current_step_check;
ALTER TABLE experiment_sessions ADD CONSTRAINT experiment_sessions_current_step_check
  CHECK (current_step IN (
    -- Legacy steps (existing sessions can keep running)
    'intro', 'quiz1', 'quiz2', 'self_perception',
    'intervention', 'quiz3', 'quiz4', 'reflection',
    -- New V2 flow steps
    'consent', 'scrape',
    'pre_quiz_general', 'pre_quiz_ah', 'pre_quiz_personal',
    'pre_questionnaire',
    'learning_dashboard',
    'post_quiz_general', 'post_quiz_ah', 'post_quiz_personal',
    'post_questionnaire', 'post_reflection',
    'complete'
  ));

-- New sessions will start at 'consent' instead of 'intro'
ALTER TABLE experiment_sessions ALTER COLUMN current_step SET DEFAULT 'consent';
