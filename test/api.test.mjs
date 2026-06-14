// DOM-free test of defineSelector's `extends` resolution — pure registry logic
// (subclass the named base, apply config props, reject unknown base). The
// element-defining half of defineSelector needs a DOM and is verified live.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveExtends, BubbleCardEditor } from '../src/api.js';

const { defineDecorator, applyDecorator } = BubbleCardEditor;

// A stand-in base "class" — resolveExtends only needs something `extends`-able.
class Base {
  constructor() { this.kind = 'base'; }
}

test('subclasses the named base from the registry', () => {
  const selectors = { bce_js: Base };
  const Klass = resolveExtends(selectors, { extends: 'bce_js' });
  const inst = new Klass();
  assert.ok(inst instanceof Base);
});

test('applies config props (minus extends) onto the instance', () => {
  const selectors = { bce_js: Base };
  const fn = () => ({ result: 'x' });
  const Klass = resolveExtends(selectors, { extends: 'bce_js', evaluate: fn });
  const inst = new Klass();
  assert.equal(inst.evaluate, fn);
});

test('does not leak the extends key onto the instance', () => {
  const selectors = { bce_js: Base };
  const Klass = resolveExtends(selectors, { extends: 'bce_js', evaluate: () => {} });
  const inst = new Klass();
  assert.equal('extends' in inst, false);
});

test('unknown base returns null (caller warns + skips)', () => {
  const selectors = { bce_js: Base };
  const Klass = resolveExtends(selectors, { extends: 'nope' });
  assert.equal(Klass, null);
});

test('config props win over base instance props of the same name', () => {
  class WithDefault { constructor() { this.evaluate = 'default'; } }
  const selectors = { bce_js: WithDefault };
  const Klass = resolveExtends(selectors, { extends: 'bce_js', evaluate: 'override' });
  const inst = new Klass();
  assert.equal(inst.evaluate, 'override');
});

test('returns null on a config with no extends key (defensive)', () => {
  const selectors = { bce_js: Base };
  assert.equal(resolveExtends(selectors, {}), null);
  assert.equal(resolveExtends(selectors, null), null);
});

// ── defineDecorator / applyDecorator ──
// The read-side decoration registry: a module registers one decorator for its id;
// bce applies it (on a clone) inside the _getProcessedSchema wrapper, per render.

test('applyDecorator returns input unchanged when no decorator registered', () => {
  const raw = [{ name: 'x' }];
  assert.equal(applyDecorator('unregistered_module', raw), raw);
});

test('applyDecorator returns the decorator output when one is registered', () => {
  const out = [{ name: 'decorated' }];
  defineDecorator('mod_returns', () => out);
  assert.equal(applyDecorator('mod_returns', [{ name: 'raw' }]), out);
});

test('applyDecorator hands the decorator a CLONE — mutating it must not touch the caller object', () => {
  const raw = [{ name: 'x', nested: { v: 1 } }];
  defineDecorator('mod_mutates', (schema) => { schema[0].nested.v = 999; return schema; });
  applyDecorator('mod_mutates', raw);
  assert.equal(raw[0].nested.v, 1); // original untouched
});

test('applyDecorator returns the RAW schema (not throw) when the decorator throws', () => {
  const raw = [{ name: 'x' }];
  defineDecorator('mod_throws', () => { throw new Error('boom'); });
  assert.equal(applyDecorator('mod_throws', raw), raw);
});

test('defineDecorator ignores a non-function (no registration, falls through to raw)', () => {
  const raw = [{ name: 'x' }];
  defineDecorator('mod_bad', 'not a function');
  assert.equal(applyDecorator('mod_bad', raw), raw);
});

test('defineDecorator: last registration per id wins', () => {
  defineDecorator('mod_last', () => ['first']);
  defineDecorator('mod_last', () => ['second']);
  assert.deepEqual(applyDecorator('mod_last', []), ['second']);
});

test('applyDecorator memoizes per (rawSchema, moduleId): decorator runs once for a stable array', () => {
  let calls = 0;
  defineDecorator('mod_memo', (s) => { calls++; return s; });
  const raw = [{ name: 'x' }];
  const first = applyDecorator('mod_memo', raw);
  const second = applyDecorator('mod_memo', raw);
  assert.equal(calls, 1);          // second render hit the cache
  assert.equal(first, second);     // same decorated reference returned
});

test('applyDecorator: a fresh schema array (stock rebuilt its registry) re-runs the decorator', () => {
  let calls = 0;
  defineDecorator('mod_rebuild', (s) => { calls++; return s; });
  applyDecorator('mod_rebuild', [{ name: 'x' }]);
  applyDecorator('mod_rebuild', [{ name: 'x' }]); // new array reference
  assert.equal(calls, 2);
});

test('applyDecorator: two modules sharing one schema array cache independently', () => {
  defineDecorator('mod_share_a', () => ['a']);
  defineDecorator('mod_share_b', () => ['b']);
  const raw = [{ name: 'x' }];
  assert.deepEqual(applyDecorator('mod_share_a', raw), ['a']);
  assert.deepEqual(applyDecorator('mod_share_b', raw), ['b']);
});

test('applyDecorator: non-object schema is not cached but still decorated', () => {
  defineDecorator('mod_scalar', (s) => (s == null ? 'decorated' : s));
  assert.equal(applyDecorator('mod_scalar', null), 'decorated');
});
