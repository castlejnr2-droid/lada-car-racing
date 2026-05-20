import { initData } from '../lib/telegram.js';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export async function api(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'X-Telegram-Init-Data': initData(),
    ...(options.headers || {}),
  };
  const res = await fetch(`${API_URL}${path}`, { ...options, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`API ${path} → ${res.status}: ${body}`);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}
