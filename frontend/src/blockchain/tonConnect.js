/**
 * Thin wrapper around TonConnect.
 *
 * Other modules in /blockchain build typed tx payloads; this hook actually
 * sends them.
 */
import { useTonConnectUI, useTonAddress } from '@tonconnect/ui-react';

export function useTonSender() {
  const [tonConnectUI] = useTonConnectUI();
  const address = useTonAddress();

  /** Send a TonConnect tx (built by buildCommit/buildReveal/buildDeposit). */
  async function send(tx) {
    return tonConnectUI.sendTransaction(tx);
  }

  return { address, send, isConnected: Boolean(address) };
}
