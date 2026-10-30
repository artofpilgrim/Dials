import { FONT_FAMILIES } from './fonts.js';

// ---- Initial params ----
export const DEFAULTS = {
  shape: 'semi',            // straight | semi | circle | arc
  width: 600,
  height: 600,
  min: 0,
  max: 100,
  majorStep: 10,
  subdivisions: 4,          // minor ticks between adjacent majors
  reverse: false,           // swap min/max direction
  rim: true,
  rimThickness: 2,
  majorLen: 18,
  minorLen: 9,
  majorWeight: 2,
  minorWeight: 1,
  tickCornerRadius: 0,      // 0 = square corners, 100 = fully rounded pill
  tickRoundBoth: false,     // when true, round the rim-side end too (pill)
  showNumbers: true,
  numberSize: 18,
  numberOffset: 8,
  numberWeight: 400,
  numberSuffix: '',
  customLabels: '',
  centerText: '',
  centerTextSize: 28,
  centerTextWeight: 500,
  centerTextOffset: 0,      // px; negative = above pivot, positive = below
  centerDot: false,
  centerDotSize: 8,
  tickColor: '#111111',
  bg: '#ffffff',
  pngScale: 2,              // PNG export resolution multiplier
  pngTransparent: false,    // force alpha-transparent PNG regardless of bg
  fontFamily: 'Helvetica, Arial, sans-serif',
  outlineOnExport: false,
  // Colour band (zone indicator)
  colorBandEnabled: false,
  colorBandThickness: 10,
  colorBandPosition: 'outer',     // 'inner' | 'outer' (relative to rim)
  colorBandStart: 0,              // band start value (defaults to dial min)
  colorBandEnd: 100,              // band end value (defaults to dial max)
  colorBandZones: [
    { color: '#3a9d2a', endValue: 50 },   // start = min, end = 50
    { color: '#e4c41a', endValue: 80 },
    { color: '#d63a3a', endValue: 100 },  // last zone ends at max
  ],
  // arc-specific
  startAngle: 180,
  sweepAngle: 180,
  tickDirection: 'inward',  // inward | outward
  numberPlacement: 'inside',// inside | outside
  invert: false,            // white on black
  // straight-specific
  orientation: 'horizontal',
  tickSide: 'below',        // below | above | both
};

DEFAULTS.colorBandZones.forEach(Object.freeze);
Object.freeze(DEFAULTS.colorBandZones);
Object.freeze(DEFAULTS);

export function clean(p) {
  const out = { ...p };
  if (p.shape === 'circle') { out.startAngle = -90; out.sweepAngle = 360; }
  if (p.shape === 'semi')   { out.startAngle = 180; out.sweepAngle = 180; }
  if (p.invert) {
    out.tickColor = '#ffffff';
    out.bg = p.bg === 'transparent' ? 'transparent' : '#000000';
  }

  // Derive the minor step from subdivisions (minor ticks between adjacent majors).
  out.minorStep = p.subdivisions > 0 ? out.majorStep / (p.subdivisions + 1) : 0;
  return out;
}

// Clamp every numeric, enum, boolean, and string field to the same bounds
// the UI controls enforce, so values arriving from a URL hash or preset
// can't produce states the controls cannot represent. Non-finite numbers
// and unrecognised enums fall back to DEFAULTS.
export function sanitizeParams(p) {
  const input = p && typeof p === 'object' && !Array.isArray(p) ? p : {};
  const out = Object.fromEntries(Object.keys(DEFAULTS).map(key => [key, input[key] ?? DEFAULTS[key]]));
  if (input.subdivisions === undefined && input.minorStep !== undefined) {
    out.subdivisions = input.minorStep > 0 && out.majorStep > 0
      ? Math.max(0, Math.round(out.majorStep / input.minorStep) - 1) : 0;
  }

  // Numeric clamps mirror the UI sliders / number fields.
  const clampN = (key, lo, hi, integer = false) => {
    let n = Number(out[key]);
    if (!Number.isFinite(n)) n = DEFAULTS[key];
    if (integer) n = Math.round(n);
    out[key] = Math.min(hi, Math.max(lo, n));
  };
  clampN('width', 80, 8192, true);
  clampN('height', 80, 8192, true);
  // Keep min/max flexible, while ensuring a finite, non-empty range below.
  if (!Number.isFinite(Number(out.min))) out.min = DEFAULTS.min;
  else out.min = Number(out.min);
  if (!Number.isFinite(Number(out.max))) out.max = DEFAULTS.max;
  else out.max = Number(out.max);
  clampN('majorStep', 0.0001, 1e9);
  // A finite endpoint alone does not guarantee a finite or representable span.
  if (!Number.isFinite(out.max - out.min)) {
    out.min = DEFAULTS.min;
    out.max = DEFAULTS.max;
  }
  if (out.max <= out.min) {
    out.max = out.min + Math.max(out.majorStep, 1, Math.abs(out.min) * Number.EPSILON * 4);
  }
  if (!Number.isFinite(out.max) || out.max <= out.min) {
    out.min = DEFAULTS.min;
    out.max = DEFAULTS.max;
  }
  clampN('subdivisions', 0, 100, true);
  clampN('rimThickness', 0.5, 12);
  clampN('majorLen', 2, 60);
  clampN('minorLen', 1, 40);
  clampN('majorWeight', 0.5, 8);
  clampN('minorWeight', 0.25, 5);
  clampN('tickCornerRadius', 0, 100);
  clampN('numberSize', 6, 48);
  clampN('numberOffset', 0, 40);
  clampN('numberWeight', 100, 900, true);
  clampN('centerTextSize', 8, 96);
  clampN('centerTextWeight', 100, 900, true);
  clampN('centerTextOffset', -300, 300);
  clampN('centerDotSize', 1, 80);
  clampN('startAngle', -180, 360);
  clampN('sweepAngle', 30, 360);
  clampN('pngScale', 1, 4, true);
  clampN('colorBandThickness', 1, 30);

  // Enum allowlists — must match the options offered by the matching <Seg>.
  const oneOf = (key, allowed) => {
    if (!allowed.includes(out[key])) out[key] = DEFAULTS[key];
  };
  oneOf('shape', ['straight', 'semi', 'arc', 'circle']);
  oneOf('tickDirection', ['inward', 'outward', 'both']);
  oneOf('numberPlacement', ['inside', 'outside']);
  oneOf('orientation', ['horizontal', 'vertical']);
  oneOf('tickSide', ['below', 'above', 'both']);
  oneOf('bg', ['#ffffff', 'transparent']);
  oneOf('fontFamily', FONT_FAMILIES);
  oneOf('colorBandPosition', ['inner', 'outer']);

  // tickColor isn't user-editable in the UI today but is part of the schema;
  // tolerate any 6-digit hex, fall back to default for anything else.
  if (typeof out.tickColor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(out.tickColor)) {
    out.tickColor = DEFAULTS.tickColor;
  }

  // Booleans: accept strict true/false only. !!val would turn truthy-looking
  // strings like "false", "0", or "no" into true, so a hand-crafted preset
  // could silently flip toggles. Fall back to DEFAULTS on anything else.
  for (const key of ['rim', 'showNumbers', 'invert', 'reverse', 'centerDot', 'outlineOnExport', 'tickRoundBoth', 'colorBandEnabled', 'pngTransparent']) {
    if (out[key] !== true && out[key] !== false) out[key] = DEFAULTS[key];
  }

  // Colour-band start/end: clamp into [min, max] and ensure start < end.
  const csN = Number(out.colorBandStart);
  const ceN = Number(out.colorBandEnd);
  out.colorBandStart = Number.isFinite(csN) ? Math.max(out.min, Math.min(out.max, csN)) : out.min;
  out.colorBandEnd = Number.isFinite(ceN) ? Math.max(out.min, Math.min(out.max, ceN)) : out.max;
  if (out.colorBandEnd <= out.colorBandStart) {
    out.colorBandStart = out.min;
    out.colorBandEnd = out.max;
  }

  // Colour-band zones: validate hex colours, finite endValues, monotonic stops,
  // and that the last stop reaches max.
  out.colorBandZones = sanitizeZones(out.colorBandZones, out.min, out.max);

  // Free-form strings: enforce type and a soft length cap so a giant URL
  // can't drag the renderer into a stall.
  const truncStr = (key, max) => {
    const v = typeof out[key] === 'string' ? out[key] : DEFAULTS[key];
    out[key] = v.length > max ? v.slice(0, max) : v;
  };
  truncStr('numberSuffix', 32);
  truncStr('customLabels', 1024);
  truncStr('centerText', 256);

  return out;
}

// ---- Colour band helpers ----
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
export const MAX_ZONES = 6;
function encodeZones(zones) {
  if (!Array.isArray(zones)) return '';
  return zones.map((z) => `${z.color}:${z.endValue}`).join(',');
}
function decodeZones(str) {
  if (typeof str !== 'string' || !str) return null;
  const parts = str.split(',').slice(0, MAX_ZONES);
  const out = [];
  for (const part of parts) {
    const [c, v] = part.split(':');
    const ev = Number(v);
    if (!HEX_RE.test(c) || !Number.isFinite(ev)) return null;
    out.push({ color: c.toLowerCase(), endValue: ev });
  }
  return out.length > 0 ? out : null;
}
// Ensure zones are valid + monotonically increasing within [min, max].
export function sanitizeZones(zones, min, max) {
  const fallback = () => DEFAULTS.colorBandZones.map(z => ({
    color: z.color, endValue: min + (z.endValue / 100) * (max - min),
  }));
  if (!Array.isArray(zones) || zones.length === 0) return fallback();
  const out = [];
  let last = min;
  for (const z of zones.slice(0, MAX_ZONES)) {
    const color = typeof z?.color === 'string' && HEX_RE.test(z.color) ? z.color.toLowerCase() : '#cccccc';
    let ev = Number(z?.endValue);
    if (!Number.isFinite(ev)) continue;
    // Enforce strictly increasing and within [min, max]
    ev = Math.max(min, Math.min(max, ev));
    if (ev <= last) continue; // Discard empty zones; never push a stop past max.
    last = ev;
    out.push({ color, endValue: ev });
  }
  if (out.length === 0) return fallback();
  // Snap the final stop to max so the band always reaches the dial end.
  out[out.length - 1].endValue = max;
  return out;
}

export function updateParams(previous, patch) {
  const next = sanitizeParams({ ...previous, ...patch });
  if (next.min === previous.min && next.max === previous.max) return next;
  const span = previous.max - previous.min;
  const mapValue = value => next.min + ((value - previous.min) / span) * (next.max - next.min);
  return sanitizeParams({
    ...next,
    colorBandStart: mapValue(previous.colorBandStart),
    colorBandEnd: mapValue(previous.colorBandEnd),
    colorBandZones: previous.colorBandZones.map(z => ({ ...z, endValue: mapValue(z.endValue) })),
  });
}

export function readPresets(raw) {
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value)
      .filter(([, p]) => p && typeof p === 'object' && !Array.isArray(p))
      .map(([name, p]) => [name, sanitizeParams(p)]));
  } catch { return {}; }
}

// ---- URL state helpers ----
// We round-trip only the fields that differ from DEFAULTS, using short keys,
// so the hash stays as short as possible. Old base64-JSON URLs still decode
// via the fallback below.
export const HASH_KEYS = {
  shape: 's',
  width: 'w',
  height: 'h',
  min: 'mn',
  max: 'mx',
  majorStep: 'ms',
  subdivisions: 'sd',
  reverse: 'rv',
  rim: 'r',
  rimThickness: 'rt',
  majorLen: 'ml',
  minorLen: 'nl',
  majorWeight: 'mw',
  minorWeight: 'nw',
  tickCornerRadius: 'tcr',
  tickRoundBoth: 'trb',
  showNumbers: 'sn',
  numberSize: 'ns',
  numberOffset: 'no',
  numberWeight: 'nwt',
  numberSuffix: 'sf',
  customLabels: 'cl',
  centerText: 'ct',
  centerTextSize: 'cts',
  centerTextWeight: 'ctw',
  centerTextOffset: 'cto',
  centerDot: 'cd',
  centerDotSize: 'cds',
  tickColor: 'tc',
  bg: 'bg',
  pngScale: 'ps',
  pngTransparent: 'pt',
  fontFamily: 'ff',
  outlineOnExport: 'ote',
  colorBandEnabled: 'cbe',
  colorBandThickness: 'cbt',
  colorBandPosition: 'cbp',
  colorBandStart: 'cbsv',
  colorBandEnd: 'cbev',
  colorBandZones: 'cbz',
  startAngle: 'sa',
  sweepAngle: 'sw',
  tickDirection: 'td',
  numberPlacement: 'np',
  invert: 'iv',
  orientation: 'or',
  tickSide: 'ts',
};
const HASH_KEYS_INV = Object.fromEntries(
  Object.entries(HASH_KEYS).map(([k, v]) => [v, k]),
);

export function encodeHashState(p, defaults) {
  const usp = new URLSearchParams();
  for (const [fullKey, shortKey] of Object.entries(HASH_KEYS)) {
    const v = p[fullKey];
    if (Array.isArray(v)) {
      // Compact `#rrggbb:value,#rrggbb:value` for the colour band zones.
      const encoded = encodeZones(v);
      const defaultEncoded = encodeZones(defaults[fullKey]);
      if (encoded && encoded !== defaultEncoded) usp.set(shortKey, encoded);
      continue;
    }
    if (v === defaults[fullKey]) continue;
    if (typeof v === 'boolean') usp.set(shortKey, v ? '1' : '0');
    else usp.set(shortKey, String(v));
  }
  return usp.toString();
}

export function decodeHashState(hash, defaults) {
  if (!hash) return null;

  // New short-key format: parse `s=arc&sa=135&...` into a diff object.
  try {
    const usp = new URLSearchParams(hash);
    const result = {};
    for (const [shortKey, value] of usp.entries()) {
      if (!Object.hasOwn(HASH_KEYS_INV, shortKey)) continue;
      const fullKey = HASH_KEYS_INV[shortKey];
      if (!fullKey) continue;
      const defaultVal = defaults[fullKey];
      if (Array.isArray(defaultVal)) {
        const parsed = decodeZones(value);
        if (parsed) result[fullKey] = parsed;
      } else if (typeof defaultVal === 'boolean') {
        // Only the strict '1' / '0' encoding maps to a boolean; anything
        // else stays unset so the DEFAULTS merge keeps the default value.
        if (value === '1') result[fullKey] = true;
        else if (value === '0') result[fullKey] = false;
      } else if (typeof defaultVal === 'number') {
        const n = Number(value);
        if (Number.isFinite(n)) result[fullKey] = n;
      } else {
        result[fullKey] = value;
      }
    }
    if (Object.keys(result).length > 0) return result;
  } catch { /* fall through */ }

  // Legacy base64-encoded JSON format. Keeps older shared links working.
  try {
    return JSON.parse(decodeURIComponent(escape(atob(decodeURIComponent(hash)))));
  } catch {
    return null;
  }
}
