export const config = {
  telegram: {
    botToken: requireEnv('TELEGRAM_BOT_TOKEN'),
  },
  miniAppUrl: process.env.MINI_APP_URL || '',
  backend: {
    url: process.env.BACKEND_URL || 'http://localhost:3001',
    adminToken: process.env.ADMIN_TOKEN || null,
  },
  notify: {
    port: parseInt(process.env.NOTIFY_PORT || '3002', 10),
    token: process.env.NOTIFY_TOKEN || null,
  },
  lobbiesChannelId: process.env.LOBBIES_CHANNEL_ID || null,
};

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`[lada-bot] missing required env: ${name}`);
    process.exit(1);
  }
  return v;
}
