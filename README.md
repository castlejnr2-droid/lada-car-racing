# Lada Car Racing

A Telegram Mini App racing game on the TON blockchain. Two or more players deposit **Lada jettons** into an escrow smart contract, race down a pothole-ridden Russian highway, and the winner — chosen by on-chain commit-reveal RNG — walks away with 95% of the pot.

## Concept

- **Deposit** — players send Lada tokens to the escrow contract to enter a lobby.
- **Commit** — each player submits `hash(secret)` to the contract.
- **Reveal** — each player reveals their secret; the contract verifies the hash, mixes both secrets with block data, and derives the winner.
- **Payout** — 95% of the pot → winner, 5% → house wallet. Auto-settled on-chain.
- **Replay** — the frontend animates the race using the same seeded RNG, so the outcome (already determined on-chain) plays out as an exciting visual.
- **Timeout** — if either player fails to reveal in time, both are refunded.

## Theme

Soviet-era rural highway. Classic Lada car dodging potholes, splashing through mud, gliding past birch trees, brutalist apartment blocks, babushkas at bus stops, and weathered road signs.

## Repository layout

```
.
├── frontend/    React Telegram Mini App (TON Connect wallet integration)
├── backend/     Node.js + PostgreSQL API (lobbies, leaderboard, stats, house fees)
├── contracts/   Tact smart contracts on TON (escrow + commit-reveal RNG), built with Blueprint
└── bot/         Telegram bot (lobby alerts, race notifications)
```

Each package has its own `README.md` with setup instructions.

## Architecture

```
   ┌─────────────┐         ┌─────────────┐         ┌─────────────┐
   │  Telegram   │◀───────▶│   Frontend  │◀───────▶│   Backend   │
   │     Bot     │         │ (Mini App)  │         │  (API + DB) │
   └─────────────┘         └──────┬──────┘         └──────┬──────┘
                                  │                       │
                                  ▼                       ▼
                          ┌───────────────────────────────────┐
                          │     TON blockchain (Tact)         │
                          │   Lada escrow + commit-reveal RNG │
                          └───────────────────────────────────┘
```

Rules of separation:

- **Game logic** (race animation, RNG playback) lives in `frontend/src/game/` and never imports blockchain modules.
- **Blockchain interaction** lives in `frontend/src/blockchain/` and is the only place TON Connect / contract wrappers are used.
- The **backend** never holds private keys — it only indexes events and serves lobby/leaderboard data.

## Quick start

```bash
# install everything
cd frontend && npm install && cd ..
cd backend  && npm install && cd ..
cd contracts && npm install && cd ..
cd bot      && npm install && cd ..

# run dev services in separate terminals
cd frontend && npm run dev
cd backend  && npm run dev
cd bot      && npm run dev

# build & test the contract
cd contracts && npm run build && npm test
```

Copy each package's `.env.example` to `.env` and fill in the values before running.

## License

MIT
