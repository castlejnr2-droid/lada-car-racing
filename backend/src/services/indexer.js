/**
 * Polls TonAPI for escrow contract events and forwards them to /webhook/event.
 *
 * In production this should be a separate worker process, but for the MVP
 * we run it inside the API process.
 */
import { config } from '../config.js';

const POLL_INTERVAL_MS = 5_000;

export async function startIndexer() {
  if (!config.ton.escrowAddress) {
    console.warn('[indexer] ESCROW_CONTRACT_ADDRESS not set — indexer disabled');
    return;
  }
  console.log('[indexer] starting, watching', config.ton.escrowAddress);
  setInterval(pollOnce, POLL_INTERVAL_MS);
}

async function pollOnce() {
  // TODO: fetch new transactions from TonAPI, parse external_out messages,
  // identify WinnerDeclared events, and write them to the races table.
}
