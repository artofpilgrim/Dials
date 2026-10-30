import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, sanitizeParams, sanitizeZones, updateParams, clean, readPresets, encodeHashState, decodeHashState } from '../../src/state.js';

test('range changes preserve zone proportions and survive sharing', () => {
  let p = sanitizeParams({ colorBandEnabled: true });
  p = updateParams(p, { min: 100, max: 200 });
  assert.deepEqual(p.colorBandZones.map(z => z.endValue), [150, 180, 200]);
  assert.deepEqual([p.colorBandStart, p.colorBandEnd], [100, 200]);
  const restored = sanitizeParams(decodeHashState(encodeHashState(p, DEFAULTS), DEFAULTS));
  assert.deepEqual(restored, p);
});

test('defaults and fallback zones are independent and immutable', () => {
  const a = sanitizeParams({ colorBandZones: null });
  const b = sanitizeParams({ colorBandZones: [] });
  a.colorBandZones[1].endValue = 95;
  assert.equal(b.colorBandZones[1].endValue, 80);
  assert.equal(DEFAULTS.colorBandZones[1].endValue, 80);
  assert.throws(() => { DEFAULTS.colorBandZones[1].endValue = 90; }, TypeError);
});

test('zone normalization stays ordered, bounded and idempotent', () => {
  for (const stops of [[100, 100, 100], [0, -5, 90], [200, 400, 300], [5, NaN, 4], []]) {
    const zones = sanitizeZones(stops.map(endValue => ({ color: '#abcdef', endValue })), 0, 100);
    let previous = 0;
    for (const zone of zones) { assert.ok(zone.endValue > previous && zone.endValue <= 100); previous = zone.endValue; }
    assert.equal(previous, 100);
    assert.deepEqual(sanitizeZones(zones, 0, 100), zones);
  }
});

test('legacy links and presets use the same subdivision migration', () => {
  const legacy = { min: 0, max: 100, majorStep: 10, minorStep: 5 };
  const hash = Buffer.from(JSON.stringify(legacy)).toString('base64');
  assert.equal(clean(sanitizeParams(decodeHashState(hash, DEFAULTS))).minorStep, 5);
  assert.equal(readPresets(JSON.stringify({ saved: legacy })).saved.subdivisions, 1);
});

test('malformed storage and unknown fields are rejected', () => {
  for (const raw of ['null', '[]', 'true', '"text"', '{', null]) assert.deepEqual(readPresets(raw), {});
  assert.deepEqual(Object.keys(readPresets('{"bad":null,"good":{"width":512}}')), ['good']);
  assert.equal(sanitizeParams({ randomField: 'ignored' }).randomField, undefined);
});

test('finite endpoints cannot overflow geometry; semi starts at 180 degrees', () => {
  for (const range of [{ min: -1e308, max: 1e308 }, { min: 1e308, max: 0 }, { min: 1.7976931348623157e308, max: 0 }]) {
    const p = sanitizeParams(range);
    assert.ok(Number.isFinite(p.max - p.min) && p.max > p.min);
  }
  assert.equal(clean(sanitizeParams({ shape: 'semi', startAngle: 0 })).startAngle, 180);
});

test('text limits and all state fields round-trip consistently', () => {
  const p = sanitizeParams({ centerText: 'x'.repeat(300), numberSuffix: 'y'.repeat(40), customLabels: 'z'.repeat(1200) });
  assert.equal(p.centerText.length, 256);
  assert.equal(p.numberSuffix.length, 32);
  assert.deepEqual(sanitizeParams(decodeHashState(encodeHashState(p, DEFAULTS), DEFAULTS)), p);
});
