/**
 * Display helpers. Backend serialises amounts as decimal strings of
 * nano-LADA (BigInt-safe), so we format them with care.
 */

const NANO = 1_000_000_000n;

export function formatLada(amount, { decimals = 2 } = {}) {
  if (amount == null || amount === '') return '—';
  const n = typeof amount === 'bigint' ? amount : BigInt(amount);
  const whole = n / NANO;
  const frac  = n % NANO;
  if (decimals === 0) return whole.toString();
  const fracStr = frac.toString().padStart(9, '0').slice(0, decimals);
  return `${whole}.${fracStr}`;
}

/** Whole LADA (input as Number or string) → nano-LADA BigInt. */
export function ladaToNano(amount) {
  const [w = '0', f = ''] = String(amount).split('.');
  const frac = (f + '000000000').slice(0, 9);
  return BigInt(w) * NANO + BigInt(frac);
}

export function shortAddress(addr) {
  if (!addr) return '—';
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function timeAgo(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
