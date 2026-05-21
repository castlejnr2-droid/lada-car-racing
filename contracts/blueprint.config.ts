import { Config, CustomNetwork } from '@ton/blueprint';

/**
 * Network is picked dynamically so the same config supports both networks:
 *
 *   npx blueprint run deployLadaEscrow              → testnet (tonhub v4)
 *   npx blueprint run deployLadaEscrow --mainnet    → mainnet (toncenter v2)
 *   npx blueprint run deployLadaEscrow --custom <url> --custom-version=v2 \
 *     --custom-type=testnet                          → user-supplied endpoint
 *
 * Why argv-aware: Blueprint's Config.network is a static value, so it can't
 * react to CLI flags on its own. Reading process.argv here lets a single
 * config produce the right endpoint per-invocation.
 *
 * Endpoints picked:
 *   mainnet : https://toncenter.com/api/v2/jsonRPC          (v2 jsonRPC)
 *   testnet : https://testnet-v4.tonhubapi.com              (v4 HTTP API)
 *
 * For mainnet, set TONCENTER_API_KEY to raise the rate limit (toncenter
 * heavily throttles unauthenticated traffic).
 */
function pickNetwork(): CustomNetwork {
  const argv = process.argv;

  if (argv.includes('--mainnet')) {
    return {
      endpoint: 'https://toncenter.com/api/v2/jsonRPC',
      version: 'v2',
      type: 'mainnet',
      key: process.env.TONCENTER_API_KEY,
    };
  }
  // Default: testnet via tonhub v4 (more reliable than toncenter testnet)
  return {
    endpoint: 'https://testnet-v4.tonhubapi.com',
    version: 'v4',
    type: 'testnet',
  };
}

export const config: Config = {
  network: pickNetwork(),
};
