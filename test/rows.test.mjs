import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowsOf } from '../src/selectors/object.js';

const fields = { state: {}, value: {} };

test('rowsOf: YAML dict map → rows', () => {
  assert.deepEqual(rowsOf({ heating: 'mdi:fire', '*': 'mdi:thermostat' }, fields), [
    { state: 'heating', value: 'mdi:fire' },
    { state: '*', value: 'mdi:thermostat' },
  ]);
});

test('rowsOf: [[from, value]] pairs → rows; row objects untouched', () => {
  const f = { from: {}, value: {} };
  assert.deepEqual(rowsOf([[0, 'a'], { from: 60, value: 'b' }], f), [
    { from: 0, value: 'a' },
    { from: 60, value: 'b' },
  ]);
});

test('rowsOf: empty / scalar → []', () => {
  assert.deepEqual(rowsOf(undefined, fields), []);
  assert.deepEqual(rowsOf('x', fields), []);
});
