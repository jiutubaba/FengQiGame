ALTER TABLE maps DROP CONSTRAINT maps_analytics_features_check;
UPDATE maps SET analytics_features=array_remove(array_remove(analytics_features,'progression'),'challenges'),
  analytics_revision=analytics_revision+1
  WHERE analytics_features && ARRAY['progression','challenges']::text[];
ALTER TABLE maps ADD CONSTRAINT maps_analytics_features_check
  CHECK (analytics_features <@ ARRAY['difficulty','choices','stages']::text[]);

CREATE TABLE analytics_difficulty_runs (
  map_id BIGINT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  play_id VARCHAR(128) NOT NULL,
  player_uid VARCHAR(128) NOT NULL,
  difficulty INTEGER NOT NULL CHECK(difficulty BETWEEN 1 AND 1000),
  version VARCHAR(64) NOT NULL,
  selected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cleared_at TIMESTAMPTZ,
  PRIMARY KEY (map_id,play_id,player_uid)
);
CREATE INDEX analytics_difficulty_day ON analytics_difficulty_runs(map_id,selected_at);
CREATE INDEX analytics_difficulty_uid ON analytics_difficulty_runs(map_id,player_uid);
