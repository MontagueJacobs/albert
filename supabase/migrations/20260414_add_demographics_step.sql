-- Add 'demographics' to the allowed current_step values
ALTER TABLE experiment_sessions DROP CONSTRAINT IF EXISTS experiment_sessions_current_step_check;
ALTER TABLE experiment_sessions ADD CONSTRAINT experiment_sessions_current_step_check
  CHECK (current_step IN (
    -- Legacy steps (existing sessions can keep running)
    'intro', 'quiz1', 'quiz2', 'self_perception',
    'intervention', 'quiz3', 'quiz4', 'reflection',
    -- New V2 flow steps
    'consent', 'demographics', 'scrape',
    'pre_quiz_general', 'pre_quiz_ah', 'pre_quiz_personal',
    'pre_questionnaire',
    'learning_dashboard',
    'post_quiz_general', 'post_quiz_ah', 'post_quiz_personal',
    'post_questionnaire', 'post_reflection',
    'complete'
  ));

-- Add demographics column to store responses
ALTER TABLE experiment_sessions ADD COLUMN IF NOT EXISTS demographics JSONB;
