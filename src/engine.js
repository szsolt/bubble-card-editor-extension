// The editor_code engine.
//
// Bubble Card stores each module (incl. its `editor_code` key) in a PRIVATE ESM
// map (`yamlKeysMap`) that is not reachable by reference from outside, and that
// stock repeatedly clears + repopulates from RAW (undecorated) modules during
// async init — fires no event on the cache/fallback paths, then freezes. So we
// do NOT fight over that map. Instead the engine has two jobs:
//
//   1. LOAD-TIME (one-time global side effects): collectModules() (see
//      sources.js) unions every reachable source — bubble-modules.yaml + the
//      localStorage caches — into {id → module}, then runs each module's
//      editor_code once. editor_code registers the module's custom selectors
//      (via defineSelector) and a schema decorator for its id (via
//      defineDecorator).
//   2. READ-TIME (pure, per-render): installSchemaIntercept() wraps stock's
//      bubble-card-editor._getProcessedSchema — the single chokepoint between
//      the map-read and <ha-form> — so the registered decorator transforms the
//      raw schema on its way to the form. Race-free: whatever raw object stock
//      wrote to its map is upgraded between read and render, every render.
import { bc } from './bc.js';
import { BubbleCardEditor } from './api.js';
import { RunGuard } from './guard.js';
import { collectModules } from './sources.js';
import { debug, warn, error } from './log.js';

// Runs each module's editor_code at most once per id (defining a custom element
// twice throws; re-running is wasted work). See RunGuard.
const guard = new RunGuard();

// Sources take their browser deps + log channel via an injected env, so its
// debug/warn lines land on bubble-card-editor's styled channel.
function sourcesEnv() {
  return {
    fetch: (...a) => fetch(...a),
    localStorage: window.localStorage,
    location: window.location,
    log: { debug, warn, error },
  };
}

function runEditorCodeFor(id, mod) {
  if (!guard.shouldRun(id, mod)) return false;
  try {
    const code =
      String(mod.editor_code) + `\n//# sourceURL=bubble-module-${id}.editor_code.js`;
    // eslint-disable-next-line no-new-func
    new Function('module_id', 'module', 'bc', code)(id, mod, bc);
    debug(`ran editor_code for module '${id}'`);
    return true;
  } catch (e) {
    error(`editor_code of module '${id}' failed:`, e);
    return false;
  }
}

let processing = false;

async function process() {
  if (processing) return;
  processing = true;
  try {
    const modules = await collectModules(sourcesEnv());
    const ids = Object.keys(modules);
    if (ids.length === 0) {
      warn('no module source reachable (yaml / bct-cache / store all empty)');
      return;
    }
    for (const id of ids) {
      // collectModules already stripped meta keys; runEditorCodeFor still skips
      // any module without editor_code, so this pass is safe over every id.
      runEditorCodeFor(id, modules[id]);
    }
  } finally {
    processing = false;
  }
}

// Wrap stock's bubble-card-editor._getProcessedSchema(key, originalSchema, config)
// — the one method every module's editor schema flows through on its way to
// <ha-form>. We apply the registered decorator to the raw schema, then call the
// original through (for stock's structuredClone + _updateAttributeSelectors).
//
// Couples to one stock internal method name. If a future stock version renames
// it, we warn once and the editor degrades to flat (functional, not broken).
async function installSchemaIntercept() {
  await customElements.whenDefined('bubble-card-editor');
  const proto = customElements.get('bubble-card-editor')?.prototype;
  if (!proto || typeof proto._getProcessedSchema !== 'function') {
    // Leave a breadcrumb: stock exposes no runtime version, so dump the
    // schema-ish method names that DO exist on the prototype. After a stock
    // update renames the hook, this shows what it became (e.g. a
    // `_getProcessedSchemaV2`) so re-binding is a one-line fix, not a hunt.
    const candidates = proto
      ? Object.getOwnPropertyNames(proto).filter((n) => /schema/i.test(n))
      : [];
    warn('stock bubble-card-editor._getProcessedSchema not found; ' +
         'custom editor decoration disabled (flat editor). Stock version may have changed. ' +
         `Schema-related methods present: ${candidates.length ? candidates.join(', ') : '(none)'}.`);
    return;
  }
  if (proto.__bceSchemaWrapped) return;        // idempotent (double resource load)
  proto.__bceSchemaWrapped = true;
  const orig = proto._getProcessedSchema;
  proto._getProcessedSchema = function (key, originalSchema, config) {
    const decorated = BubbleCardEditor.applyDecorator(key, originalSchema);
    return orig.call(this, key, decorated, config);
  };
  debug('schema intercept installed on bubble-card-editor._getProcessedSchema');
}

export async function startEngine() {
  await customElements.whenDefined('bubble-card');
  debug('bubble-card defined; editor support active');
  await process();                 // fetch + parse + run each editor_code once
  await installSchemaIntercept();  // wrap _getProcessedSchema for per-render decoration

  // A module installed / edited mid-session (Bubble Card fires this on
  // `document` whenever its registry changes, incl. the BCT websocket push):
  // re-collect and run any NEW module's editor_code so it registers its
  // selectors + decorator without a page reload. The once-per-id guard
  // (RunGuard) skips modules already registered, so this never re-runs — and
  // never re-defines — an existing module's custom element. No dispatch: the
  // read-side intercept is already live and picks up the new decorator on the
  // next form render. An edit that CHANGES an existing module's editor_code is
  // NOT re-run (the id already ran); that needs a reload — rare, and the edited
  // schema itself still flows through the existing decorator unchanged.
  document.addEventListener('yaml-modules-updated', () => { process(); });
}
