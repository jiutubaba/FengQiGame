ALTER TABLE leaderboards
  DROP CONSTRAINT leaderboards_score_update_mode_check,
  ADD CONSTRAINT leaderboards_score_update_mode_check
    CHECK (score_update_mode IN ('latest', 'best', 'realtime_latest', 'realtime_best'));
