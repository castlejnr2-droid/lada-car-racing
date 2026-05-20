# Lada Contracts — Tact + Blueprint

Escrow + commit-reveal RNG for Lada Car Racing, written in [Tact](https://tact-lang.org/) and built with the [TON Blueprint](https://github.com/ton-org/blueprint) framework.

## Folder layout

```
contracts/
└── lada_escrow.tact          main contract
wrappers/
├── LadaEscrow.ts             TypeScript facade + helper functions
└── LadaEscrow.compile.ts     Blueprint compile recipe
tests/
└── LadaEscrow.spec.ts        Jest tests via @ton/sandbox
scripts/
└── deployLadaEscrow.ts       deploy script (testnet / mainnet)
```

## Race lifecycle

```
AWAITING_DEPOSITS ──► AWAITING_COMMITS ──► AWAITING_REVEALS ──► SETTLED
        │                    │                     │
        └──── timeout ───────┴──── timeout ────────┴──► REFUNDED
```

1. **CreateRace** — owner registers a race with two player addresses + stake.
2. **Deposit** — each player sends Lada jettons to the contract; the standard TEP-74 `TokenNotification` carries the race ID in the forward payload. Deposits with the wrong race, wrong amount, or from a non-player are auto-refunded.
3. **CommitHash** — each player submits `sha256(secret)` before the 30-min commit deadline.
4. **RevealSecret** — each player reveals their secret before the 10-min reveal deadline. The contract verifies `sha256(secret) == commit`. On the second valid reveal the contract:
   - derives `combinedSeed = sha256(secret1 || secret2 || now())`
   - picks the winner as `combinedSeed % 2`
   - sends 95% of the pot to the winner and 5% to `houseWallet` via jetton transfers
   - emits a `WinnerDeclared` event
   - deletes the race from storage
5. **TimeoutRefund** — if either deadline passes without progress, *anyone* can call this; both deposits are refunded and `RaceRefunded` is emitted.

## Why the RNG is secure

- `sha256` is one-way, so player B cannot learn player A's secret from the commit alone.
- Once both commits land, neither secret can change.
- Therefore the winner is fully determined the moment the second commit hits the chain. Reveal just exposes it.
- `now()` is mixed into the seed only for extra entropy in the **visual** replay — it does not change who wins.

## Events the frontend / indexer listens for

| Event             | Op-code      | Body                                                                                  |
| ----------------- | ------------ | ------------------------------------------------------------------------------------- |
| `WinnerDeclared`  | `0x6c7263f1` | `raceId, winner, loser, combinedSeed, pot, payout, houseFee`                          |
| `RaceRefunded`    | `0x6c7263f2` | `raceId, player1, player2, refundAmount`                                              |

Frontend RNG seed comes from `combinedSeed` (uint256). Pass it to `frontend/src/game/replay.js` to drive the animation.

## Setup

```bash
npm install
npm run build              # compile lada_escrow.tact → build/LadaEscrow/...
npm test
npm run deploy             # interactive Blueprint deploy (testnet by default)
```

### If `npm run deploy` errors with "Cannot read properties of undefined (reading 'slice')"

That's a Blueprint 0.27 / Node-version interaction: Blueprint's `findScripts` does
`dirent.path.slice(...)` and `Dirent.path` is `undefined` on Node 18.17–20.0 when
combined with `recursive: true` + `withFileTypes: true`. Two ways out:

1. **Upgrade Node** to 20.1+ (ideally 22.x) and re-run `npm run deploy`.
2. **Bypass Blueprint's CLI** with the standalone deploy script (no `findScripts`
   in its path):

   ```bash
   npm run build                           # still need the compiled wrapper
   WALLET_MNEMONIC="24-word seed phrase" \
   HOUSE_WALLET=0Q…           \
   LADA_JETTON_WALLET=0Q…     \             # optional on first deploy
   npm run deploy:standalone
   ```

   The standalone deploy lives in `tools/deploy.ts` (outside `scripts/` so
   Blueprint's auto-discovery never touches it). It uses `TonClient` + your
   24-word mnemonic to broadcast directly to the toncenter testnet RPC.

After `npm run build`, the generated wrapper at `build/LadaEscrow/tact_LadaEscrow.ts` exposes typed message constructors and `LadaEscrow.fromInit(owner, houseWallet, ladaJettonWallet)`. Tests and the deploy script should swap to it once it exists.

## Deploying

Set environment variables before `npm run deploy`:

- `HOUSE_WALLET` — TON address that collects the 5% fee.
- `LADA_JETTON_WALLET` — the contract's own jetton wallet for the Lada jetton. This needs to be precomputed against the deploy address by calling the Lada jetton master's `get_wallet_address` get-method. For a first-pass deploy, you can use any placeholder and re-deploy once the real address is known (this contract's init data includes the jetton wallet address, so changing it changes the contract address).
