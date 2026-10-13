// Tests the source readers + union/dedup in isolation, with an injected fake
// env (no fetch/localStorage/location). The union precedence and per-source
// try-isolation are the easy-to-break pieces — exactly what to test.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  collectModules,
  readYamlModules,
  readBctCache,
  readStoreCatalog,
  MODULE_META_KEYS,
} from '../src/sources.js';

const mod = (extra = {}) => ({ editor_code: 'x', ...extra });

// --- fake env builder -------------------------------------------------------
function fakeEnv({ yamlByUrl = {}, store = {}, host = 'h' } = {}) {
  const calls = { fetched: [] };
  return {
    calls,
    fetch: async (url) => {
      calls.fetched.push(url);
      const bare = url.split('?')[0];
      if (bare in yamlByUrl) {
        const body = yamlByUrl[bare];
        if (body === null) return { ok: false, status: 404, text: async () => '' };
        return { ok: true, status: 200, text: async () => body };
      }
      return { ok: false, status: 404, text: async () => '' };
    },
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
    },
    location: { host },
    log: { debug() {}, warn() {}, error() {} },
  };
}

test('readYamlModules: first URL that 200s wins, meta keys stripped', async () => {
  const env = fakeEnv({
    yamlByUrl: {
      '/local/bubble/bubble-modules.yaml':
        'si:\n  editor_code: "x"\nmodules:\n  foo: 1\nlast_updated: "z"',
    },
  });
  const out = await readYamlModules(env);
  assert.deepEqual(Object.keys(out), ['si']);
});

test('readYamlModules: falls through to the community URL on 404', async () => {
  const env = fakeEnv({
    yamlByUrl: {
      '/local/bubble/bubble-modules.yaml': null,
      '/local/community/Bubble-Card/bubble-modules.yaml': 'si:\n  editor_code: "x"',
    },
  });
  const out = await readYamlModules(env);
  assert.deepEqual(Object.keys(out), ['si']);
  const attempted = env.calls.fetched.map((u) => u.split('?')[0]);
  assert.deepEqual(attempted, [
    '/local/bubble/bubble-modules.yaml',
    '/local/community/Bubble-Card/bubble-modules.yaml',
  ]);
});

test('readYamlModules: returns {} when nothing reachable (no throw)', async () => {
  const env = fakeEnv({});
  assert.deepEqual(await readYamlModules(env), {});
});

test('readBctCache: reads aggregatedModules under the host-scoped key', async () => {
  const env = fakeEnv({
    host: 'ha.example:8123',
    store: {
      'bubble-card-bct-cache-v1:ha.example:8123': JSON.stringify({
        aggregatedModules: { si: mod(), other: mod() },
      }),
    },
  });
  const out = await readBctCache(env);
  assert.deepEqual(Object.keys(out).sort(), ['other', 'si']);
});

test('readBctCache: v2 cache (Bubble Card 3.3+) unions files[*].modules, preferred over v1', async () => {
  const env = fakeEnv({
    host: 'h',
    store: {
      'bubble-card-bct-cache-v2:h': JSON.stringify({
        version: 2,
        files: { 'a.yaml': { modules: { si: mod() } }, 'b.yaml': { modules: { other: mod() } } },
      }),
      'bubble-card-bct-cache-v1:h': JSON.stringify({ aggregatedModules: { stale: mod() } }),
    },
  });
  assert.deepEqual(Object.keys(await readBctCache(env)).sort(), ['other', 'si']);
});

test('readBctCache: missing key → {} (no throw)', async () => {
  assert.deepEqual(await readBctCache(fakeEnv({})), {});
});

test('readBctCache: malformed JSON → {} (no throw)', async () => {
  const env = fakeEnv({ host: 'h', store: { 'bubble-card-bct-cache-v1:h': '{not json' } });
  assert.deepEqual(await readBctCache(env), {});
});

test('readStoreCatalog: reads .modules from bubble-card-module-store', async () => {
  const env = fakeEnv({
    store: { 'bubble-card-module-store': JSON.stringify({ modules: { si: mod() } }) },
  });
  assert.deepEqual(Object.keys(await readStoreCatalog(env)), ['si']);
});

test('collectModules: unions all sources, first id wins (YAML > bct > store)', async () => {
  const env = fakeEnv({
    yamlByUrl: { '/local/bubble/bubble-modules.yaml': 'si:\n  editor_code: "x"' },
    host: 'h',
    store: {
      'bubble-card-bct-cache-v1:h': JSON.stringify({
        aggregatedModules: { si: mod({ from: 'bct' }), bctOnly: mod() },
      }),
      'bubble-card-module-store': JSON.stringify({
        modules: { si: mod({ from: 'store' }), storeOnly: mod() },
      }),
    },
  });
  const out = await collectModules(env);
  assert.deepEqual(Object.keys(out).sort(), ['bctOnly', 'si', 'storeOnly']);
  // 'si' came from YAML — the later sources must NOT overwrite it.
  assert.equal('from' in out.si, false);
});

test('collectModules: one bad source does not sink the others', async () => {
  const env = fakeEnv({
    yamlByUrl: { '/local/bubble/bubble-modules.yaml': 'si:\n  editor_code: "x"' },
    host: 'h',
    store: { 'bubble-card-bct-cache-v1:h': 'CORRUPT', 'bubble-card-module-store': 'ALSO BAD' },
  });
  const out = await collectModules(env);
  assert.deepEqual(Object.keys(out), ['si']);
});

test('collectModules: returns {} when no source reachable', async () => {
  assert.deepEqual(await collectModules(fakeEnv({})), {});
});

test('MODULE_META_KEYS excludes the non-module top-level keys', () => {
  for (const k of ['modules', 'friendly_name', 'last_updated']) {
    assert.ok(MODULE_META_KEYS.has(k));
  }
});
