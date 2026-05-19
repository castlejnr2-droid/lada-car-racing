/**
 * Thin wrapper around TonConnect. Anything that needs to send a transaction
 * goes through here so the rest of /blockchain has a single source of truth
 * for the connector.
 */
import { useTonConnectUI, useTonAddress } from '@tonconnect/ui-react';

export function useTonSender() {
  const [tonConnectUI] = useTonConnectUI();
  const address = useTonAddress();

  async function send(messages) {
    return tonConnectUI.sendTransaction({
      validUntil: Math.floor(Date.now() / 1000) + 360,
      messages,
    });
  }

  return { address, send };
}
