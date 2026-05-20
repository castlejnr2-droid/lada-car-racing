/**
 * Telegram Mini App SDK helpers.
 *
 * Wraps WebApp.MainButton, BackButton, and HapticFeedback so the rest of
 * the app doesn't need to remember to call show/hide pairs, and so haptics
 * degrade gracefully when running outside Telegram (e.g. in dev).
 */
import WebApp from '@twa-dev/sdk';

export const tg = WebApp;

/**
 * Set up Telegram's bottom MainButton and return a cleanup function.
 * Use inside useEffect.
 */
export function useMainButton(text, onClick, opts = {}) {
  // (intentionally a plain function — App uses it from useEffect bodies)
  const { color, textColor, enabled = true, visible = true } = opts;
  if (color)     WebApp.MainButton.setParams({ color });
  if (textColor) WebApp.MainButton.setParams({ text_color: textColor });
  WebApp.MainButton.setText(text);
  if (enabled) WebApp.MainButton.enable(); else WebApp.MainButton.disable();
  WebApp.MainButton.onClick(onClick);
  if (visible) WebApp.MainButton.show(); else WebApp.MainButton.hide();
  return () => {
    WebApp.MainButton.offClick(onClick);
    WebApp.MainButton.hide();
  };
}

/** Set up the top-left BackButton; returns cleanup. */
export function useBackButton(onClick) {
  WebApp.BackButton.onClick(onClick);
  WebApp.BackButton.show();
  return () => {
    WebApp.BackButton.offClick(onClick);
    WebApp.BackButton.hide();
  };
}

/**
 * Haptic feedback — wraps WebApp.HapticFeedback so callers can do
 *   haptic.success(), haptic.error(), haptic.tap(), haptic.heavy()
 * without remembering the verbose API.
 */
export const haptic = {
  tap:     () => tryHaptic(() => WebApp.HapticFeedback.impactOccurred('light')),
  medium:  () => tryHaptic(() => WebApp.HapticFeedback.impactOccurred('medium')),
  heavy:   () => tryHaptic(() => WebApp.HapticFeedback.impactOccurred('heavy')),
  success: () => tryHaptic(() => WebApp.HapticFeedback.notificationOccurred('success')),
  error:   () => tryHaptic(() => WebApp.HapticFeedback.notificationOccurred('error')),
  warn:    () => tryHaptic(() => WebApp.HapticFeedback.notificationOccurred('warning')),
  select:  () => tryHaptic(() => WebApp.HapticFeedback.selectionChanged()),
};

function tryHaptic(fn) { try { fn(); } catch {} }

/** The Telegram user object (or null if not running inside Telegram). */
export function tgUser() {
  return WebApp.initDataUnsafe?.user || null;
}

/** Raw initData string — pass to backend to verify. */
export function initData() {
  return WebApp.initData || '';
}
