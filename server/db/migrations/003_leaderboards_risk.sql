CREATE TABLE IF NOT EXISTS leaderboards (
  id BIGSERIAL PRIMARY KEY,
  map_id BIGINT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  environment VARCHAR(16) NOT NULL CHECK (environment IN ('release', 'lobby', 'test')),
  leaderboard_key VARCHAR(128) NOT NULL,
  name VARCHAR(160) NOT NULL,
  value_label VARCHAR(80) NOT NULL DEFAULT '积分',
  sort_direction VARCHAR(4) NOT NULL DEFAULT 'desc' CHECK (sort_direction IN ('asc', 'desc')),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (map_id, environment, leaderboard_key)
);

CREATE INDEX IF NOT EXISTS idx_leaderboards_map_environment
  ON leaderboards(map_id, environment, created_at);

CREATE TABLE IF NOT EXISTS leaderboard_entries (
  id BIGSERIAL PRIMARY KEY,
  leaderboard_id BIGINT NOT NULL REFERENCES leaderboards(id) ON DELETE CASCADE,
  player_uid VARCHAR(128) NOT NULL,
  player_name VARCHAR(160) NOT NULL,
  game_level VARCHAR(64) NOT NULL DEFAULT '',
  score NUMERIC(30, 6) NOT NULL DEFAULT 0,
  game_count BIGINT NOT NULL DEFAULT 0 CHECK (game_count >= 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (leaderboard_id, player_uid)
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_entries_rank
  ON leaderboard_entries(leaderboard_id, score, updated_at DESC);

CREATE TABLE IF NOT EXISTS leaderboard_snapshots (
  id BIGSERIAL PRIMARY KEY,
  leaderboard_id BIGINT NOT NULL REFERENCES leaderboards(id) ON DELETE CASCADE,
  entry_count INTEGER NOT NULL DEFAULT 0 CHECK (entry_count >= 0),
  published_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leaderboard_snapshots_latest
  ON leaderboard_snapshots(leaderboard_id, published_at DESC);

CREATE TABLE IF NOT EXISTS leaderboard_snapshot_entries (
  snapshot_id BIGINT NOT NULL REFERENCES leaderboard_snapshots(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL CHECK (rank > 0),
  player_uid VARCHAR(128) NOT NULL,
  player_name VARCHAR(160) NOT NULL,
  game_level VARCHAR(64) NOT NULL DEFAULT '',
  score NUMERIC(30, 6) NOT NULL,
  game_count BIGINT NOT NULL DEFAULT 0 CHECK (game_count >= 0),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (snapshot_id, rank),
  UNIQUE (snapshot_id, player_uid)
);

CREATE TABLE IF NOT EXISTS risk_rules (
  id BIGSERIAL PRIMARY KEY,
  map_id BIGINT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  environment VARCHAR(16) NOT NULL CHECK (environment IN ('release', 'lobby', 'test')),
  rule_key VARCHAR(128) NOT NULL,
  name VARCHAR(160) NOT NULL,
  severity VARCHAR(16) NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (map_id, environment, rule_key)
);

CREATE INDEX IF NOT EXISTS idx_risk_rules_map_environment
  ON risk_rules(map_id, environment, created_at);

CREATE TABLE IF NOT EXISTS risk_events (
  id BIGSERIAL PRIMARY KEY,
  map_id BIGINT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  environment VARCHAR(16) NOT NULL CHECK (environment IN ('release', 'lobby', 'test')),
  event_key VARCHAR(128) NOT NULL,
  rule_id BIGINT REFERENCES risk_rules(id) ON DELETE SET NULL,
  rule_key VARCHAR(128) NOT NULL,
  rule_name VARCHAR(160) NOT NULL,
  severity VARCHAR(16) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  player_uid VARCHAR(128) NOT NULL,
  player_name VARCHAR(160) NOT NULL,
  occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK (occurrence_count > 0),
  status VARCHAR(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'blocked', 'ignored')),
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  handled_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  handled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (map_id, environment, event_key)
);

CREATE INDEX IF NOT EXISTS idx_risk_events_queue
  ON risk_events(map_id, environment, status, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_risk_events_player
  ON risk_events(map_id, environment, player_uid, occurred_at DESC);
