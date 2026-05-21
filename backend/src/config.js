export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3001', 10),
  databaseUrl: process.env.DATABASE_URL,
  ton: {
    network: process.env.TON_NETWORK || 'testnet',
    apiKey: process.env.TON_API_KEY,
    escrowAddress: process.env.ESCROW_CONTRACT_ADDRESS,
    houseWallet: process.env.HOUSE_WALLET_ADDRESS,
    ladaJettonMaster: process.env.LADA_JETTON_MASTER,
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    skipAuth: process.env.SKIP_TELEGRAM_AUTH === '1',
    notifyUrl: process.env.BOT_NOTIFY_URL,
  },
  indexer: {
    pollMs: parseInt(process.env.INDEXER_POLL_MS || '5000', 10),
  },
  admin: {
    token: process.env.ADMIN_TOKEN,
  },
};

export function tonApiBase() {
  return config.ton.network === 'mainnet'
    ? 'https://tonapi.io'
    : 'https://testnet.tonapi.io';
}
