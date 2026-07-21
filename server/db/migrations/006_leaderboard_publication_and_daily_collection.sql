ALTER TABLE leaderboard_entries
  ADD COLUMN IF NOT EXISTS last_submitted_on DATE;

ALTER TABLE leaderboard_snapshot_entries
  ADD COLUMN IF NOT EXISTS achieved_at TIMESTAMPTZ;
