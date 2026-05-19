export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  databaseUrl: process.env.DATABASE_URL,
  ton: {
    network: process.env.TON_NETWORK || 'testnet',
    apiKey: process.env.TON_API_KEY,
    escrowAddress: process.env.ESCROW_CONTRACT_ADDRESS,
    houseWallet: process.env.HOUSE_WALLET_ADDRESS,
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
  },
};
