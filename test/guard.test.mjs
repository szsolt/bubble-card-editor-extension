// Focused test of RunGuard's once-per-id guard — editor_code must run exactly
// once per module id (defining its custom element twice throws; re-running is
// wasted work). bce decorates on the read side now, so there is no clobber to
// recover from — a later pass for an already-run id is correctly skipped.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunGuard } from '../src/guard.js';

const mod = (editor_code = 'x') => ({ editor_code });

test('runs once for a fresh id', () => {
  const g = new RunGuard();
  assert.equal(g.shouldRun('si', mod()), true);
});

test('same id never runs twice — even with a fresh object', () => {
  const g = new RunGuard();
  assert.equal(g.shouldRun('si', mod()), true);
  // A later pass hands a fresh object for the same id (stock rebuilt its
  // registry). With read-side decoration there is nothing to re-apply, so the
  // id is skipped — no double-define of its custom element.
  assert.equal(g.shouldRun('si', mod()), false);
});

test('distinct ids run independently', () => {
  const g = new RunGuard();
  assert.equal(g.shouldRun('a', mod()), true);
  assert.equal(g.shouldRun('b', mod()), true);
});

test('module without editor_code never runs', () => {
  const g = new RunGuard();
  assert.equal(g.shouldRun('si', { name: 'x' }), false);
  assert.equal(g.shouldRun('si', null), false);
  // and not having run, the id stays eligible for a real editor_code later
  assert.equal(g.shouldRun('si', mod()), true);
});
