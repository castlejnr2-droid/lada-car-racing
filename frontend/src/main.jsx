// ─── Buffer polyfill — MUST be the very first import ──────────────────
// @ton/core's BitString reads `Buffer.from(...)` in module-init code, so
// the global has to be available before any other module loads.
// Even with vite-plugin-node-polyfills, some bundles need this set
// explicitly on `window` because BitString reads the global directly.
import { Buffer } from 'buffer';
if (typeof window !== 'undefined' && !window.Buffer) window.Buffer = Buffer;

import React from 'react';
import ReactDOM from 'react-dom/client';
import { TonConnectUIProvider } from '@tonconnect/ui-react';
import App from './App.jsx';
import './styles/global.css';

const manifestUrl = import.meta.env.VITE_TONCONNECT_MANIFEST_URL;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <TonConnectUIProvider manifestUrl={manifestUrl}>
      <App />
    </TonConnectUIProvider>
  </React.StrictMode>,
);
