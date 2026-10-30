import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTickValues, tickCount, labelPrecision, fmtNum, MAX_TICKS } from '../../src/ticks.js';
import { pngDimensions } from '../../src/exports.js';
import { fontFaceFor } from '../../src/fonts.js';

test('large steps never generate a tick beyond max', () => {
  for (const step of [1e6, 1e9]) assert.deepEqual(buildTickValues(0, step, step), [0, step]);
  assert.deepEqual(buildTickValues(3, 23, 10), [3, 13, 23]);
  assert.deepEqual(buildTickValues(0, 25, 10), [0, 10, 20]);
});

test('decimal ticks include the endpoint without exceeding the cap', () => {
  assert.equal(buildTickValues(0, .3, .1).at(-1), .3);
  assert.equal(buildTickValues(0, MAX_TICKS - 1, 1).length, MAX_TICKS);
  assert.deepEqual(buildTickValues(0, MAX_TICKS, 1), []);
  assert.ok(tickCount(0, MAX_TICKS, 1) > MAX_TICKS);
  for (const args of [[0, 1, 0], [0, Infinity, 1], [1, 1, 1]]) assert.deepEqual(buildTickValues(...args), []);
});

test('fine labels preserve precision without negative zero', () => {
  const digits = labelPrecision(0, .001);
  assert.deepEqual([0, .001, .002, .003, .004, .005].map(v => fmtNum(v, digits)), ['0', '0.001', '0.002', '0.003', '0.004', '0.005']);
  assert.equal(fmtNum(-1.1e-16, labelPrecision(-.9, .3)), '0');
  assert.equal(fmtNum(.125, labelPrecision(0, .125)), '0.125');
  assert.equal(labelPrecision(.00001, 1), 5);
});

test('PNG budget rejects huge allocations before creating a canvas', () => {
  assert.throws(() => pngDimensions({ width: 8192, height: 8192, pngScale: 4 }), /megapixels/);
  assert.deepEqual(pngDimensions({ width: 2048, height: 2048, pngScale: 2 }), { width: 4096, height: 4096 });
});

test('export faces match browser CSS weight selection', () => {
  const plex = '"IBM Plex Mono", monospace';
  assert.equal(fontFaceFor(plex, 450).weight, 500);
  assert.equal(fontFaceFor(plex, 650).weight, 700);
  assert.equal(fontFaceFor(plex, 275).weight, 200);
  assert.equal(fontFaceFor('"Space Mono", monospace', 500).weight, 400);
});
