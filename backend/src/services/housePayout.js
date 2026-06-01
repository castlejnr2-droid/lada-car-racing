/**
 * House wallet service — on-chain race management (LadaEscrow v2).
 *
 * Contract lifecycle (owner-payout model):
 *   1. CreateRace  (owner) — register race before deposits
 *   2. TokenNotification — players deposit Lada; contract tracks them
 *   3. Payout      (owner) — escrow sends 95% to winner from its own LADA balance;
 *                            5% stays in contract as house fee
 *   4. Refund      (owner) — return stakes if race cancelled
 *
 * Op codes (contracts/contracts/lada_escrow.tact):
 *   CreateRace       0x6c726300  — owner only
 *   Payout           0x6c726304  — owner only, escrow pays winner from its balance
 *   Refund           0x6c726305  — owner only, returns deposits
 *   WithdrawJettons  0x6c726306  — owner only, sweeps LADA out of contract
 *   SetJettonWallet  0x6c726307  — owner only, one-time post-deploy setup
 *
 * Required env vars:
 *   HOUSE_WALLET_MNEMONIC   24-word seed phrase of the contract owner
 *   HOUSE_WALLET_ADDRESS    UQBcQU2X2a8Ru1z3P0hYgVyGM6GzFzVhDkbWQ99YG73jXcyu
 *   ESCROW_CONTRACT_ADDRESS deployed LadaEscrow address
 *   TONCENTER_API_KEY       optional but recommended
 */
import { Address, beginCell, toNano, internal } from '@ton/core';
import { TonClient, WalletContractV5R1 } from '@ton/ton';
import { mnemonicToPrivateKey } from '@ton/crypto';
import { config } from '../config.js';

const OP_CREATE_RACE      = 0x6c726300;
const OP_PAYOUT           = 0x6c726304;
const OP_REFUND           = 0x6c726305;
const OP_WITHDRAW_JETTONS = 0x6c726306;
const OP_SET_PLAYER2      = 0x6c726308;

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

async function sendToEscrow({ body, value, label, waitForConfirmation = false }) {
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

  if (waitForConfirmation) {
    // Poll until house-wallet seqno advances — that means the TX was included in a block
    // and the CreateRace message has been forwarded to the escrow contract.
    // Allow up to 30 s; typical TON confirmation is 5–10 s.
    console.log(`[housePayout] ${label} waiting for on-chain confirmation …`);
    const deadline = Date.now() + 30_000;
    let confirmed = false;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 3_000));
      try {
        const newSeqno = await contract.getSeqno();
        if (newSeqno > seqno) {
          console.log(`[housePayout] ${label} confirmed | seqno ${seqno}→${newSeqno}`);
          confirmed = true;
          break;
        }
      } catch {
        // ignore transient network errors — keep polling
      }
    }
    if (!confirmed) {
      console.warn(`[housePayout] ${label} confirmation timed out after 30 s — proceeding anyway`);
    }
    // Extra wait for the escrow to process the inbound message (~1 block)
    await new Promise((r) => setTimeout(r, 5_000));
  }
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

  await sendToEscrow({ body, value: '0.05', label: `CreateRace(${raceIdBigInt})`, waitForConfirmation: true });
}

/**
 * Pay out the winner of a race (Payout op, owner-only).
 *
 * Sends the Payout message to the escrow contract. The escrow itself
 * sends 95% of the pot to the winner from its own LADA balance and keeps
 * the 5% house fee. Attach 0.2 TON to cover the escrow's gas and the
 * outbound jetton transfer (JETTON_FORWARD_TON=0.1 + computation).
 *
 * @param {string} raceId  on-chain race ID (uint64 as string)
 * @param {string} winner  TON address of the winning player
 */
export async function payoutRace({ raceId, winner }) {
  const raceIdBigInt = BigInt(raceId);
  let winnerAddr;
  try { winnerAddr = Address.parse(winner); } catch (e) {
    throw new Error(`[housePayout] invalid winner address "${winner}": ${e.message}`);
  }

  console.log('[housePayout] payoutRace (escrow Payout op):', {
    raceId: raceIdBigInt.toString(), winner, network: config.ton.network,
  });

  // seed is echoed in the WinnerDeclared event — use 0 (server-determined winner)
  const body = beginCell()
    .storeUint(OP_PAYOUT, 32)
    .storeUint(raceIdBigInt, 64)
    .storeAddress(winnerAddr)
    .storeUint(0n, 256)   // seed
    .endCell();

  // 0.2 TON: escrow needs ~0.1 for the outbound jetton transfer + gas
  await sendToEscrow({ body, value: '0.2', label: `Payout(race=${raceIdBigInt}, winner=${winner})` });
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

  await sendToEscrow({ body, value: '0.05', label: `SetPlayer2(${raceIdBigInt}, p2=${player2})`, waitForConfirmation: true });
}

/**
 * One-time fix: update the escrow's stored ladaJettonWallet to the correct
 * address derived from the LADA master for the escrow contract address.
 * Safe to call again — it's idempotent (owner-only SetJettonWallet op).
 */
export async function setEscrowJettonWallet() {
  // Correct LADA jetton wallet for the escrow contract, derived on-chain via:
  //   get_wallet_address(EQDjkkULU_3fxlbrR_kSVsogIi9ifxJ44aWoNHT1zr5ZVLPZ)
  //   on LADA master EQBjNisz_m-sdA9TcosQMmugdhl6hDjGcCMgQFa85p_8jx7p
  const CORRECT_WALLET = 'EQAfi7cbO6NvAfYXVvftXli1LijUHwinraa8OLO5Nh2MPwkP';

  const body = beginCell()
    .storeUint(0x6c726307, 32)  // SetJettonWallet op
    .storeAddress(Address.parse(CORRECT_WALLET))
    .endCell();

  await sendToEscrow({ body, value: '0.05', label: `SetJettonWallet(${CORRECT_WALLET})` });
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
