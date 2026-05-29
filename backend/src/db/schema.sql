-- =====================================================================
--  Lada Car Racing — backend schema
-- =====================================================================
--  Idempotent: safe to re-run. Uses `IF NOT EXISTS` and DO blocks so
--  the migration script can be invoked repeatedly without dropping data.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- ─────────────────────────────────────────────────────────────────────
--  players
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS players (
  address       TEXT PRIMARY KEY,                       -- TON wallet (raw 0:hex or user-friendly)
  telegram_id   BIGINT UNIQUE,
  username      TEXT,
  avatar_url    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_players_telegram_id ON players(telegram_id);

-- ─────────────────────────────────────────────────────────────────────
--  lobbies — pre-chain matchmaking state
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lobbies (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stake            NUMERIC(30, 0) NOT NULL,             -- nano-LADA
  max_players      INT NOT NULL DEFAULT 5,
  min_players      INT NOT NULL DEFAULT 2,
  status           TEXT NOT NULL DEFAULT 'open',
  --                open      waiting for players
  --                matched   full, race created on-chain
  --                cancelled creator backed out before match
  creator          TEXT NOT NULL REFERENCES players(address),
  on_chain_race_id BIGINT,                              -- raceId in the escrow contract
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at        TIMESTAMPTZ,
  CONSTRAINT lobbies_status_chk CHECK (status IN ('open','matched','cancelled','pending'))
);

CREATE INDEX IF NOT EXISTS idx_lobbies_status     ON lobbies(status);
CREATE INDEX IF NOT EXISTS idx_lobbies_created_at ON lobbies(created_at DESC);

CREATE TABLE IF NOT EXISTS lobby_players (
  lobby_id   UUID NOT NULL REFERENCES lobbies(id) ON DELETE CASCADE,
  address    TEXT NOT NULL REFERENCES players(address),
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (lobby_id, address)
);

-- ─────────────────────────────────────────────────────────────────────
--  races — on-chain race lifecycle
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS races (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lobby_id         UUID NOT NULL REFERENCES lobbies(id),
  on_chain_id      BIGINT UNIQUE,                       -- raceId emitted by contract
  player1          TEXT NOT NULL REFERENCES players(address),
  player2          TEXT NOT NULL REFERENCES players(address),
  stake            NUMERIC(30, 0) NOT NULL,
  pot              NUMERIC(30, 0) NOT NULL,
  state            TEXT NOT NULL DEFAULT 'awaiting_deposits',
  --                awaiting_deposits | settled | refunded
  player1_deposited BOOLEAN NOT NULL DEFAULT false,
  player2_deposited BOOLEAN NOT NULL DEFAULT false,
  player1_committed BOOLEAN NOT NULL DEFAULT false,
  player2_committed BOOLEAN NOT NULL DEFAULT false,
  player1_revealed  BOOLEAN NOT NULL DEFAULT false,
  player2_revealed  BOOLEAN NOT NULL DEFAULT false,
  winner           TEXT REFERENCES players(address),
  loser            TEXT REFERENCES players(address),
  combined_seed    TEXT,                                -- hex string of uint256
  winner_payout    NUMERIC(30, 0),
  house_fee        NUMERIC(30, 0),
  settle_tx_hash   TEXT,
  commit_deadline  TIMESTAMPTZ,
  reveal_deadline  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at      TIMESTAMPTZ
  -- NOTE: races_state_chk constraint is applied below (after the legacy
  -- row cleanup UPDATE), not inline here.
);

CREATE INDEX IF NOT EXISTS idx_races_state        ON races(state);
CREATE INDEX IF NOT EXISTS idx_races_winner       ON races(winner);
CREATE INDEX IF NOT EXISTS idx_races_player1      ON races(player1);
CREATE INDEX IF NOT EXISTS idx_races_player2      ON races(player2);
CREATE INDEX IF NOT EXISTS idx_races_on_chain_id  ON races(on_chain_id);
CREATE INDEX IF NOT EXISTS idx_races_created_at   ON races(created_at DESC);

-- ─────────────────────────────────────────────────────────────────────
--  transactions — every on-chain event we index, one row per tx
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
  id           BIGSERIAL PRIMARY KEY,
  tx_hash      TEXT NOT NULL,
  lt           BIGINT,                                  -- logical time
  type         TEXT NOT NULL,
  --             deposit | commit | reveal | payout | refund | house_fee
  race_id      UUID REFERENCES races(id),
  player       TEXT REFERENCES players(address),
  amount       NUMERIC(30, 0),
  raw          JSONB,                                   -- full parsed event for debugging
  observed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tx_hash, type)                                -- one tx can be reported once per type
);

CREATE INDEX IF NOT EXISTS idx_tx_race    ON transactions(race_id);
CREATE INDEX IF NOT EXISTS idx_tx_player  ON transactions(player);
CREATE INDEX IF NOT EXISTS idx_tx_type    ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_tx_lt      ON transactions(lt DESC);

-- ─────────────────────────────────────────────────────────────────────
--  house_fees — per-race 5% fee, plus withdrawal bookkeeping
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS house_fees (
  id                  BIGSERIAL PRIMARY KEY,
  race_id             UUID NOT NULL UNIQUE REFERENCES races(id),
  amount              NUMERIC(30, 0) NOT NULL,
  tx_hash             TEXT,                             -- contract → house wallet tx
  collected_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Withdrawal tracking: the contract auto-pays the house wallet on every
  -- settlement, so "withdrawal" here means moving funds OUT of the house
  -- wallet to ops/treasury. Admin records the withdrawal via /api/house.
  withdrawn           BOOLEAN NOT NULL DEFAULT false,
  withdrawn_at        TIMESTAMPTZ,
  withdrawal_tx_hash  TEXT,
  withdrawal_note     TEXT
);

CREATE INDEX IF NOT EXISTS idx_house_fees_withdrawn  ON house_fees(withdrawn);
CREATE INDEX IF NOT EXISTS idx_house_fees_collected  ON house_fees(collected_at DESC);

-- PATCHED-MIN-PLAYERS
ALTER TABLE lobby_players ADD COLUMN IF NOT EXISTS username TEXT;

-- v2-fix2: add 'pending' lobby status (lobbies hidden until host deposit confirmed)
ALTER TABLE lobbies DROP CONSTRAINT IF EXISTS lobbies_status_chk;
ALTER TABLE lobbies ADD CONSTRAINT lobbies_status_chk CHECK (status IN (
  'open','matched','cancelled','pending'
));

-- ─────────────────────────────────────────────────────────────────────
--  Idempotent migrations for older databases
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE lobbies ADD COLUMN IF NOT EXISTS min_players INT NOT NULL DEFAULT 2;
ALTER TABLE lobbies ALTER COLUMN max_players SET DEFAULT 5;

-- v2: owner-payout model — only three states now.
-- Clean up legacy commit-reveal states; keep 'active' (both deposited, payout in-flight).
UPDATE races
   SET state = 'refunded'
 WHERE state NOT IN ('awaiting_deposits', 'active', 'settled', 'refunded');

ALTER TABLE races DROP CONSTRAINT IF EXISTS races_state_chk;
ALTER TABLE races ADD CONSTRAINT races_state_chk CHECK (state IN (
  'awaiting_deposits','active','settled','refunded'
));

-- ─────────────────────────────────────────────────────────────────────
--  Touch trigger for players.updated_at
-- ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS players_touch_updated_at ON players;
CREATE TRIGGER players_touch_updated_at
  BEFORE UPDATE ON players
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
