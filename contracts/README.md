# Lada Contracts — Tact + Blueprint

Smart contracts for the Lada Car Racing escrow + RNG, written in [Tact](https://tact-lang.org/) and built with the [TON Blueprint](https://github.com/ton-org/blueprint) framework.

## Folder layout

```
contracts/
├── lada_escrow.tact          main contract: deposits, commit-reveal, payout
wrappers/
├── LadaEscrow.ts             TypeScript wrapper (sendCommit, sendReveal, etc.)
├── LadaEscrow.compile.ts     Blueprint compile recipe
tests/
├── LadaEscrow.spec.ts        Jest tests using @ton/sandbox
scripts/
├── deployLadaEscrow.ts       deploy script (testnet / mainnet)
```

## Contract responsibilities

1. **Deposit** — accept Lada jetton deposits from each player; track who paid.
2. **Commit** — store `hash(secret)` from each player; lock once all commits are in.
3. **Reveal** — verify each reveal matches the stored hash; once all are revealed, combine the secrets with `block_lt` / `now()` to derive the winner.
4. **Payout** — send 95% of the pot to the winner, 5% to `houseWallet`.
5. **Timeout** — if a player fails to reveal within the deadline, refund all deposits.
6. **Event** — emit `WinnerDeclared { raceId, winner, combinedSeed, payout, houseFee }` so the indexer and frontend can react.

## Setup

```bash
npm install
npm run build
npm test
npm run deploy   # interactive — pick network and signing wallet
```
