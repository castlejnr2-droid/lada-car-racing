# Lada Bot — Telegram notifications

Telegraf-based bot that:

- Welcomes users with a `/start` command and a button into the Mini App
- Notifies players when an opponent joins their lobby
- Pings both players when the commit/reveal window opens
- Announces the winner once the contract settles

## Folder layout

```
src/
├── index.js                bot bootstrap
├── handlers/
│   ├── start.js
│   ├── help.js
│   └── notifications.js    HTTP endpoint the backend calls to push messages
└── lib/
    └── messages.js         message templates
```

## Setup

```bash
npm install
cp .env.example .env
# fill in TELEGRAM_BOT_TOKEN and MINI_APP_URL
npm run dev
```
