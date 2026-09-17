ALTER TABLE maps ADD COLUMN analytics_features TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE maps ADD COLUMN analytics_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE maps ADD CONSTRAINT maps_analytics_features_check
  CHECK (analytics_features <@ ARRAY['progression','choices','challenges','stages']::text[]);

CREATE TABLE analytics_events (
  map_id BIGINT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  event_id VARCHAR(128) NOT NULL,
  payload_hash TEXT NOT NULL,
  PRIMARY KEY (map_id,event_id)
);
CREATE TABLE analytics_attempts (
  map_id BIGINT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  feature TEXT NOT NULL CHECK (feature IN ('progression','challenges','stages')),
  run_id VARCHAR(128) NOT NULL,
  object_key VARCHAR(128) NOT NULL,
  object_name VARCHAR(160) NOT NULL,
  version VARCHAR(64) NOT NULL,
  difficulty VARCHAR(64) NOT NULL,
  uids TEXT[] NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  outcome TEXT CHECK (outcome IN ('success','failure','exit')),
  duration_seconds DOUBLE PRECISION CHECK (duration_seconds >= 0),
  reason VARCHAR(160),
  remaining_percent DOUBLE PRECISION CHECK (remaining_percent BETWEEN 0 AND 100),
  PRIMARY KEY (map_id,feature,run_id)
);
CREATE INDEX analytics_attempts_day ON analytics_attempts(map_id,feature,started_at);
CREATE INDEX analytics_attempts_uids ON analytics_attempts USING GIN(uids);
CREATE TABLE analytics_choices (
  map_id BIGINT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  choice_id VARCHAR(128) NOT NULL,
  player_uid VARCHAR(128) NOT NULL,
  object_key VARCHAR(128) NOT NULL,
  object_name VARCHAR(160) NOT NULL,
  version VARCHAR(64) NOT NULL,
  difficulty VARCHAR(64) NOT NULL,
  position INTEGER NOT NULL CHECK(position BETWEEN 1 AND 1000),
  candidates JSONB NOT NULL,
  selected_key VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (map_id,choice_id)
);
CREATE INDEX analytics_choices_day ON analytics_choices(map_id,created_at);
CREATE INDEX analytics_choices_uid ON analytics_choices(map_id,player_uid);
