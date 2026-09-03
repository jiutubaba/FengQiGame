ALTER TABLE maps
  ADD COLUMN IF NOT EXISTS platform VARCHAR(32) NOT NULL DEFAULT 'kk'
    CHECK (platform IN ('kk','oasis_qiyuan'));

ALTER TABLE maps ADD COLUMN IF NOT EXISTS feedback_token VARCHAR(96);

UPDATE maps
   SET feedback_token='fb_' || replace(gen_random_uuid()::text,'-','')
 WHERE feedback_token IS NULL;

ALTER TABLE maps ALTER COLUMN feedback_token SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_maps_feedback_token
  ON maps(feedback_token);

CREATE TABLE IF NOT EXISTS feedback_responses (
  id BIGSERIAL PRIMARY KEY,
  map_id BIGINT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  onboarding_score SMALLINT NOT NULL CHECK(onboarding_score BETWEEN 1 AND 5),
  visuals_score SMALLINT NOT NULL CHECK(visuals_score BETWEEN 1 AND 5),
  gameplay_score SMALLINT NOT NULL CHECK(gameplay_score BETWEEN 1 AND 5),
  rewards_score SMALLINT NOT NULL CHECK(rewards_score BETWEEN 1 AND 5),
  progression_score SMALLINT NOT NULL CHECK(progression_score BETWEEN 1 AND 5),
  qq VARCHAR(64),
  wechat VARCHAR(128),
  optimization_suggestion TEXT NOT NULL DEFAULT '',
  future_content TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    NULLIF(BTRIM(COALESCE(qq,'')),'') IS NOT NULL
    OR NULLIF(BTRIM(COALESCE(wechat,'')),'') IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_feedback_responses_map_created
  ON feedback_responses(map_id,created_at DESC,id DESC);

INSERT INTO maps(name,description,owner_user_id,platform,feedback_token)
VALUES(
  '地球前线',
  '',
  (SELECT id FROM users WHERE role='admin' AND status='active' ORDER BY id LIMIT 1),
  'oasis_qiyuan',
  'fb_' || replace(gen_random_uuid()::text,'-','')
)
ON CONFLICT(name) DO UPDATE SET platform=EXCLUDED.platform;

INSERT INTO map_configs(map_id)
SELECT id FROM maps WHERE name='地球前线'
ON CONFLICT(map_id) DO NOTHING;
