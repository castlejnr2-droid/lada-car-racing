/**
 * House wallet payout service.
 *
 * After the backend determines a winner it sends a DeclareWinner internal
 * message from the house wallet to the escrow contract.  The escrow contract
 * then releases the pot to the winner's TON wallet address.
 *
 * Op code (must match the FunC contract):
 *   DeclareWinner  0x6c726304
 *
 * Required env vars:
 *   HOUSE_WALLET_MNEMONIC  — 24-word seed phrase of the house wallet
 *   ESCROW_CONTRACT_ADDRESS — deployed escrow address
 *   TONCENTER_API_KEY       — optional but recommended (rate-limit avoidance)
 */
import { Address, beginCell, toNano, internal } from '@ton/core';
import { TonClient, WalletContractV5R1 } from '@ton/ton';
import { mnemonicToPrivateKey } from '@ton/crypto';
import { config } from '../config.js';

const OP_DECLARE_WINNER = 0x6c726304;

let _client  = null;
let _wallet  = null;
let _keyPair = null;

function getClient() {
  if (_client) return _client;
  const endpoint =
    config.ton.network === 'mainnet'
      ? 'https://toncenter.com/api/v2/jsonRPC'
      : 'https://testnet.toncenter.com/api/v2/jsonRPC';
  console.log('[housePayout] TonClient endpoint:', endpoint);
  _client = new TonClient({ endpoint, apiKey: config.ton.apiKey || undefined });
  return _client;
}

async function getHouseWallet() {
  if (_wallet && _keyPair) return { wallet: _wallet, keyPair: _keyPair };

  const mnemonic = config.ton.houseWalletMnemonic;
  if (!mnemonic) {
    throw new Error(
      '[housePayout] HOUSE_WALLET_MNEMONIC is not set — cannot sign payout transactions. ' +
      'Set it in Railway environment variables.',
    );
  }

  const words = mnemonic.trim().split(/\s+/);
  if (words.length !== 24) {
    throw new Error(`[housePayout] HOUSE_WALLET_MNEMONIC has ${words.length} words, expected 24`);
  }

  _keyPair = await mnemonicToPrivateKey(words);
  _wallet  = WalletContractV5R1.create({ publicKey: _keyPair.publicKey, workchain: 0 });

  const walletAddr = _wallet.address.toString({ urlSafe: true, bounceable: false });
  console.log('[housePayout] derived house wallet address (V5R1):', walletAddr);
  return { wallet: _wallet, keyPair: _keyPair };
}

/**
 * Instruct the escrow contract to pay out the winner.
 *
 * @param {object} opts
 * @param {string}  opts.onChainRaceId  numeric race ID (uint64) the contract tracks
 * @param {string}  opts.winnerAddress  winner's TON wallet address (any format)
 * @param {string}  [opts.pot]          pot size in nano-LADA, for logging only
 * @param {string}  [opts.winnerPayout] payout in nano-LADA, for logging only
 * @param {string}  [opts.escrowAddress] override config if needed
 */
export async function releaseToWinner({ onChainRaceId, winnerAddress, pot, winnerPayout, escrowAddress }) {
  const escrow = escrowAddress || config.ton.escrowAddress;

  console.log('[housePayout] releaseToWinner called:', {
    onChainRaceId,
    winnerAddress,
    pot,
    winnerPayout,
    escrow,
    network: config.ton.network,
  });

  if (!escrow) {
    throw new Error('[housePayout] ESCROW_CONTRACT_ADDRESS is not configured');
  }

  // Validate inputs before touching the chain
  let winnerAddr;
  try {
    winnerAddr = Address.parse(winnerAddress);
  } catch (e) {
    throw new Error(`[housePayout] invalid winner address "${winnerAddress}": ${e.message}`);
  }

  let escrowAddr;
  try {
    escrowAddr = Address.parse(escrow);
  } catch (e) {
    throw new Error(`[housePayout] invalid escrow address "${escrow}": ${e.message}`);
  }

  let raceIdBigInt;
  try {
    raceIdBigInt = BigInt(onChainRaceId);
  } catch (e) {
    throw new Error(`[housePayout] invalid onChainRaceId "${onChainRaceId}": ${e.message}`);
  }

  const { wallet, keyPair } = await getHouseWallet();
  const client   = getClient();
  const contract = client.open(wallet);

  let seqno;
  try {
    seqno = await contract.getSeqno();
    console.log('[housePayout] house wallet seqno:', seqno);
  } catch (e) {
    throw new Error(`[housePayout] failed to get seqno (is house wallet deployed/funded?): ${e.message}`);
  }

  const body = beginCell()
    .storeUint(OP_DECLARE_WINNER, 32)
    .storeUint(0n, 64)          // query_id
    .storeUint(raceIdBigInt, 64) // race_id
    .storeAddress(winnerAddr)    // winner
    .endCell();

  try {
    await contract.sendTransfer({
      seqno,
      secretKey: keyPair.secretKey,
      messages: [
        internal({
          to:     escrowAddr,
          value:  toNano('0.05'),  // gas for escrow execution
          bounce: true,
          body,
        }),
      ],
    });
  } catch (e) {
    throw new Error(`[housePayout] sendTransfer failed: ${e.message}`);
  }

  console.log('[housePayout] DeclareWinner sent successfully:', {
    raceId:        onChainRaceId,
    winner:        winnerAddress,
    winnerPayout:  winnerPayout ? `${Number(BigInt(winnerPayout) / 1_000_000_000n)} LADA` : 'unknown',
    pot:           pot ? `${Number(BigInt(pot) / 1_000_000_000n)} LADA` : 'unknown',
    escrow,
    seqno,
  });
}
