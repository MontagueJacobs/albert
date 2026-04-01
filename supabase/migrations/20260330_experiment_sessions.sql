-- Experiment sessions table for multi-step CO2 awareness experiment
-- Each row tracks one participant's full experiment journey

CREATE TABLE IF NOT EXISTS experiment_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Participant identification (anonymized via bonus card hash or direct)
  bonus_card TEXT NOT NULL,
  
  -- A/B test assignment: 'A' = basic intervention, 'B' = detailed intervention
  ab_variant CHAR(1) NOT NULL CHECK (ab_variant IN ('A', 'B')),
  
  -- Current step tracking (for resume support)
  current_step TEXT NOT NULL DEFAULT 'intro' CHECK (current_step IN (
    'intro', 'quiz1', 'quiz2', 'self_perception', 
    'intervention', 'quiz3', 'quiz4', 'reflection', 'complete'
  )),
  
  -- Consent given
  consent_given BOOLEAN DEFAULT FALSE,
  
  -- Quiz data (JSONB) - each stores { items: [...], user_ranking: [...], score, max_score }
  quiz1_data JSONB,  -- Generic baseline (catalog products)
  quiz2_data JSONB,  -- Personal baseline (user's purchased products)
  quiz3_data JSONB,  -- Post-intervention generic (different catalog products)
  quiz4_data JSONB,  -- Transfer test personal (different purchased products)
  
  -- Items used in each quiz (to prevent overlap)
  quiz1_item_ids TEXT[],
  quiz2_item_ids TEXT[],
  quiz3_item_ids TEXT[],
  quiz4_item_ids TEXT[],
  
  -- Self-perception Likert responses (pre-intervention)
  self_perception JSONB,
  
  -- Reflection responses (post-intervention)
  reflection JSONB,
  
  -- Timestamps
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for quick lookup by bonus card
CREATE INDEX IF NOT EXISTS idx_experiment_sessions_bonus_card 
  ON experiment_sessions(bonus_card);

-- Each bonus card can have multiple experiment sessions (allow retakes)
-- but we'll typically use the latest one
CREATE INDEX IF NOT EXISTS idx_experiment_sessions_latest 
  ON experiment_sessions(bonus_card, started_at DESC);
