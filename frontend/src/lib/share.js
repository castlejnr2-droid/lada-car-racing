/**
 * Race share link helpers.
 *
 * Deep link format: https://t.me/<BOT>/<APP>?startapp=r_<raceId>
 * The startapp value is r_<raceId> — exactly what StartParamRedirect parses
 * to navigate to /spectate/<raceId>.
 *
 * Bot username and app short name are read from env vars so they can be
 * changed in one place without touching any component.
 */
import WebApp from '@twa-dev/sdk';

const BOT = import.meta.env.VITE_TG_BOT || 'LadaCarRacingBot';
const APP = import.meta.env.VITE_TG_APP || 'play';

/** Returns the Telegram Mini App deep link for a specific race. */
export function raceDeepLink(raceId) {
  return `https://t.me/${BOT}/${APP}?startapp=r_${raceId}`;
}

/**
 * Share a race via Telegram native share sheet if available,
 * or write the deep link to the clipboard as a fallback.
 *
 * Returns:
 *   'shared'  — Telegram share sheet opened (no clipboard toast needed)
 *   'copied'  — deep link written to clipboard (show "Link copied" to user)
 *   'error'   — clipboard write also failed (silent fail)
 */
export async function shareRace(raceId) {
  const deepLink = raceDeepLink(raceId);
  const shareUrl =
    'https://t.me/share/url' +
    '?url=' + encodeURIComponent(deepLink) +
    '&text=' + encodeURIComponent('Watch this LADA race');

  if (typeof WebApp?.openTelegramLink === 'function') {
    WebApp.openTelegramLink(shareUrl);
    return 'shared';
  }

  try {
    await navigator.clipboard.writeText(deepLink);
    return 'copied';
  } catch {
    return 'error';
  }
}
