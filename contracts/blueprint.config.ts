import { Config } from '@ton/blueprint';

/**
 * Blueprint config. Sets the default network to testnet so the CLI doesn't
 * prompt every run; pass `--mainnet` to override.
 *
 * Using the string form `'testnet'` (rather than a CustomNetwork object) is
 * deliberate — Blueprint's CLI handles known-network strings everywhere,
 * whereas a CustomNetwork object can interact badly with some prompts.
 *
 * To target a specific endpoint (e.g. toncenter with your own key) pass it
 * on the CLI:
 *   npx blueprint run deployLadaEscrow --custom \
 *     --custom-key=YOUR_KEY \
 *     --custom-version=v2 \
 *     --custom-type=testnet \
 *     https://testnet.toncenter.com/api/v2/jsonRPC
 */
export const config: Config = {
  network: 'testnet',
};
