// Module-source discovery.
//
// Bubble Card delivers module objects (each carrying `editor_code`) through
// several sources, and which one holds the installed set depends on the setup:
// the served module YAML always exists; some setups also keep an aggregated set
// in localStorage and use the YAML only as a fallback. So the engine UNIONs
// every source it can reach, keyed by module id, rather than assuming one.
//
// Reachable sources (priority order — first id wins):
//   1. bubble-modules.yaml (then the community path) — fetch + js-yaml parse.
//   2. bubble-card-bct-cache-v1:${host}.aggregatedModules — localStorage cache.
//   3. bubble-card-module-store.modules — localStorage (community store catalog).
//
// NOT reachable: sensor.bubble_card_modules (legacy text entity) needs a hass
// object, which a bare resource does not have. Documented gap; a hass-backed
// change still reaches us via the yaml-modules-updated event the engine listens
// for.
//
// Browser deps (fetch / localStorage / location / log) are taken from an `env`
// argument so the union + isolation logic is testable without a DOM.
import jsyaml from 'js-yaml';

// Top-level keys in the YAML / aggregated maps that are NOT modules.
export const MODULE_META_KEYS = new Set(['modules', 'friendly_name', 'last_updated']);

// Order matters: first source to supply an id keeps it.
const YAML_URLS = [
  '/local/bubble/bubble-modules.yaml',
  '/local/community/Bubble-Card/bubble-modules.yaml',
];
const BCT_CACHE_PREFIX = 'bubble-card-bct-cache-v1:';
const STORE_KEY = 'bubble-card-module-store';

// Default env wires the real browser globals; tests pass a fake.
function defaultEnv() {
  return {
    fetch: (...a) => fetch(...a),
    localStorage: window.localStorage,
    location: window.location,
    // log is injected by the engine so messages share the styled channel.
    log: { debug() {}, warn() {}, error() {} },
  };
}

function stripMeta(obj) {
  const out = {};
  for (const id of Object.keys(obj)) {
    if (MODULE_META_KEYS.has(id)) continue;
    const mod = obj[id];
    if (mod && typeof mod === 'object') out[id] = mod;
  }
  return out;
}

// 1. The pasted/served module YAML. First URL that 200s + parses to an object
//    wins; cache-busted; each attempt isolated.
export async function readYamlModules(env) {
  for (const url of YAML_URLS) {
    try {
      const res = await env.fetch(`${url}?v=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) continue;
      const text = await res.text();
      const parsed = jsyaml.load(text);
      if (parsed && typeof parsed === 'object') {
        const mods = stripMeta(parsed);
        env.log.debug(`sources: yaml ${url} → ${Object.keys(mods).length} module(s)`);
        return mods;
      }
    } catch (e) {
      env.log.warn(`sources: yaml fetch/parse failed for ${url}:`, e);
    }
  }
  return {};
}

// 2. An aggregated module cache kept in localStorage (host-scoped key).
export async function readBctCache(env) {
  try {
    const host = env.location?.host || 'default';
    const raw = env.localStorage.getItem(`${BCT_CACHE_PREFIX}${host}`);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    const agg = obj?.aggregatedModules;
    if (!agg || typeof agg !== 'object') return {};
    const mods = stripMeta(agg);
    env.log.debug(`sources: bct-cache → ${Object.keys(mods).length} module(s)`);
    return mods;
  } catch (e) {
    env.log.warn('sources: bct-cache read failed:', e);
    return {};
  }
}

// 3. The community store catalog.
export async function readStoreCatalog(env) {
  try {
    const raw = env.localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    const cat = obj?.modules;
    if (!cat || typeof cat !== 'object') return {};
    const mods = stripMeta(cat);
    env.log.debug(`sources: store-catalog → ${Object.keys(mods).length} module(s)`);
    return mods;
  } catch (e) {
    env.log.warn('sources: store-catalog read failed:', e);
    return {};
  }
}

// Union every reachable source, first id wins. Each reader is self-isolating
// (returns {} on failure), so one dead source never sinks the pass.
export async function collectModules(env = defaultEnv()) {
  const readers = [readYamlModules, readBctCache, readStoreCatalog];
  const out = {};
  for (const read of readers) {
    const mods = await read(env);
    for (const id of Object.keys(mods)) {
      if (!(id in out)) out[id] = mods[id]; // first source wins
    }
  }
  env.log.debug(`sources: collected ${Object.keys(out).length} module(s) total`);
  return out;
}
