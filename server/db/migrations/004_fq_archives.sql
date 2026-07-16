CREATE TABLE IF NOT EXISTS fq_player_archives (
  map_id BIGINT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  environment VARCHAR(16) NOT NULL CHECK (environment IN ('release', 'lobby', 'test')),
  player_uid VARCHAR(128) NOT NULL,
  archive_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
  last_request_id VARCHAR(128),
  last_request_hash CHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (map_id, environment, player_uid),
  CHECK (
    (last_request_id IS NULL AND last_request_hash IS NULL)
    OR
    (last_request_id IS NOT NULL AND last_request_hash IS NOT NULL)
  ),
  CHECK (jsonb_typeof(archive_data) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_fq_player_archives_updated
  ON fq_player_archives(map_id, environment, updated_at DESC);

CREATE TABLE IF NOT EXISTS fq_global_archives (
  map_id BIGINT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  environment VARCHAR(16) NOT NULL CHECK (environment IN ('release', 'lobby', 'test')),
  archive_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
  last_request_id VARCHAR(128),
  last_request_hash CHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (map_id, environment),
  CHECK (
    (last_request_id IS NULL AND last_request_hash IS NULL)
    OR
    (last_request_id IS NOT NULL AND last_request_hash IS NOT NULL)
  ),
  CHECK (jsonb_typeof(archive_data) = 'object')
);
