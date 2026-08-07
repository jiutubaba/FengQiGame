CREATE TABLE IF NOT EXISTS leaderboard_daily_collections (
  leaderboard_id BIGINT NOT NULL REFERENCES leaderboards(id) ON DELETE CASCADE,
  player_uid VARCHAR(128) NOT NULL,
  collection_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (leaderboard_id, player_uid, collection_date)
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_daily_collections_date
  ON leaderboard_daily_collections(leaderboard_id, collection_date, player_uid);

INSERT INTO leaderboard_daily_collections(
  leaderboard_id,
  player_uid,
  collection_date,
  created_at
)
SELECT leaderboard_id,
       player_uid,
       last_submitted_on,
       created_at
  FROM leaderboard_entries
 WHERE last_submitted_on IS NOT NULL
ON CONFLICT DO NOTHING;
