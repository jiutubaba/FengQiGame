ALTER TABLE leaderboards
  ADD COLUMN IF NOT EXISTS score_update_mode VARCHAR(16) NOT NULL DEFAULT 'latest';

ALTER TABLE leaderboards
  DROP CONSTRAINT IF EXISTS leaderboards_score_update_mode_check;

ALTER TABLE leaderboards
  ADD CONSTRAINT leaderboards_score_update_mode_check
  CHECK (score_update_mode IN ('latest', 'best'));
