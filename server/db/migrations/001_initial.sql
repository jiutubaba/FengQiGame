CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(64) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  phone VARCHAR(32),
  role VARCHAR(16) NOT NULL CHECK (role IN ('admin', 'user')),
  status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64) PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip VARCHAR(128),
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS maps (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL UNIQUE,
  owner_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  runtime_env VARCHAR(16) NOT NULL DEFAULT 'release' CHECK (runtime_env IN ('release', 'lobby', 'test')),
  cover_path TEXT,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS map_permissions (
  map_id BIGINT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permissions TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  granted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (map_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_map_permissions_user ON map_permissions(user_id);

CREATE TABLE IF NOT EXISTS map_configs (
  map_id BIGINT PRIMARY KEY REFERENCES maps(id) ON DELETE CASCADE,
  config JSONB NOT NULL DEFAULT '{"ranks":[],"gifts":[],"anchorGifts":[],"globals":[],"dayLimits":[],"randomGroups":[],"preloadCode":""}'::jsonb,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS players (
  id BIGSERIAL PRIMARY KEY,
  map_id BIGINT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  environment VARCHAR(16) NOT NULL DEFAULT 'release' CHECK (environment IN ('release', 'lobby', 'test')),
  uid VARCHAR(128) NOT NULL,
  name VARCHAR(160) NOT NULL,
  level INTEGER NOT NULL DEFAULT 0 CHECK (level >= 0),
  game_level VARCHAR(32) NOT NULL DEFAULT '',
  item_ban BOOLEAN NOT NULL DEFAULT FALSE,
  data_ban BOOLEAN NOT NULL DEFAULT FALSE,
  rank_ban BOOLEAN NOT NULL DEFAULT FALSE,
  profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_active_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (map_id, environment, uid)
);
CREATE INDEX IF NOT EXISTS idx_players_map_name ON players(map_id, environment, name);
CREATE INDEX IF NOT EXISTS idx_players_map_active ON players(map_id, environment, last_active_at DESC);

CREATE TABLE IF NOT EXISTS gifts (
  id BIGSERIAL PRIMARY KEY,
  map_id BIGINT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  gift_key VARCHAR(128) NOT NULL,
  name VARCHAR(160) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  default_value NUMERIC(18, 4) NOT NULL DEFAULT 1,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (map_id, gift_key)
);

CREATE TABLE IF NOT EXISTS gift_grants (
  id BIGSERIAL PRIMARY KEY,
  map_id BIGINT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  environment VARCHAR(16) NOT NULL DEFAULT 'release' CHECK (environment IN ('release', 'lobby', 'test')),
  gift_id BIGINT NOT NULL REFERENCES gifts(id) ON DELETE RESTRICT,
  player_id BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  quantity NUMERIC(18, 4) NOT NULL DEFAULT 1,
  boolean_value BOOLEAN NOT NULL DEFAULT FALSE,
  granted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gift_grants_map_time ON gift_grants(map_id, granted_at DESC);

CREATE TABLE IF NOT EXISTS anchors (
  id BIGSERIAL PRIMARY KEY,
  map_id BIGINT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  environment VARCHAR(16) NOT NULL DEFAULT 'release' CHECK (environment IN ('release', 'lobby', 'test')),
  name VARCHAR(160) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  gift_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (map_id, environment, name)
);

CREATE TABLE IF NOT EXISTS tracking_points (
  id BIGSERIAL PRIMARY KEY,
  map_id BIGINT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  environment VARCHAR(16) NOT NULL DEFAULT 'release' CHECK (environment IN ('release', 'lobby', 'test')),
  point_key VARCHAR(128) NOT NULL,
  name VARCHAR(160) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  trigger_count BIGINT NOT NULL DEFAULT 0 CHECK (trigger_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (map_id, environment, point_key)
);

CREATE TABLE IF NOT EXISTS map_logs (
  id BIGSERIAL PRIMARY KEY,
  map_id BIGINT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  environment VARCHAR(16) NOT NULL DEFAULT 'release' CHECK (environment IN ('release', 'lobby', 'test')),
  context TEXT NOT NULL,
  player_count BIGINT NOT NULL DEFAULT 0,
  upload_count BIGINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (map_id, environment, context)
);
CREATE INDEX IF NOT EXISTS idx_map_logs_map_time ON map_logs(map_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS map_files (
  id BIGSERIAL PRIMARY KEY,
  map_id BIGINT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  kind VARCHAR(16) NOT NULL DEFAULT 'file' CHECK (kind IN ('file', 'folder')),
  original_name VARCHAR(255) NOT NULL,
  storage_name VARCHAR(255),
  relative_path TEXT NOT NULL,
  mime_type VARCHAR(160),
  size_bytes BIGINT NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  sha256 CHAR(64),
  uploaded_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (map_id, relative_path)
);
CREATE INDEX IF NOT EXISTS idx_map_files_parent ON map_files(map_id, relative_path);

CREATE TABLE IF NOT EXISTS map_metrics (
  map_id BIGINT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  environment VARCHAR(16) NOT NULL DEFAULT 'release' CHECK (environment IN ('release', 'lobby', 'test')),
  metric_date DATE NOT NULL,
  cumulative_users BIGINT NOT NULL DEFAULT 0,
  online_users BIGINT NOT NULL DEFAULT 0,
  total_game_count BIGINT NOT NULL DEFAULT 0,
  daily_new_users BIGINT NOT NULL DEFAULT 0,
  daily_active_users BIGINT NOT NULL DEFAULT 0,
  lost_user_count BIGINT NOT NULL DEFAULT 0,
  return_user_count BIGINT NOT NULL DEFAULT 0,
  active_user_retention_rate NUMERIC(8, 4) NOT NULL DEFAULT 0,
  new_user_retention_rate NUMERIC(8, 4) NOT NULL DEFAULT 0,
  seven_day_retention_rate NUMERIC(8, 4) NOT NULL DEFAULT 0,
  replay_rate NUMERIC(8, 4) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (map_id, environment, metric_date)
);

CREATE TABLE IF NOT EXISTS api_keys (
  id BIGSERIAL PRIMARY KEY,
  map_id BIGINT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  environment VARCHAR(16) NOT NULL DEFAULT 'release' CHECK (environment IN ('release', 'lobby', 'test')),
  name VARCHAR(100) NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  token_prefix VARCHAR(16) NOT NULL,
  permissions TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  last_used_at TIMESTAMPTZ,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_api_keys_map ON api_keys(map_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(120) NOT NULL,
  resource_type VARCHAR(80) NOT NULL,
  resource_id VARCHAR(128),
  map_id BIGINT REFERENCES maps(id) ON DELETE SET NULL,
  ip VARCHAR(128),
  user_agent TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON audit_logs(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_map ON audit_logs(map_id, created_at DESC);

CREATE TABLE IF NOT EXISTS system_settings (
  setting_key VARCHAR(120) PRIMARY KEY,
  value JSONB NOT NULL,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
