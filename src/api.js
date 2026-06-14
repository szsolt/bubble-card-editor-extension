// window.BubbleCardEditor — the author-facing framework API.
//
// A module author calls this from their editor_code (or any loaded script) to
// register custom config controls and build editor schema, without hand-rolling
// a LitElement. The framework also ships a library of base controls (see
// `selectors`) that authors reference by name or extend.
import { bc } from './bc.js';
import { selectorClassFromConfig } from './selectors/base.js';
import { JsSelector } from './selectors/js.js';
import { TagsSelector } from './selectors/tags.js';
import { registerObjectSelector } from './selectors/object.js';
import { warn, error } from './log.js';
// All three base controls are present: bce_js / bce_tags are plain selector
// classes in BASE_LIBRARY below; bce_object self-registers via
// registerObjectSelector(). Everything else here is already generic.

// Base control library, keyed by short name (the ha-selector-<name> suffix —
// note the bce_ prefix: a bare `object` would collide with HA's native
// ha-selector-object). bce_js / bce_tags are plain classes defined by the loop
// in registerBaseLibrary. bce_object self-registers (it also defines its
// ha-form-bce_group / ha-form-bce_cluster sub-forms), so it is NOT in this
// class-map — registerBaseLibrary calls registerObjectSelector() separately and
// folds the returned tag's class into `selectors` below.
const BASE_LIBRARY = {
  bce_js: JsSelector,
  bce_tags: TagsSelector,
};

// Live registry of selector classes by name — base library plus anything an
// author defines. Authors read this to subclass an existing control
// (`class Mine extends BubbleCardEditor.selectors.bce_js {}`).
const selectors = { ...BASE_LIBRARY };

function tagFor(name) {
  return `ha-selector-${name}`;
}

// Resolve an { extends: '<baseName>', ...config } selector definition into a
// subclass: subclass selectors[baseName] and apply the config's own keys (minus
// `extends`) as own-instance properties — so e.g. `evaluate` lands where the
// base reads `this.evaluate`. Returns null if the base is unknown (caller warns
// + skips, rather than defining a broken element). Pure (no DOM) — unit-tested.
export function resolveExtends(selectors, config) {
  if (!config || typeof config.extends !== 'string') return null;
  const base = selectors[config.extends];
  if (!base) return null;
  const props = {};
  for (const k of Object.keys(config)) {
    if (k !== 'extends') props[k] = config[k];
  }
  return class ExtendedSelector extends base {
    constructor(...args) {
      super(...args);
      Object.assign(this, props);
    }
  };
}

// Define ha-selector-<name>. `impl` is either a config object
// {render, parse, serialize, styles} (wrapped into a LitElement), an
// { extends: '<baseName>', ...config } definition (subclass a registered base
// and bake in config props), or a custom-element class (LitElement subclass or
// plain HTMLElement). No-op with a warning if the tag is already defined —
// custom elements cannot be redefined.
function defineSelector(name, impl) {
  const tag = tagFor(name);
  let klass;
  if (impl && typeof impl === 'object' && typeof impl.extends === 'string') {
    klass = resolveExtends(selectors, impl);
    if (!klass) {
      warn(`'${name}' extends unknown base '${impl.extends}'; skipped (define or override '${impl.extends}' first).`);
      return;
    }
  } else {
    klass = typeof impl === 'function' ? impl : selectorClassFromConfig(impl);
  }
  selectors[name] = klass;
  if (customElements.get(tag)) {
    warn(`'${name}' is already defined; keeping the existing element (custom elements cannot be redefined). Subclass BubbleCardEditor.selectors.${name} and define under a new name to vary it.`);
    return;
  }
  customElements.define(tag, klass);
}

// Replace what `name` resolves to for code that reads the `selectors` registry
// (i.e. subclassers). IMPORTANT: a custom element, once defined, cannot be
// swapped — so override only takes effect for the live element if it runs
// BEFORE the element is defined. After definition it updates `selectors` only.
// The reliable pattern is: override (or defineSelector) the variant first, then
// let the schema reference that name.
function override(name, impl) {
  const klass = typeof impl === 'function' ? impl : selectorClassFromConfig(impl);
  selectors[name] = klass;
  const tag = tagFor(name);
  if (customElements.get(tag)) {
    warn(`'${name}' is already a defined element; override updated the registry only — the live element is unchanged (custom elements cannot be redefined). Override before first define to replace the element.`);
    return;
  }
  customElements.define(tag, klass);
}

// Define every base-library element. Idempotent (guarded by customElements.get),
// so loading the resource twice is harmless.
function registerBaseLibrary() {
  for (const [name, klass] of Object.entries(BASE_LIBRARY)) {
    const tag = tagFor(name);
    if (!customElements.get(tag)) customElements.define(tag, klass);
  }
  // bce_object self-registers its element + ha-form-bce_group/cluster sub-forms
  // and returns its element tag. Fold the registered class into `selectors` so
  // defineSelector({extends:'bce_object'}) and BubbleCardEditor.selectors.bce_object
  // resolve.
  const objTag = registerObjectSelector();
  const objClass = objTag && customElements.get(objTag);
  if (objClass) selectors.bce_object = objClass;
}

// Schema decorators — a registry of moduleId -> (rawSchema) => decoratedSchema.
// A module's editor_code registers one decorator for its id; bce applies it
// inside the _getProcessedSchema wrapper (see engine.js), per render, on a fresh
// clone of the module's raw editor schema. This is the read-side replacement for
// the old dispatch-into-yamlKeysMap mechanism: the decorator transforms the
// schema between stock's map-read and <ha-form>, so the decoration cannot be
// clobbered by stock's eventless registry rebuilds.
const decorators = {};

// Per-render decoration cache. The decorator is a pure transform of the raw
// schema (it reads the schema shape, never live config/data — visible_if etc.
// are emitted as strings the object selector evaluates at render time), so the
// decorated output is fully determined by the raw schema array. ha-form
// re-renders on every keystroke, so without a cache we'd structuredClone +
// re-decorate the whole (large) schema each time.
//
// Keyed on the raw schema array by identity: stock reads `module.editor` from
// its registry and passes that SAME array reference to _getProcessedSchema on
// every steady-state render, so the WeakMap hits. When stock rebuilds its
// registry with a fresh module object, `.editor` is a new array → cache miss →
// re-decorate once (correct: a genuinely new schema). The WeakMap lets the old
// array + its cached output be GC'd with the stale module object. Keyed by
// moduleId within the array entry so two modules sharing one schema array (rare)
// don't collide.
const _decoratedCache = new WeakMap();

// Register a schema decorator for a module id. The function receives the raw
// editor schema array and returns the decorated array. No-op with a warning if
// `fn` is not a function. Last registration per id wins. (Each module decorates
// its own schema — decorators do not compose; modules that want to share custom
// controls register selectors via defineSelector, not decorators.)
function defineDecorator(moduleId, fn) {
  if (typeof fn !== 'function') {
    warn(`defineDecorator('${moduleId}', …) needs a function; ignored.`);
    return;
  }
  decorators[moduleId] = fn;
}

// Apply the decorator for moduleId to rawSchema, returning the decorated schema.
// No decorator registered -> return rawSchema unchanged (pass-through for modules
// without editor_code or without a registered decorator). Decorator throws ->
// log + return rawSchema (graceful degradation to the flat editor). The decorator
// is handed a structuredClone so it may mutate freely without touching stock's
// stored object. Result is memoized per (rawSchema array, moduleId) — see
// _decoratedCache.
function applyDecorator(moduleId, rawSchema) {
  const fn = decorators[moduleId];
  if (!fn) return rawSchema;
  // Only object keys can key a WeakMap; a non-object schema can't be cached but
  // also can't be meaningfully decorated, so just run the decorator on it.
  const cacheable = rawSchema !== null && typeof rawSchema === 'object';
  if (cacheable) {
    const byMod = _decoratedCache.get(rawSchema);
    if (byMod && byMod.has(moduleId)) return byMod.get(moduleId);
  }
  try {
    const out = fn(structuredClone(rawSchema));
    if (cacheable) {
      let byMod = _decoratedCache.get(rawSchema);
      if (!byMod) { byMod = new Map(); _decoratedCache.set(rawSchema, byMod); }
      byMod.set(moduleId, out);
    }
    return out;
  } catch (e) {
    error(`decorator for module '${moduleId}' failed; using raw schema`, e);
    return rawSchema;
  }
}

// Schema helpers — an author mutates module.editor with these instead of writing
// repetitive YAML. Shapes mirror Bubble Card's editor schema entries.
const schema = {
  // A collapsible group of fields (Bubble Card / HA `expandable`).
  group(title, fields, opts = {}) {
    return { type: 'expandable', title, schema: fields, ...opts };
  },
  // Build N entries from a template. `countOrItems` is a count or an array of
  // items; `template(item, index)` returns one schema entry.
  repeat(template, countOrItems) {
    const items =
      typeof countOrItems === 'number'
        ? Array.from({ length: countOrItems }, (_, i) => i)
        : countOrItems;
    return items.map((it, i) => template(it, i));
  },
  // Include `fields` only when `cond` is truthy (spread into a schema array).
  when(cond, fields) {
    return cond ? fields : [];
  },
};

export const BubbleCardEditor = {
  apiVersion: 1,
  bc,
  defineSelector,
  defineDecorator,
  applyDecorator,
  override,
  selectors,
  schema,
};

export { registerBaseLibrary };
