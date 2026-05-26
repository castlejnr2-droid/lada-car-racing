import { Address, beginCell, Cell, toNano } from '@ton/core';
import { NetworkProvider } from '@ton/blueprint';
import { LadaEscrow as LadaEscrowGenerated } from '../build/LadaEscrow/tact_LadaEscrow';
import { LadaEscrow, OP } from '../wrappers/LadaEscrow';

// Use the generated wrapper for fromInit (has correct code/data cells)
const LadaEscrowFactory = LadaEscrowGenerated;

/**
 * Blueprint deploy script for LadaEscrow v2 (owner-payout model).
 *
 * Two-phase deploy:
 *   Phase 1 — deploy the contract (jetton wallet set to owner as placeholder)
 *   Phase 2 — compute the escrow's actual Lada jetton wallet (depends on the
 *              contract address) then call SetJettonWallet
 *
 * Network:
 *   testnet (default)  — no extra flag
 *   mainnet            — add --mainnet flag
 *
 * Required env vars:
 *   WALLET_MNEMONIC   24-word seed phrase of the deploying wallet
 *   WALLET_VERSION    wallet version: v4 or v5r1 (lowercase)
 *
 * Optional env vars:
 *   HOUSE_WALLET          TON address — defaults to the deploying wallet
 *   LADA_JETTON_MASTER    LADA jetton master — defaults to mainnet address below
 *
 * Windows (mainnet):
 *   set WALLET_MNEMONIC=word word ... word
 *   set WALLET_VERSION=v5r1
 *   set TONCENTER_API_KEY=your-key
 *   npx blueprint run deployLadaEscrow --mnemonic --mainnet
 */

// Mainnet LADA jetton master
const LADA_JETTON_MASTER_DEFAULT = 'EQBjNisz_m-sdA9TcosQMmugdhl6hDjGcCMgQFa85p_8jx7p';

function parseAddrOrDie(value: string, label: string): Address {
  try {
    return Address.parse(value);
  } catch (e: any) {
    console.error(`✗ ${label} address could not be parsed: "${value}"`);
    console.error(`  Reason: ${e?.message || e}`);
    process.exit(1);
  }
}

/**
 * Resolve the jetton wallet for `owner` from `jettonMaster` via Toncenter.
 */
async function resolveJettonWallet(
  jettonMaster: Address,
  owner: Address,
  apiBase: string,
  apiKey?: string,
): Promise<Address> {
  const ownerBoc = beginCell()
    .storeAddress(owner)
    .endCell()
    .toBoc()
    .toString('base64');

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['X-API-Key'] = apiKey;

  const res = await fetch(`${apiBase}/runGetMethod`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      address: jettonMaster.toString(),
      method: 'get_wallet_address',
      stack: [['slice', { bytes: ownerBoc }]],
    }),
  });
  const data = await res.json() as any;
  if (!data.ok) throw new Error(`get_wallet_address failed: ${JSON.stringify(data)}`);

  const entry = data.result?.stack?.[0];
  const cellB64 = entry?.[1]?.bytes ?? (typeof entry?.[1] === 'string' ? entry[1] : null);
  if (!cellB64) throw new Error('get_wallet_address: no cell in stack');

  return Cell.fromBase64(cellB64).beginParse().loadAddress();
}

export async function run(provider: NetworkProvider) {
  const owner = provider.sender().address!;
  const network = provider.network();

  const houseWallet = process.env.HOUSE_WALLET
    ? parseAddrOrDie(process.env.HOUSE_WALLET, 'HOUSE_WALLET')
    : owner;

  const jettonMasterStr = process.env.LADA_JETTON_MASTER || LADA_JETTON_MASTER_DEFAULT;
  const jettonMaster = parseAddrOrDie(jettonMasterStr, 'LADA_JETTON_MASTER');

  const toncenterBase = network === 'mainnet'
    ? 'https://toncenter.com/api/v2'
    : 'https://testnet.toncenter.com/api/v2';

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  LadaEscrow v2 deployment (owner-payout model)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Network:        ', network, network === 'mainnet' ? '⚠ REAL TON' : '');
  console.log('  Deployer:       ', owner.toString());
  console.log('  House wallet:   ', houseWallet.toString());
  console.log('  Jetton master:  ', jettonMaster.toString());
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // ── Phase 1: deploy (use owner as placeholder jetton wallet) ──────
  // The real jetton wallet depends on the contract address, which depends
  // on the init data. We use the owner as a placeholder and update it
  // in phase 2 via SetJettonWallet.
  const escrow = provider.open(
    await LadaEscrowFactory.fromInit(owner, houseWallet, owner /* placeholder */),
  );

  console.log('  Predicted address:', escrow.address.toString());
  console.log('  Phase 1: sending deploy transaction…');

  await escrow.send(
    provider.sender(),
    { value: toNano('0.5') },
    { $$type: 'Deploy', queryId: 0n },
  );

  await provider.waitForDeploy(escrow.address);
  console.log('  ✓ Contract deployed at:', escrow.address.toString());

  // ── Phase 2: compute and set the actual Lada jetton wallet ────────
  console.log('  Phase 2: resolving Lada jetton wallet for this contract…');

  let jettonWallet: Address;
  try {
    jettonWallet = await resolveJettonWallet(
      jettonMaster,
      escrow.address,
      toncenterBase,
      process.env.TONCENTER_API_KEY,
    );
    console.log('  Resolved jetton wallet:', jettonWallet.toString());
  } catch (e: any) {
    console.error('  ✗ Could not resolve jetton wallet:', e.message);
    console.error('  Run SetJettonWallet manually after the LADA jetton master');
    console.error('  has indexed the new contract address.');
    console.error('  Use: contracts/tools/_verify_jetton_addr.ts');
    jettonWallet = owner; // leave placeholder, owner can fix later
  }

  console.log('  Sending SetJettonWallet…');
  const setWalletBody = beginCell()
    .storeUint(OP.SetJettonWallet, 32)
    .storeAddress(jettonWallet)
    .endCell();

  await provider.sender().send({
    to: escrow.address,
    value: toNano('0.05'),
    body: setWalletBody,
  });

  const explorer = network === 'mainnet'
    ? `https://tonviewer.com/${escrow.address.toString()}`
    : `https://testnet.tonviewer.com/${escrow.address.toString()}`;

  console.log('');
  console.log('  ✓ Deployment complete!');
  console.log('  Contract address:', escrow.address.toString());
  console.log('  Jetton wallet:   ', jettonWallet.toString());
  console.log('  Explorer:        ', explorer);
  console.log('');
  console.log('  ─── Update these env vars ──────────────────────────');
  console.log('  ESCROW_CONTRACT_ADDRESS=' + escrow.address.toString());
  console.log('  VITE_ESCROW_CONTRACT_ADDRESS=' + escrow.address.toString());
  console.log('  LADA_JETTON_WALLET=' + jettonWallet.toString());
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}
