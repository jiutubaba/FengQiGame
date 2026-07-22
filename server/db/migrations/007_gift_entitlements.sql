CREATE TABLE IF NOT EXISTS gift_entitlements (
  id BIGSERIAL PRIMARY KEY,
  map_id BIGINT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  environment VARCHAR(16) NOT NULL CHECK (environment IN ('release', 'lobby', 'test')),
  gift_id BIGINT NOT NULL REFERENCES gifts(id) ON DELETE CASCADE,
  player_id BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  value NUMERIC(18, 4) NOT NULL CHECK (value > 0),
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (map_id, environment, player_id, gift_id)
);

INSERT INTO gift_entitlements(map_id,environment,gift_id,player_id,value,updated_by,created_at,updated_at)
SELECT map_id,
       environment,
       gift_id,
       player_id,
       SUM(CASE WHEN boolean_value THEN 1 ELSE quantity END),
       (ARRAY_AGG(granted_by ORDER BY granted_at DESC))[1],
       MIN(granted_at),
       MAX(granted_at)
  FROM gift_grants
 GROUP BY map_id,environment,gift_id,player_id
HAVING SUM(CASE WHEN boolean_value THEN 1 ELSE quantity END) > 0
ON CONFLICT(map_id,environment,player_id,gift_id) DO UPDATE
SET value=EXCLUDED.value,
    updated_by=EXCLUDED.updated_by,
    updated_at=EXCLUDED.updated_at;

CREATE INDEX IF NOT EXISTS idx_gift_entitlements_map_player
  ON gift_entitlements(map_id, environment, player_id);

ALTER TABLE gifts ALTER COLUMN default_value SET DEFAULT 0;
DROP TABLE gift_grants;
