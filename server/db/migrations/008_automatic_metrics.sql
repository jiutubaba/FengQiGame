CREATE TABLE IF NOT EXISTS fq_metric_sessions (
  map_id BIGINT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  environment VARCHAR(16) NOT NULL CHECK (environment IN ('release', 'lobby', 'test')),
  session_id TEXT NOT NULL CHECK (char_length(session_id) BETWEEN 1 AND 512),
  started_at TIMESTAMPTZ NOT NULL,
  last_heartbeat_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (map_id, environment, session_id)
);

CREATE INDEX IF NOT EXISTS idx_fq_metric_sessions_started
  ON fq_metric_sessions(map_id, environment, started_at);
CREATE INDEX IF NOT EXISTS idx_fq_metric_sessions_online
  ON fq_metric_sessions(map_id, environment, last_heartbeat_at DESC)
  WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS fq_metric_session_activity (
  map_id BIGINT NOT NULL,
  environment VARCHAR(16) NOT NULL,
  session_id TEXT NOT NULL,
  player_uid VARCHAR(128) NOT NULL,
  active_date DATE NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (map_id, environment, session_id, player_uid, active_date),
  FOREIGN KEY (map_id, environment, session_id)
    REFERENCES fq_metric_sessions(map_id, environment, session_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_fq_metric_activity_day_uid
  ON fq_metric_session_activity(map_id, environment, active_date, player_uid);
CREATE INDEX IF NOT EXISTS idx_fq_metric_activity_uid_day
  ON fq_metric_session_activity(map_id, environment, player_uid, active_date);
CREATE INDEX IF NOT EXISTS idx_fq_metric_activity_online
  ON fq_metric_session_activity(map_id, environment, active_date, last_seen_at DESC);
