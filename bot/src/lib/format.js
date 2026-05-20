/**
 * Display helpers. Backend serialises amounts as decimal strings of
 * nano-LADA (BigInt-safe), so we format them with care.
 */

const NANO = 1_000_000_000n;

export function formatLada(amountStr, { decimals = 2 } = {}) {
  if (amountStr == null) return '—';
  const n = BigInt(amountStr);
  const whole = n / NANO;
  const frac  = n % NANO;
  if (decimals === 0) return `${whole}`;
  const fracStr = frac.toString().padStart(9, '0').slice(0, decimals);
  return `${whole}.${fracStr}`;
}

export function shortAddress(addr) {
  if (!addr) return '—';
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

export function displayName(player) {
  if (player?.username) return escapeHtml(player.username);
  if (player?.address)  return shortAddress(player.address);
  return 'a mystery racer';
}
