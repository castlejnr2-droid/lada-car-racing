import { Config } from '@ton/blueprint';

/**
 * Blueprint config. Defaults `blueprint run`/`build` to TON testnet using
 * the toncenter v2 JSON-RPC endpoint specified by the project.
 *
 * To deploy to mainnet, pass `--mainnet` to the CLI, e.g.
 *   npx blueprint run deployLadaEscrow --mainnet
 */
export const config: Config = {
  network: {
    endpoint: 'https://testnet.toncenter.com/api/v2/jsonRPC',
    type: 'testnet',
    version: 'v2',
    // Optional: bump rate limits by setting TONCENTER_KEY in your env.
    key: process.env.TONCENTER_KEY,
  },
};
