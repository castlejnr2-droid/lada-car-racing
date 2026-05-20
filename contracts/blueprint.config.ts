import { Config } from '@ton/blueprint';

/**
 * Blueprint config — pointing at the TON Hub v4 testnet endpoint.
 *
 * Why v4 + tonhub:
 *   - toncenter testnet has been flaky (intermittent 500s on jsonRPC)
 *   - the v4 endpoint is faster and doesn't need an API key
 *
 * Endpoint chain (use whichever stays up):
 *   primary  : https://testnet-v4.tonhubapi.com           ← configured below
 *   fallback : https://testnet.tonapi.io/api/v2/jsonRPC   ← see CLI snippet
 *
 * Switch to the fallback via the CLI (no config edit needed):
 *   npx blueprint run deployLadaEscrow --custom \
 *     --custom-version=v2 \
 *     --custom-type=testnet \
 *     https://testnet.tonapi.io/api/v2/jsonRPC
 *
 * Or to mainnet later:
 *   npx blueprint run deployLadaEscrow --mainnet
 */
export const config: Config = {
  network: {
    endpoint: 'https://testnet-v4.tonhubapi.com',
    version: 'v4',
    type: 'testnet',
  },
};
