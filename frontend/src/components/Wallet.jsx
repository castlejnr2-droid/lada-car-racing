import { TonConnectButton, useTonAddress } from '@tonconnect/ui-react';

export default function Wallet() {
  const address = useTonAddress();

  return (
    <div className="wallet">
      <h2>Wallet</h2>
      <TonConnectButton />
      {address && <p>Connected: {address}</p>}
    </div>
  );
}
