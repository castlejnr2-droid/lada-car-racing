// ─── Buffer polyfill — MUST be the very first import ──────────────────
// @ton/core's BitString reads `Buffer.from(...)` in module-init code, so
// the global has to be available before any other module loads.
import { Buffer } from 'buffer';
if (typeof window !== 'undefined' && !window.Buffer) window.Buffer = Buffer;

import React from 'react';
import ReactDOM from 'react-dom/client';
import { TonConnectUIProvider } from '@tonconnect/ui-react';
import App from './App.jsx';
import './styles/global.css';

// Hardcoded manifest URL — must be the absolute https URL where TON wallets
// can fetch the manifest at runtime. Update this if the deployment domain
// ever changes.
const MANIFEST_URL = 'https://lada-car-racing.vercel.app/tonconnect-manifest.json';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <TonConnectUIProvider manifestUrl={MANIFEST_URL}>
      <App />
    </TonConnectUIProvider>
  </React.StrictMode>,
);
