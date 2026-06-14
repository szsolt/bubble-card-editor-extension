// bubble-card-editor — an editor-extension framework for Bubble Card.
//
// Loaded as a Lovelace resource alongside Bubble Card. It:
//   1. exposes window.BubbleCardEditor (defineSelector / override / selectors /
//      schema / raw bc lit primitives) for module authors, and
//   2. runs each Bubble Card module's editor_code on unmodified Bubble Card,
//      so a module's custom editor controls and dynamic schema work without a
//      forked Bubble Card.
//
// lit is bundled (HA does not expose its own to resources). Custom selectors are
// self-contained web components rendered with this bundled lit; HA wires them
// via plain props + value-changed, so no lit value crosses runtimes.
import { BubbleCardEditor, registerBaseLibrary } from './api.js';
import { startEngine } from './engine.js';
import { banner, debug, error } from './log.js';

// Idempotent: if the resource is loaded twice (e.g. HACS + a manual entry), the
// first load owns the global and the engine; later loads are no-ops.
if (window.BubbleCardEditor && window.BubbleCardEditor.__started) {
  debug('already loaded; skipping re-init');
} else {
  BubbleCardEditor.__started = true;
  window.BubbleCardEditor = BubbleCardEditor;

  registerBaseLibrary();
  startEngine().catch((e) => error('init failed', e));

  banner();
}
