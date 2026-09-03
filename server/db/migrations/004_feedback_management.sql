ALTER TABLE feedback_responses
  ADD COLUMN IF NOT EXISTS is_starred BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_feedback_responses_map_starred_created
  ON feedback_responses(map_id,is_starred DESC,created_at DESC,id DESC);
