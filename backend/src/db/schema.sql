-- Lada Car Racing — database schema

CREATE TABLE IF NOT EXISTS players (
  address       TEXT PRIMARY KEY,             -- TON wallet address
  telegram_id   BIGINT UNIQUE,
  username      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lobbies (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stake         NUMERIC(30, 0) NOT NULL,      -- in nano-LADA
  max_players   INT NOT NULL DEFAULT 2,
  status        TEXT NOT NULL DEFAULT 'open', -- open | locked | finished | cancelled
  creator       TEXT NOT NULL REFERENCES players(address),
  on_chain_id   BIGINT,                       -- id assigned by the escrow contract
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lobby_players (
  lobby_id      UUID NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
  address       TEXT NOT NULL REFERENCES players(address),
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (lobby_id, address)
);

CREATE TABLE IF NOT EXISTS races (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lobby_id        UUID NOT NULL REFERENCES lobbies(id),
  winner          TEXT REFERENCES players(address),
  combined_seed   TEXT,                       -- hex string emitted by the contract
  pot             NUMERIC(30, 0) NOT NULL,
  winner_payout   NUMERIC(30, 0),
  house_fee       NUMERIC(30, 0),
  tx_hash         TEXT,
  status          TEXT NOT NULL DEFAULT 'pending', -- pending | committed | revealed | settled | refunded
  finished_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS house_fees (
  id          BIGSERIAL PRIMARY KEY,
  race_id     UUID REFERENCES races(id),
  amount      NUMERIC(30, 0) NOT NULL,
  tx_hash     TEXT,
  collected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lobbies_status ON lobbies(status);
CREATE INDEX IF NOT EXISTS idx_races_winner ON races(winner);
