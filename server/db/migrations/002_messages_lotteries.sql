CREATE TABLE IF NOT EXISTS player_messages (
  id BIGSERIAL PRIMARY KEY,
  map_id BIGINT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  environment VARCHAR(16) NOT NULL CHECK (environment IN ('release', 'lobby', 'test')),
  player_id BIGINT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  subject VARCHAR(160) NOT NULL,
  content TEXT NOT NULL,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered')),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_player_messages_pending
  ON player_messages(map_id, environment, player_id, status, created_at);

ALTER TABLE gift_grants ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_gift_grants_delivery
  ON gift_grants(map_id, environment, player_id, delivered_at, granted_at);

CREATE TABLE IF NOT EXISTS lottery_campaigns (
  id BIGSERIAL PRIMARY KEY,
  map_id BIGINT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  environment VARCHAR(16) NOT NULL CHECK (environment IN ('release', 'lobby', 'test')),
  public_token VARCHAR(96) NOT NULL UNIQUE,
  title VARCHAR(160) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'drawn', 'cancelled')),
  draw_at TIMESTAMPTZ,
  winner_count INTEGER NOT NULL DEFAULT 1 CHECK (winner_count BETWEEN 1 AND 100),
  reward_config JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  drawn_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_lottery_campaigns_map
  ON lottery_campaigns(map_id, environment, created_at DESC);

CREATE TABLE IF NOT EXISTS lottery_entries (
  id BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT NOT NULL REFERENCES lottery_campaigns(id) ON DELETE CASCADE,
  participant_key VARCHAR(160) NOT NULL,
  player_name VARCHAR(160) NOT NULL,
  player_uid VARCHAR(128),
  contact VARCHAR(160),
  is_winner BOOLEAN NOT NULL DEFAULT FALSE,
  ip VARCHAR(128),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (campaign_id, participant_key)
);
CREATE INDEX IF NOT EXISTS idx_lottery_entries_campaign
  ON lottery_entries(campaign_id, created_at);
