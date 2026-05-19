# Lada Backend — API + indexer

Node.js / Express service backed by PostgreSQL. Holds **no funds and no private keys** — it only:

- Tracks lobbies before they hit the chain
- Indexes contract events (race results, house-fee transfers)
- Serves leaderboard / player stats
- Verifies Telegram `initData` so each request is tied to a real Telegram user

## Folder layout

```
src/
├── index.js               app entrypoint
├── config.js              env-var loader
├── db/
│   ├── pool.js            pg Pool singleton
│   ├── migrate.js         CLI migration runner
│   └── schema.sql         tables: players, lobbies, races, house_fees
├── routes/
│   ├── lobbies.js
│   ├── leaderboard.js
│   ├── stats.js
│   └── webhook.js         contract-event webhook (called by indexer)
├── services/
│   ├── indexer.js         polls TonAPI for escrow events
│   └── telegramAuth.js    verifies Mini App initData
└── middleware/
    └── auth.js
```

## Setup

```bash
npm install
cp .env.example .env       # then fill in DATABASE_URL etc.
createdb lada
npm run migrate
npm run dev
```
