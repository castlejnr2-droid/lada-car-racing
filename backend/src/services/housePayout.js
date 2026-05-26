/**
 * House wallet service — on-chain race management.
 *
 * The LadaEscrow contract lifecycle:
 *   1. Owner (house wallet) calls CreateRace  → escrow registers the race
 *   2. Players send jetton deposits with uint64 raceId in forward payload
 *   3. Players call CommitHash, then RevealSecret
 *   4. Contract settles automatically on the second RevealSecret:
 *        95% → winner, 5% → houseWallet  (no external payout trigger needed)
 *
 * There is NO DeclareWinner op in the contract.  Settlement is internal.
 * This file's only job is to call CreateRace before deposits arrive.
 *
 * Op codes (from contracts/contracts/lada_escrow.tact):
 *   CreateRace    0x6c726300  — owner only, registers race + players + stake
 *   CommitHash    0x6c726301  — players, not used here
 *   RevealSecret  0x6c726302  — players, not used here
 *   TimeoutRefund 0x6c726303  — anyone, not used here
 *
 * Required env vars:
 *   HOUSE_WALLET_MNEMONIC       24-word seed phrase of the contract owner wallet
 *   ESCROW_CONTRACT_ADDRESS     deployed LadaEscrow address
 *   TONCENTER_API_KEY           optional but recommended (rate-limit avoidance)
 */
import { Address, beginCell, toNano, internal } from '@ton/core';
import { TonClient, WalletContractV5R1 } from '@ton/ton';
import { mnemonicToPrivateKey } from '@ton/crypto';
import { config } from '../config.js';

const OP_CREATE_RACE = 0x6c726300;

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
      '[housePayout] HOUSE_WALLET_MNEMONIC is not set — cannot sign on-chain transactions. ' +
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
 * Register a new race on the escrow contract (CreateRace, op 0x6c726300).
 * Must be called BEFORE players send their jetton deposits so the escrow
 * has the race in its map and can credit their deposits.
 *
 * The escrow will settle automatically when both players reveal; no further
 * call from the backend is needed to release funds.
 *
 * @param {object} opts
 * @param {string|bigint} opts.raceId    uint64 race ID (must be unique in the contract)
 * @param {string|bigint} opts.stake     stake per player in nano-LADA
 * @param {string}        opts.player1   TON wallet address of player 1
 * @param {string}        opts.player2   TON wallet address of player 2
 * @param {string}        [opts.escrowAddress]  override config if needed
 */
export async function createRaceOnChain({ raceId, stake, player1, player2, escrowAddress }) {
  const escrow = escrowAddress || config.ton.escrowAddress;

  console.log('[housePayout] createRaceOnChain called:', {
    raceId:  raceId?.toString(),
    stake:   stake?.toString(),
    player1,
    player2,
    escrow,
    network: config.ton.network,
  });

  if (!escrow) {
    throw new Error('[housePayout] ESCROW_CONTRACT_ADDRESS is not configured');
  }

  // Validate addresses
  let p1Addr, p2Addr, escrowAddr;
  try { p1Addr = Address.parse(player1); } catch (e) {
    throw new Error(`[housePayout] invalid player1 address "${player1}": ${e.message}`);
  }
  try { p2Addr = Address.parse(player2); } catch (e) {
    throw new Error(`[housePayout] invalid player2 address "${player2}": ${e.message}`);
  }
  try { escrowAddr = Address.parse(escrow); } catch (e) {
    throw new Error(`[housePayout] invalid escrow address "${escrow}": ${e.message}`);
  }

  const raceIdBigInt  = BigInt(raceId);
  const stakeBigInt   = BigInt(stake);

  const { wallet, keyPair } = await getHouseWallet();
  const client   = getClient();
  const contract = client.open(wallet);

  let seqno;
  try {
    seqno = await contract.getSeqno();
    console.log('[housePayout] seqno:', seqno);
  } catch (e) {
    throw new Error(`[housePayout] failed to get seqno (is house wallet deployed/funded?): ${e.message}`);
  }

  // CreateRace body: op(32) + raceId(64) + stake(coins) + player1(addr) + player2(addr)
  // Matches: message(0x6c726300) CreateRace { raceId: uint64; stake: coins; player1: Address; player2: Address; }
  const body = beginCell()
    .storeUint(OP_CREATE_RACE, 32)
    .storeUint(raceIdBigInt, 64)
    .storeCoins(stakeBigInt)
    .storeAddress(p1Addr)
    .storeAddress(p2Addr)
    .endCell();

  try {
    await contract.sendTransfer({
      seqno,
      secretKey: keyPair.secretKey,
      messages: [
        internal({
          to:     escrowAddr,
          value:  toNano('0.05'),
          bounce: true,
          body,
        }),
      ],
    });
  } catch (e) {
    throw new Error(`[housePayout] sendTransfer failed: ${e.message}`);
  }

  console.log('[housePayout] CreateRace sent successfully:', {
    raceId:  raceIdBigInt.toString(),
    stake:   `${Number(stakeBigInt / 1_000_000_000n)} LADA per player`,
    player1,
    player2,
    escrow,
    seqno,
  });
}

