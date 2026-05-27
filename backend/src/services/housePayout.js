/**
 * House wallet service — on-chain race management (LadaEscrow v2).
 *
 * Contract lifecycle (owner-payout model):
 *   1. CreateRace  (owner) — register race before deposits
 *   2. TokenNotification — players deposit Lada; contract tracks them
 *   3. Payout      (bypass) — WithdrawJettons to house wallet, then direct
 *                             jetton transfer to winner (escrow Payout op bypassed)
 *   4. Refund      (owner) — return stakes if race cancelled
 *
 * Op codes (contracts/contracts/lada_escrow.tact):
 *   CreateRace       0x6c726300  — owner only
 *   Refund           0x6c726305  — owner only, returns deposits
 *   WithdrawJettons  0x6c726306  — owner only, sweeps LADA out of contract
 *   SetJettonWallet  0x6c726307  — owner only, one-time post-deploy setup
 *
 * Required env vars:
 *   HOUSE_WALLET_MNEMONIC   24-word seed phrase of the contract owner
 *   ESCROW_CONTRACT_ADDRESS deployed LadaEscrow address
 *   TONCENTER_API_KEY       optional but recommended
 */
import { Address, beginCell, toNano, internal } from '@ton/core';
import { TonClient, WalletContractV5R1 } from '@ton/ton';
import { mnemonicToPrivateKey } from '@ton/crypto';
import { config } from '../config.js';

const OP_CREATE_RACE      = 0x6c726300;
const OP_REFUND           = 0x6c726305;
const OP_WITHDRAW_JETTONS = 0x6c726306;
const OP_SET_PLAYER2      = 0x6c726308;
const JETTON_TRANSFER_OP  = 0x0f8a7ea5;

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
      '[housePayout] HOUSE_WALLET_MNEMONIC is not set — cannot sign on-chain transactions.',
    );
  }

  const words = mnemonic.trim().split(/\s+/);
  if (words.length !== 24) {
    throw new Error(`[housePayout] HOUSE_WALLET_MNEMONIC has ${words.length} words, expected 24`);
  }

  _keyPair = await mnemonicToPrivateKey(words);
  _wallet  = WalletContractV5R1.create({ publicKey: _keyPair.publicKey, workchain: 0 });

  const walletAddr = _wallet.address.toString({ urlSafe: true, bounceable: false });
  console.log('[housePayout] house wallet address (V5R1):', walletAddr);
  return { wallet: _wallet, keyPair: _keyPair };
}

async function sendToEscrow({ body, value, label }) {
  const escrow = config.ton.escrowAddress;
  if (!escrow) throw new Error('[housePayout] ESCROW_CONTRACT_ADDRESS is not configured');

  let escrowAddr;
  try { escrowAddr = Address.parse(escrow); } catch (e) {
    throw new Error(`[housePayout] invalid escrow address "${escrow}": ${e.message}`);
  }

  const { wallet, keyPair } = await getHouseWallet();
  const client   = getClient();
  const contract = client.open(wallet);

  let seqno;
  try {
    seqno = await contract.getSeqno();
  } catch (e) {
    throw new Error(`[housePayout] failed to get seqno (is house wallet deployed/funded?): ${e.message}`);
  }
  console.log(`[housePayout] ${label} | seqno=${seqno} | escrow=${escrow}`);

  try {
    await contract.sendTransfer({
      seqno,
      secretKey: keyPair.secretKey,
      messages: [
        internal({
          to:     escrowAddr,
          value:  toNano(value),
          bounce: true,
          body,
        }),
      ],
    });
  } catch (e) {
    throw new Error(`[housePayout] ${label} sendTransfer failed: ${e.message}`);
  }

  console.log(`[housePayout] ${label} sent OK | seqno=${seqno}`);
}

/**
 * Resolve the house wallet's own LADA jetton wallet address via get_wallet_address.
 */
async function getHouseJettonWallet() {
  const ladaMaster      = config.ton.ladaJettonMaster;
  const houseWalletAddr = config.ton.houseWallet;
  if (!ladaMaster)      throw new Error('[housePayout] LADA_JETTON_MASTER not configured');
  if (!houseWalletAddr) throw new Error('[housePayout] HOUSE_WALLET_ADDRESS not configured');

  const client = getClient();
  const result = await client.runMethod(
    Address.parse(ladaMaster),
    'get_wallet_address',
    [{ type: 'slice', cell: beginCell().storeAddress(Address.parse(houseWalletAddr)).endCell() }],
  );
  const addr = result.stack.readAddress();
  console.log('[housePayout] house LADA jetton wallet:', addr.toString({ urlSafe: true, bounceable: false }));
  return addr;
}

/**
 * Send LADA jettons directly from the house wallet to `to`.
 * Signs a standard TEP-74 transfer from the house wallet to its own LADA
 * jetton wallet, which then forwards the tokens on-chain.
 */
async function sendJettonFromHouseWallet({ to, amount, label }) {
  const houseWalletAddr   = config.ton.houseWallet;
  const houseJettonWallet = await getHouseJettonWallet();

  const body = beginCell()
    .storeUint(JETTON_TRANSFER_OP, 32)
    .storeUint(0n, 64)                                   // queryId
    .storeCoins(amount)                                  // amount to transfer
    .storeAddress(Address.parse(to))                     // destination (winner)
    .storeAddress(Address.parse(houseWalletAddr))        // responseDestination
    .storeBit(0)                                         // no customPayload
    .storeCoins(toNano('0.01'))                          // forwardTonAmount
    .storeBit(0)                                         // forwardPayload: inline, empty
    .endCell();

  const { wallet, keyPair } = await getHouseWallet();
  const client   = getClient();
  const contract = client.open(wallet);

  let seqno;
  try {
    seqno = await contract.getSeqno();
  } catch (e) {
    throw new Error(`[housePayout] failed to get seqno for ${label}: ${e.message}`);
  }
  console.log(`[housePayout] ${label} | seqno=${seqno} | to=${to} | amount=${amount}`);

  try {
    await contract.sendTransfer({
      seqno,
      secretKey: keyPair.secretKey,
      messages: [
        internal({
          to:     houseJettonWallet,
          value:  toNano('0.1'),
          bounce: true,
          body,
        }),
      ],
    });
  } catch (e) {
    throw new Error(`[housePayout] ${label} sendTransfer failed: ${e.message}`);
  }
  console.log(`[housePayout] ${label} sent OK | seqno=${seqno}`);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Register a new race on the escrow contract (CreateRace op).
 * Must be called BEFORE players send deposits.
 */
export async function createRaceOnChain({ raceId, stake, player1, player2 }) {
  let p1Addr, p2Addr;
  try { p1Addr = Address.parse(player1); } catch (e) {
    throw new Error(`[housePayout] invalid player1 address "${player1}": ${e.message}`);
  }
  try { p2Addr = Address.parse(player2); } catch (e) {
    throw new Error(`[housePayout] invalid player2 address "${player2}": ${e.message}`);
  }

  const raceIdBigInt = BigInt(raceId);
  const stakeBigInt  = BigInt(stake);

  console.log('[housePayout] createRaceOnChain:', {
    raceId: raceIdBigInt.toString(), stake: stakeBigInt.toString(), player1, player2,
    network: config.ton.network,
  });

  const body = beginCell()
    .storeUint(OP_CREATE_RACE, 32)
    .storeUint(raceIdBigInt, 64)
    .storeCoins(stakeBigInt)
    .storeAddress(p1Addr)
    .storeAddress(p2Addr)
    .endCell();

  await sendToEscrow({ body, value: '0.05', label: `CreateRace(${raceIdBigInt})` });
}

/**
 * Pay out the winner of a race — bypass approach.
 *
 * The escrow's internal Payout op is unreliable, so we route through the
 * house wallet as intermediary instead:
 *
 *   1. WithdrawJettons — sweep the full pot (stake × 2) from the escrow
 *      contract to the house wallet.
 *   2. Wait ~20 s for the on-chain jetton transfer to confirm.
 *   3. Send 95 % of the pot directly from the house wallet to the winner
 *      via a standard TEP-74 jetton transfer.  The 5 % fee stays in the
 *      house wallet.
 *
 * @param {string} raceId  on-chain race ID (uint64 as string)
 * @param {string} winner  TON address of the winning player
 * @param {string} stake   nano-LADA stake per player (string)
 */
export async function payoutRace({ raceId, winner, stake }) {
  const raceIdBigInt = BigInt(raceId);
  const potBigInt    = BigInt(stake) * 2n;
  const winnerAmount = potBigInt - (potBigInt * 500n / 10000n);  // 95 %

  const houseWalletAddr = config.ton.houseWallet;
  if (!houseWalletAddr) throw new Error('[housePayout] HOUSE_WALLET_ADDRESS not configured');

  console.log('[housePayout] payoutRace (bypass):', {
    raceId: raceIdBigInt.toString(), winner,
    pot: potBigInt.toString(), winnerAmount: winnerAmount.toString(),
    network: config.ton.network,
  });

  // ── 1. Sweep pot from escrow → house wallet ───────────────────────
  await sendToEscrow({
    body: beginCell()
      .storeUint(OP_WITHDRAW_JETTONS, 32)
      .storeCoins(potBigInt)
      .storeAddress(Address.parse(houseWalletAddr))
      .endCell(),
    value: '0.1',
    label: `WithdrawJettons(race=${raceIdBigInt}, pot=${potBigInt})`,
  });

  // ── 2. Wait for escrow → house jetton transfer to confirm ─────────
  console.log('[housePayout] payoutRace — waiting 20 s for WithdrawJettons to confirm…');
  await new Promise(resolve => setTimeout(resolve, 20_000));

  // ── 3. Forward 95 % to winner from house wallet ───────────────────
  await sendJettonFromHouseWallet({
    to:     winner,
    amount: winnerAmount,
    label:  `JettonToWinner(race=${raceIdBigInt}, winner=${winner})`,
  });
}

/**
 * Refund both players (Refund op, owner-only).
 * Use when a race needs to be cancelled after deposits have been made.
 */
export async function refundRace({ raceId }) {
  const raceIdBigInt = BigInt(raceId);
  console.log('[housePayout] refundRace:', { raceId: raceIdBigInt.toString() });

  // Refund body: op(32) raceId(64)
  const body = beginCell()
    .storeUint(OP_REFUND, 32)
    .storeUint(raceIdBigInt, 64)
    .endCell();

  // 0.2 TON: the contract may send up to 2 jetton transfers
  await sendToEscrow({ body, value: '0.2', label: `Refund(${raceIdBigInt})` });
}

/**
 * Update player2 for a race that hasn't had player2 deposit yet (SetPlayer2 op).
 * Called when the real player2 joins a lobby that was opened with a placeholder.
 */
export async function setPlayer2OnChain({ raceId, player2 }) {
  let p2Addr;
  try { p2Addr = Address.parse(player2); } catch (e) {
    throw new Error(`[housePayout] invalid player2 address "${player2}": ${e.message}`);
  }

  const raceIdBigInt = BigInt(raceId);
  console.log('[housePayout] setPlayer2OnChain:', { raceId: raceIdBigInt.toString(), player2 });

  const body = beginCell()
    .storeUint(OP_SET_PLAYER2, 32)
    .storeUint(raceIdBigInt, 64)
    .storeAddress(p2Addr)
    .endCell();

  await sendToEscrow({ body, value: '0.05', label: `SetPlayer2(${raceIdBigInt}, p2=${player2})` });
}

/**
 * Sweep accumulated house fees out of the escrow contract.
 * The 5% from each settled race stays in the contract — this withdraws them.
 *
 * @param {string}  amount  nano-LADA to withdraw
 * @param {string}  to      destination address
 */
export async function withdrawHouseFees({ amount, to }) {
  let toAddr;
  try { toAddr = Address.parse(to); } catch (e) {
    throw new Error(`[housePayout] invalid destination address "${to}": ${e.message}`);
  }

  const amountBigInt = BigInt(amount);
  console.log('[housePayout] withdrawHouseFees:', { amount: amountBigInt.toString(), to });

  const body = beginCell()
    .storeUint(OP_WITHDRAW_JETTONS, 32)
    .storeCoins(amountBigInt)
    .storeAddress(toAddr)
    .endCell();

  await sendToEscrow({ body, value: '0.1', label: `WithdrawJettons(${amountBigInt})` });
}
