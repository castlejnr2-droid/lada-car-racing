# Lada Frontend — Telegram Mini App

React + Vite Mini App with TON Connect wallet integration.

## Folder layout

```
src/
├── main.jsx                  app entry, TON Connect provider
├── App.jsx                   router shell
├── components/               UI pieces (Lobby, Race, Wallet, Leaderboard)
├── game/                     pure race logic — NEVER imports from /blockchain
│   ├── rng.js                seeded RNG used to replay the race
│   ├── physics.js            speed, potholes, finish line
│   └── replay.js             drives the animation from the on-chain seed
├── blockchain/               only place TON Connect / contract wrappers live
│   ├── tonConnect.js
│   ├── escrowContract.js     wraps the Tact contract calls
│   └── jetton.js             Lada jetton helpers
├── api/                      backend HTTP client (lobbies, leaderboard)
└── styles/                   CSS / theme tokens (Soviet palette)
```

The rule: `game/` and `blockchain/` never import from each other. The race animation is driven by RNG seeds derived from on-chain entropy — the seeds flow `blockchain → App → game`.

## Setup

```bash
npm install
cp .env.example .env
# fill in VITE_* values
npm run dev
```

Open the dev URL inside Telegram's Mini App debugger (or via a `t.me` bot link in production).
