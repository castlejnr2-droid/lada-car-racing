# Lada Backend — API + indexer

Node.js / Express service backed by PostgreSQL. Holds **no funds and no private keys** — it only tracks lobbies, indexes contract events, exposes stats, and bookkeeps house-fee withdrawals.

## Folder layout

```
src/
├── index.js                app entrypoint
├── config.js               env loader
├── db/
│   ├── pool.js             pg Pool singleton
│   ├── migrate.js          runs schema.sql
│   └── schema.sql          players, lobbies, races, transactions, house_fees
├── routes/
│   ├── index.js            mounts everything under /api
│   ├── lobbies.js          /api/lobbies
│   ├── races.js            /api/races
│   ├── players.js          /api/players
│   ├── leaderboard.js      /api/leaderboard
│   ├── house.js            /api/house
│   └── webhook.js          /api/webhook
├── services/
│   ├── indexer.js          polls TonAPI, dispatches typed events
│   ├── events.js           event handlers (idempotent)
│   ├── tonApi.js           thin TonAPI client (jetton balance, txs)
│   └── telegramAuth.js     verifies Mini App initData
└── middleware/
    ├── auth.js             requireTelegram (X-Telegram-Init-Data)
    └── adminAuth.js        requireAdmin   (X-Admin-Token)
```

## Tables

```
players       wallet ↔ Telegram identity
lobbies       pre-chain matchmaking (open | matched | cancelled)
lobby_players many-to-many join table
races         on-chain race lifecycle + result
transactions  every indexed on-chain event (one row per tx + type)
house_fees    per-race 5% fee + withdrawal bookkeeping
```

## REST API

```
POST   /api/players                       upsert player on first connect
GET    /api/players/:address              profile + lifetime stats
GET    /api/players/:address/balance      live Lada jetton balance via TonAPI
GET    /api/players/:address/races        race history

GET    /api/lobbies                       list open lobbies
POST   /api/lobbies                       create a lobby
POST   /api/lobbies/:id/join              join a lobby (auto-matches when full)
DELETE /api/lobbies/:id                   creator cancels an open lobby

GET    /api/races                         list races (filter: state, player)
GET    /api/races/:id                     race status + recent events
GET    /api/races/by-chain/:onChainId     look up by on-chain raceId
GET    /api/races/:id/history             full event log

GET    /api/leaderboard?period=all|day|week|month   top by winnings

GET    /api/house/summary                 collected / withdrawn / available
GET    /api/house/fees                    paginated fee list (?withdrawn=true|false)
POST   /api/house/withdraw     [admin]    mark fees as withdrawn after manual ops

POST   /api/webhook/event      [indexer]  single event
POST   /api/webhook/events     [indexer]  batch
```

## Event flow

```
escrow contract ──► TonAPI ──► services/indexer.js ──► services/events.js ──► Postgres
                                       │
                                       └─► (or external indexer ──► POST /api/webhook/event)
```

Both paths run the same handler set in `services/events.js`, and every write is idempotent on `(tx_hash, type)`, so duplicate deliveries are safe.

## House-fee flow

1. The escrow contract pays 5% directly to `houseWallet` on every settle. The backend records each fee in `house_fees`.
2. When the operator moves accumulated jettons out of the house wallet (manually, via their own wallet UI), they call `POST /api/house/withdraw` with the tx hash and either a list of fee IDs or a cutoff timestamp. The matching rows are marked `withdrawn = true`.
3. `GET /api/house/summary` reports `collected`, `withdrawn`, and `available`, plus the live on-chain balance of the house wallet as a sanity check.

## Setup

```bash
npm install
cp .env.example .env       # then fill in DATABASE_URL etc.
createdb lada
npm run migrate
npm run dev
```

## Configuration

All settings come from environment variables — see `.env.example`. Notable:

- `ESCROW_CONTRACT_ADDRESS` — the deployed LadaEscrow address; the indexer is disabled until this is set.
- `LADA_JETTON_MASTER` — required for `/api/players/:address/balance` and the house summary's live balance.
- `ADMIN_TOKEN` — random hex string; required for `POST /api/house/withdraw`.
- `SKIP_TELEGRAM_AUTH=1` — dev escape hatch to bypass initData verification.
