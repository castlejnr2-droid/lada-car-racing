/**
 * House wallet payout service.
 *
 * When both players have revealed their secrets the backend must instruct the
 * on-chain escrow to settle and release funds to the winner.  We do this by
 * sending a signed internal message from the house wallet to the escrow
 * contract carrying the winner's address.
 *
 * Op codes (match the FunC contract):
 *   DeclareWinner  0x6c726304  — tells escrow who won; escrow calculates payout
 *   SettleRace     0x6c726305  — triggers payout execution after DeclareWinner
 *
 * For simplicity we combine both into one DeclareWinner message and let the
 * contract handle the payout atomically, which is how the reference contract
 * works.  If your contract separates them, un-comment the SettleRace send.
 */
import { Address, beginCell, fromNano, toNano, internal } from '@ton/core';
import { TonClient, WalletContractV4 } from '@ton/ton';
import { mnemonicToPrivateKey } from '@ton/crypto';
import { config } from '../config.js';

const OP_DECLARE_WINNER = 0x6c726304;

let _client = null;

function getClient() {
  if (_client) return _client;
  const endpoint =
    config.ton.network === 'mainnet'
      ? 'https://toncenter.com/api/v2/jsonRPC'
      : 'https://testnet.toncenter.com/api/v2/jsonRPC';
  _client = new TonClient({
    endpoint,
    apiKey: config.ton.apiKey || undefined,
  });
  return _client;
}

/**
 * Derive the WalletContractV4 instance and key pair from the mnemonic.
 * Cached after first call.
 */
let _wallet = null;
let _keyPair = null;

async function getHouseWallet() {
  if (_wallet && _keyPair) return { wallet: _wallet, keyPair: _keyPair };

  const mnemonic = config.ton.houseWalletMnemonic;
  if (!mnemonic) throw new Error('HOUSE_WALLET_MNEMONIC is not configured');

  const words = mnemonic.trim().split(/\s+/);
  _keyPair = await mnemonicToPrivateKey(words);

  _wallet = WalletContractV4.create({
    publicKey: _keyPair.publicKey,
    workchain: 0,
  });

  return { wallet: _wallet, keyPair: _keyPair };
}

/**
 * Send a DeclareWinner message to the escrow contract.
 *
 * @param {object} opts
 * @param {string} opts.onChainRaceId  - uint64 race ID the contract tracks
 * @param {string} opts.winnerAddress  - TON address (any form) of the winner
 * @param {string} [opts.escrowAddress] - override config if needed
 */
export async function releaseToWinner({ onChainRaceId, winnerAddress, escrowAddress }) {
  const escrow = escrowAddress || config.ton.escrowAddress;
  if (!escrow) throw new Error('Escrow contract address not configured');

  const { wallet, keyPair } = await getHouseWallet();
  const client   = getClient();
  const contract = client.open(wallet);

  const seqno = await contract.getSeqno();

  const body = beginCell()
    .storeUint(OP_DECLARE_WINNER, 32)
    .storeUint(0n, 64)                                    // query_id
    .storeUint(BigInt(onChainRaceId), 64)                 // race_id
    .storeAddress(Address.parse(winnerAddress))           // winner
    .endCell();

  await contract.sendTransfer({
    seqno,
    secretKey: keyPair.secretKey,
    messages: [
      internal({
        to: Address.parse(escrow),
        value: toNano('0.05'),   // gas for the contract execution
        bounce: true,
        body,
      }),
    ],
  });

  console.log(
    `[housePayout] DeclareWinner sent | race=${onChainRaceId} | winner=${winnerAddress} | seqno=${seqno}`,
  );
}
