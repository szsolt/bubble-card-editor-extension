// Console logging — one styled banner on load (matching the other Lovelace
// resources' name+version chip style), and a quiet `debug` channel for the
// per-step engine messages (off unless window.BubbleCardEditorDebug is truthy).
const VERSION = typeof __BCE_VERSION__ !== 'undefined' ? __BCE_VERSION__ : 'dev';

export function banner() {
  // Name badge + version chip, same visual language as button-card/mushroom/etc.
  console.info(
    `%c BUBBLE-CARD-EDITOR %c v${VERSION} `,
    'color:#fff;background:#3949ab;font-weight:700;border-radius:4px 0 0 4px;padding:2px 6px',
    'color:#3949ab;background:#e8eaf6;font-weight:700;border-radius:0 4px 4px 0;padding:2px 6px',
  );
}

export function debug(...args) {
  if (window.BubbleCardEditorDebug) console.info('[bubble-card-editor]', ...args);
}

export function warn(...args) {
  console.warn('[bubble-card-editor]', ...args);
}

export function error(...args) {
  console.error('[bubble-card-editor]', ...args);
}
