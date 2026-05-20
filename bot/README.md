# Lada Bot — Telegram

Telegraf-based bot. Handles the Mini App entry point, exposes player stats and the leaderboard as chat commands, and DMs players when their lobbies fill or their races settle.

## Folder layout

```
src/
├── index.js                bot bootstrap
├── config.js               env-var loader (fails fast on missing required vars)
├── handlers/
│   ├── start.js            /start — welcome + Open-Mini-App button
│   ├── play.js             /play  — Open-Mini-App button
│   ├── stats.js            /stats — your wins, losses, winnings
│   ├── leaderboard.js      /leaderboard [day|week|month|all]
│   ├── help.js             /help, /commands
│   └── notifications.js    HTTP server for backend → bot pushes
└── lib/
    ├── api.js              backend API client (fetch wrapper)
    ├── format.js           nano-LADA → display, address shorten, escape
    └── messages.js         HTML message templates (Russian-roads tone)
```

## Commands

| Command       | What it does                                            |
|---------------|---------------------------------------------------------|
| `/start`      | Welcome message + Mini App button.                      |
| `/play`       | Mini App button (shortcut to open the game).            |
| `/stats`      | Your wallet, wins, losses, win rate, total LADA won.    |
| `/leaderboard`| Top 10 racers. Optional period: `day`, `week`, `month`, `all`. |
| `/help`       | Lists the commands above.                               |

`/stats` requires the user to have connected a TON wallet inside the Mini App at least once — that's how the bot learns their wallet address. Until then, `/stats` nudges them into `/play`.

## Notification webhook

The bot exposes a small HTTP server (`NOTIFY_PORT`, default `3002`). The backend POSTs to it whenever something happens that warrants a Telegram message.

| Endpoint                     | When the backend calls it                                       | Body                                                                                       |
|------------------------------|-----------------------------------------------------------------|--------------------------------------------------------------------------------------------|
| `POST /notify/lobby-created` | New open lobby (only sent if `LOBBIES_CHANNEL_ID` is set)       | `{ creatorName, stake, players, maxPlayers, lobbyId }`                                     |
| `POST /notify/lobby-joined`  | Second player joins a lobby                                     | `{ creatorTelegramId, opponentName, stake, lobbyId }`                                      |
| `POST /notify/race-starting` | Both deposits in; commit phase open                             | `{ telegramIds: [...], raceId }`                                                           |
| `POST /notify/race-settled`  | `WinnerDeclared` event indexed                                  | `{ winnerTelegramId, loserTelegramId, winnerName, loserName, payout, stake, raceId }`      |
| `POST /notify/race-refunded` | `RaceRefunded` event indexed                                    | `{ telegramIds: [...], refundAmount, raceId }`                                             |

If `NOTIFY_TOKEN` is set, every request must include `X-Notify-Token: <that-value>`. The backend should be configured with the same value.

The backend's `events.js` is where these pushes should be wired up — after each handler updates Postgres, it should `fetch(BOT_NOTIFY_URL + '/notify/...')` with the relevant data. The bot is intentionally stateless: it doesn't poll the backend or the chain, it just reacts to pushes.

## Setup

```bash
npm install
cp .env.example .env
# fill in TELEGRAM_BOT_TOKEN and MINI_APP_URL
npm run dev
```

After the bot starts it will register the slash-command list with Telegram, so the user gets autocomplete inside any chat with the bot.

## Required env

- `TELEGRAM_BOT_TOKEN` — from @BotFather.
- `MINI_APP_URL` — the public HTTPS URL of the Mini App. In dev, use ngrok or cloudflared.
- `BACKEND_URL` — defaults to `http://localhost:3001`.

Optional:

- `NOTIFY_TOKEN` — shared secret for the backend → bot push channel.
- `LOBBIES_CHANNEL_ID` — channel where new lobbies are announced (`@channelname` or `-100…`). Disabled if unset.
- `ADMIN_TOKEN` — required only if the bot is going to call admin-gated backend endpoints (it doesn't today).
