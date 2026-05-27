import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import Dial from './Dial.jsx';

// ---- Initial params ----
const DEFAULTS = {
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
  fontFamily: 'Helvetica, Arial, sans-serif',
  outlineOnExport: false,
  // Colour band (zone indicator)
  colorBandEnabled: false,
  colorBandThickness: 10,
  colorBandPosition: 'outer',     // 'inner' | 'outer' (relative to rim)
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

// Curated typography choices. The CSS family is what we set on the SVG
// `font-family`; the Google Fonts spec is what we inject into the head when
// the user picks that family. `ttfUrl` is the fallback for outline-on-export
// (Helvetica is proprietary so it has no outline source).
const FONTS = [
  {
    label: 'Helvetica',
    family: 'Helvetica, Arial, sans-serif',
    gfont: null,
    ttfUrl: null,
  },
  {
    label: 'Inter',
    family: 'Inter, sans-serif',
    gfont: 'Inter:wght@100..900',
    ttfUrl: 'https://cdn.jsdelivr.net/gh/rsms/inter@v3.19/docs/font-files/Inter-Regular.otf',
  },
  {
    label: 'IBM Plex Mono',
    family: '"IBM Plex Mono", monospace',
    gfont: 'IBM+Plex+Mono:wght@100;300;400;500;600;700',
    ttfUrl: 'https://cdn.jsdelivr.net/gh/IBM/plex@master/IBM-Plex-Mono/fonts/complete/ttf/IBMPlexMono-Regular.ttf',
  },
  {
    label: 'JetBrains Mono',
    family: '"JetBrains Mono", monospace',
    gfont: 'JetBrains+Mono:wght@100..800',
    ttfUrl: 'https://cdn.jsdelivr.net/gh/JetBrains/JetBrainsMono@master/fonts/ttf/JetBrainsMono-Regular.ttf',
  },
  {
    label: 'Space Mono',
    family: '"Space Mono", monospace',
    gfont: 'Space+Mono:wght@400;700',
    ttfUrl: 'https://cdn.jsdelivr.net/gh/googlefonts/spacemono@main/fonts/SpaceMono-Regular.ttf',
  },
];
const FONT_FAMILIES = FONTS.map((f) => f.family);
const FONT_BY_FAMILY = Object.fromEntries(FONTS.map((f) => [f.family, f]));

// ---- Outline-on-export helpers ----
// Lazy-load opentype.js + the chosen font's TTF/OTF only when the user
// actually exports with outlining enabled, so the main bundle stays small.
// Parsed fonts are cached so repeated exports reuse them.
const FONT_PROMISE_CACHE = new Map();
async function loadOutlineFont(family) {
  if (FONT_PROMISE_CACHE.has(family)) return FONT_PROMISE_CACHE.get(family);
  const meta = FONT_BY_FAMILY[family];
  if (!meta || !meta.ttfUrl) return null;
  const promise = (async () => {
    const [{ default: opentype }, buffer] = await Promise.all([
      import('opentype.js'),
      fetch(meta.ttfUrl).then((r) => {
        if (!r.ok) throw new Error(`Font fetch ${r.status}`);
        return r.arrayBuffer();
      }),
    ]);
    return opentype.parse(buffer);
  })();
  FONT_PROMISE_CACHE.set(family, promise);
  try {
    return await promise;
  } catch (err) {
    FONT_PROMISE_CACHE.delete(family); // allow retry next time
    throw err;
  }
}

// Replace every <text> inside an SVG node tree with an outlined <path>.
// We adjust the baseline position to compensate for text-anchor and
// dominant-baseline because opentype's getPath() works in baseline coordinates.
async function outlineTextInSvg(svgEl, family) {
  const font = await loadOutlineFont(family);
  if (!font) return; // Helvetica or other un-outlineable font; leave text as-is
  const SVG_NS = 'http://www.w3.org/2000/svg';

  // Pull the font's vertical metrics once. opentype exposes ascender and
  // descender in font units; we convert to per-fontSize multipliers. Fall
  // back to typical Latin defaults if the font tables are unusual.
  const unitsPerEm = font.unitsPerEm || 1000;
  const ascendMul = (font.ascender || 800) / unitsPerEm;
  const descendMul = (font.descender || -200) / unitsPerEm; // typically negative
  // The em-box midpoint above the baseline is roughly (ascender + descender)/2
  // (descender is negative). This is what SVG `dominant-baseline="middle"`
  // aligns the visual centre to — using font metrics is more accurate than
  // the previous hardcoded 0.35×fontSize approximation.
  const middleMul = (ascendMul + descendMul) / 2;

  const textNodes = Array.from(svgEl.querySelectorAll('text'));
  for (const node of textNodes) {
    const text = node.textContent || '';
    if (!text) continue;
    const x = Number(node.getAttribute('x') || 0);
    const y = Number(node.getAttribute('y') || 0);
    const dx = Number(node.getAttribute('dx') || 0);
    const dy = Number(node.getAttribute('dy') || 0);
    const fontSize = Number(node.getAttribute('font-size') || 16);
    const textAnchor = node.getAttribute('text-anchor') || 'start';
    const baseline = node.getAttribute('dominant-baseline') || 'auto';
    const fill = node.getAttribute('fill') || '#000';

    let bx = x + dx;
    let by = y + dy;
    const advance = font.getAdvanceWidth(text, fontSize);
    if (textAnchor === 'middle') bx -= advance / 2;
    else if (textAnchor === 'end') bx -= advance;
    if (baseline === 'middle') by += middleMul * fontSize;
    else if (baseline === 'hanging') by += ascendMul * fontSize;

    const path = font.getPath(text, bx, by, fontSize);
    const d = path.toPathData(2);
    const replacement = document.createElementNS(SVG_NS, 'path');
    replacement.setAttribute('d', d);
    replacement.setAttribute('fill', fill);
    node.parentNode.replaceChild(replacement, node);
  }
}

// Preset shape configs
const SHAPE_PRESETS = {
  straight: { shape: 'straight', width: 800, height: 220, orientation: 'horizontal' },
  semi:     { shape: 'semi', width: 600, height: 380, startAngle: 180, sweepAngle: 180 },
  quarter:  { shape: 'arc', width: 480, height: 480, startAngle: 180, sweepAngle: 90 },
  arc270:   { shape: 'arc', width: 560, height: 560, startAngle: 135, sweepAngle: 270 },
  circle:   { shape: 'circle', width: 560, height: 560, startAngle: -90, sweepAngle: 360 },
};

function clean(p) {
  const out = { ...p };
  if (p.shape === 'circle') { out.startAngle = -90; out.sweepAngle = 360; }
  if (p.shape === 'semi')   { out.sweepAngle = 180; }
  if (p.invert) {
    out.tickColor = '#ffffff';
    out.bg = p.bg === 'transparent' ? 'transparent' : '#000000';
  }

  // Guarantee a non-empty range — sanitizeParams handles finiteness at load
  // boundaries, but the user can still produce inverted/equal min and max
  // live by typing max < min in the UI.
  if (out.max <= out.min) {
    const fallback = Math.max(1, Math.abs(Number(out.majorStep) || 1));
    out.max = out.min + fallback;
  }

  // Derive the minor step from subdivisions (minor ticks between adjacent majors).
  out.minorStep = p.subdivisions > 0 ? out.majorStep / (p.subdivisions + 1) : 0;
  return out;
}

// Clamp every numeric, enum, boolean, and string field to the same bounds
// the UI controls enforce, so values arriving from a URL hash or preset
// can't produce states the controls cannot represent. Non-finite numbers
// and unrecognised enums fall back to DEFAULTS.
function sanitizeParams(p) {
  const out = { ...p };

  // Numeric clamps mirror the UI sliders / number fields.
  const clampN = (key, lo, hi, integer = false) => {
    let n = Number(out[key]);
    if (!Number.isFinite(n)) n = DEFAULTS[key];
    if (integer) n = Math.round(n);
    out[key] = Math.min(hi, Math.max(lo, n));
  };
  clampN('width', 80, 8192, true);
  clampN('height', 80, 8192, true);
  // min/max stay loose — clean() handles equal/inverted ranges — but must be finite
  if (!Number.isFinite(Number(out.min))) out.min = DEFAULTS.min;
  else out.min = Number(out.min);
  if (!Number.isFinite(Number(out.max))) out.max = DEFAULTS.max;
  else out.max = Number(out.max);
  clampN('majorStep', 0.0001, 1e9);
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
  for (const key of ['rim', 'showNumbers', 'invert', 'reverse', 'centerDot', 'outlineOnExport', 'tickRoundBoth', 'colorBandEnabled']) {
    if (out[key] !== true && out[key] !== false) out[key] = DEFAULTS[key];
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

function Sec({ id, title, children, defaultOpen = true }) {
  const storageKey = id ? `dialMaker.section.${id}` : null;
  const [open, setOpen] = useState(() => {
    if (!storageKey) return defaultOpen;
    try {
      const stored = localStorage.getItem(storageKey);
      return stored === null ? defaultOpen : stored === '1';
    } catch { return defaultOpen; }
  });
  const toggle = () => {
    setOpen((o) => {
      const next = !o;
      if (storageKey) {
        try { localStorage.setItem(storageKey, next ? '1' : '0'); } catch { /* ignore */ }
      }
      return next;
    });
  };
  return (
    <div className={'section' + (open ? '' : ' collapsed')}>
      <h2
        className="section-head"
        onClick={toggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
        role="button"
        tabIndex={0}
        aria-expanded={open}
      >
        <span className="chev" aria-hidden="true">▸</span>
        {title}
      </h2>
      {open && <div className="section-body">{children}</div>}
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange, suffix = '' }) {
  // Local draft for the number input so intermediate strings ("", "-", "3.")
  // don't poison parent state. The slider half always commits a valid number,
  // so we only need to guard the typed-input half.
  const [draft, setDraft] = useState(String(value));
  const lastSentRef = useRef(value);
  useEffect(() => {
    if (value !== lastSentRef.current) {
      lastSentRef.current = value;
      setDraft(String(value));
    }
  }, [value]);

  const clamp = (n) => Math.min(max, Math.max(min, n));

  const handleTextChange = (e) => {
    const s = e.target.value;
    setDraft(s);
    if (s === '' || s === '-' || s.endsWith('.')) return;
    const n = Number(s);
    if (!Number.isFinite(n)) return;
    const c = clamp(n);
    if (c === value) return;
    lastSentRef.current = c;
    onChange(c);
  };
  const handleTextBlur = () => {
    const trimmed = draft.trim();
    const n = Number(trimmed);
    if (trimmed === '' || !Number.isFinite(n)) {
      setDraft(String(value));
      return;
    }
    const c = clamp(n);
    setDraft(String(c));
    if (c !== value) {
      lastSentRef.current = c;
      onChange(c);
    }
  };

  return (
    <div className="slider-row">
      <div className="slider-head">
        <label>{label}</label>
        <div className="val-input">
          <input
            className="mono"
            type="number"
            value={draft}
            min={min}
            max={max}
            step={step}
            onChange={handleTextChange}
            onBlur={handleTextBlur}
          />
          {suffix && <span className="val-suffix mono">{suffix}</span>}
        </div>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

function NumField({ label, value, step = 1, onChange }) {
  // Keep a local string draft so intermediate states ("", "-", "3.") don't
  // leak into parent state and get fed into renderer arithmetic. We only
  // commit when the draft parses to a finite number, and revert on blur if
  // it doesn't.
  const [draft, setDraft] = useState(String(value));
  const lastSentRef = useRef(value);
  useEffect(() => {
    // Resync only when the value changed from outside (preset load, reset).
    if (value !== lastSentRef.current) {
      lastSentRef.current = value;
      setDraft(String(value));
    }
  }, [value]);

  const handleChange = (e) => {
    const s = e.target.value;
    setDraft(s);
    if (s === '' || s === '-' || s.endsWith('.')) return; // mid-typing
    const n = Number(s);
    if (Number.isFinite(n)) {
      lastSentRef.current = n;
      onChange(n);
    }
  };
  const handleBlur = () => {
    const trimmed = draft.trim();
    const n = Number(trimmed);
    if (trimmed === '' || !Number.isFinite(n)) {
      setDraft(String(value)); // revert
      return;
    }
    // Normalize the draft to its canonical numeric form (e.g. "3." -> "3")
    // and commit if it differs from the last value we sent.
    setDraft(String(n));
    if (n !== value) {
      lastSentRef.current = n;
      onChange(n);
    }
  };

  return (
    <div className="field">
      <label>{label}</label>
      <input
        className="num mono"
        type="number"
        value={draft}
        step={step}
        onChange={handleChange}
        onBlur={handleBlur}
      />
    </div>
  );
}

function TextField({ label, value, onChange, placeholder = '', wide = false }) {
  return (
    <div className={'field' + (wide ? ' field-wide' : '')}>
      <label>{label}</label>
      <input
        className="num text mono"
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function Seg({ options, value, onChange, icon = false }) {
  return (
    <div className={'seg' + (icon ? ' icon' : '')}>
      {options.map((o) => (
        <button
          key={o.value}
          className={value === o.value ? 'on' : ''}
          onClick={() => onChange(o.value)}
          title={o.title || o.label}
        >
          {o.render ? o.render(value === o.value) : o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange }) {
  return (
    <input
      className="toggle"
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

// Colour-band zone editor. Renders a stacked preview bar so the user can
// see relative proportions at a glance, plus a list of per-zone rows for
// the actual editing (colour + numeric end-value + delete).
const BAND_PRESETS = {
  Traffic:  [{ color: '#3a9d2a', endValue: 0.5 }, { color: '#e4c41a', endValue: 0.8 }, { color: '#d63a3a', endValue: 1.0 }],
  Warning:  [{ color: '#777777', endValue: 0.8 }, { color: '#d63a3a', endValue: 1.0 }],
  Cool:     [{ color: '#2a6fb4', endValue: 0.33 }, { color: '#aaaaaa', endValue: 0.66 }, { color: '#d63a3a', endValue: 1.0 }],
  Mono:     [{ color: '#cccccc', endValue: 0.5 }, { color: '#666666', endValue: 1.0 }],
};
function applyPreset(name, min, max) {
  const template = BAND_PRESETS[name];
  if (!template) return null;
  const span = max - min;
  return template.map((z) => ({ color: z.color, endValue: min + z.endValue * span }));
}

function ColorBandEditor({ zones, min, max, position, thickness, onChangeZones, onChangePosition, onChangeThickness }) {
  const span = Math.max(1e-9, max - min);
  const updateZone = (i, patch) => {
    const next = zones.map((z, idx) => (idx === i ? { ...z, ...patch } : z));
    // Clamp endValues to [min, max] and force monotonic; the last stop snaps to max.
    let last = min;
    for (let j = 0; j < next.length; j++) {
      let ev = Number(next[j].endValue);
      if (!Number.isFinite(ev)) ev = last + span / next.length;
      ev = Math.max(min, Math.min(max, ev));
      if (ev <= last) ev = last + span / 1e6;
      last = ev;
      next[j] = { ...next[j], endValue: ev };
    }
    next[next.length - 1].endValue = max;
    onChangeZones(next);
  };
  const removeZone = (i) => {
    if (zones.length <= 1) return;
    const next = zones.filter((_, idx) => idx !== i);
    next[next.length - 1].endValue = max;
    onChangeZones(next);
  };
  const addZone = () => {
    if (zones.length >= MAX_ZONES) return;
    // Split the last zone in half.
    const lastIdx = zones.length - 1;
    const prev = lastIdx === 0 ? min : zones[lastIdx - 1].endValue;
    const mid = (prev + zones[lastIdx].endValue) / 2;
    const next = [...zones];
    next.splice(lastIdx, 0, { color: '#888888', endValue: mid });
    onChangeZones(next);
  };

  return (
    <>
      <div className="row gap-top">
        <label>Position</label>
        <Seg
          options={[{ value: 'outer', label: 'Outer' }, { value: 'inner', label: 'Inner' }]}
          value={position}
          onChange={onChangePosition}
        />
      </div>
      <Slider label="Thickness" value={thickness} min={1} max={30} step={1} onChange={onChangeThickness} suffix="px" />

      {/* Stacked proportional preview */}
      <div className="band-preview" aria-hidden="true">
        {zones.map((z, i) => {
          const prev = i === 0 ? min : zones[i - 1].endValue;
          const w = ((z.endValue - prev) / span) * 100;
          return <div key={i} style={{ width: `${w}%`, background: z.color }} />;
        })}
      </div>

      <div className="band-zones">
        {zones.map((z, i) => (
          <div key={i} className="band-zone-row">
            <input
              type="color"
              className="band-swatch"
              value={z.color}
              onChange={(e) => updateZone(i, { color: e.target.value })}
              aria-label={`Zone ${i + 1} colour`}
            />
            <input
              type="number"
              className="num mono band-end"
              value={z.endValue}
              step={1}
              disabled={i === zones.length - 1}
              title={i === zones.length - 1 ? 'Last zone always ends at max' : 'End value'}
              onChange={(e) => updateZone(i, { endValue: Number(e.target.value) })}
            />
            <button
              type="button"
              className="band-del"
              onClick={() => removeZone(i)}
              disabled={zones.length <= 1}
              aria-label={`Delete zone ${i + 1}`}
              title="Delete zone"
            >×</button>
          </div>
        ))}
      </div>

      <div className="btn-row gap-top-sm">
        <button
          className="preset-save full-row"
          onClick={addZone}
          disabled={zones.length >= MAX_ZONES}
        >+ Add zone</button>
      </div>

      <div className="row gap-top">
        <label>Preset</label>
        <select
          className="select mono"
          value=""
          onChange={(e) => {
            const next = applyPreset(e.target.value, min, max);
            if (next) onChangeZones(next);
          }}
        >
          <option value="">Choose…</option>
          {Object.keys(BAND_PRESETS).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      <p className="hint">Each zone ends at the value shown. The final zone always reaches the max — colours flow left to right. Bands sit beneath ticks and rim.</p>
    </>
  );
}

// Shape SVG icons for the segmented control
const ShapeIcon = {
  straight: (on) => (
    <svg width="36" height="20" viewBox="0 0 36 20" fill="none">
      <line x1="4" y1="10" x2="32" y2="10" stroke={on ? '#fff' : '#111'} strokeWidth="1.4" />
      {[6,11,16,21,26,31].map((x,i)=>(
        <line key={i} x1={x} y1="10" x2={x} y2={i%2===0?'15':'13'} stroke={on?'#fff':'#111'} strokeWidth="1.2" />
      ))}
    </svg>
  ),
  semi: (on) => (
    <svg width="36" height="20" viewBox="0 0 36 20" fill="none">
      <path d="M 5 16 A 13 13 0 0 1 31 16" stroke={on?'#fff':'#111'} strokeWidth="1.4" fill="none" />
      {[0,30,60,90,120,150,180].map((deg,i)=>{
        const rad=(180+deg)*Math.PI/180;
        const x1=18+Math.cos(rad)*13, y1=16+Math.sin(rad)*13;
        const x2=18+Math.cos(rad)*(13-3), y2=16+Math.sin(rad)*(13-3);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={on?'#fff':'#111'} strokeWidth="1.1" />;
      })}
    </svg>
  ),
  arc: (on) => (
    <svg width="36" height="20" viewBox="0 0 36 20" fill="none">
      <path d="M 7 17 A 12 12 0 1 1 29 17" stroke={on?'#fff':'#111'} strokeWidth="1.4" fill="none" />
    </svg>
  ),
  circle: (on) => (
    <svg width="36" height="20" viewBox="0 0 36 20" fill="none">
      <circle cx="18" cy="10" r="8" stroke={on?'#fff':'#111'} strokeWidth="1.4" fill="none" />
      {[0,45,90,135,180,225,270,315].map((deg,i)=>{
        const rad=deg*Math.PI/180;
        const x1=18+Math.cos(rad)*8, y1=10+Math.sin(rad)*8;
        const x2=18+Math.cos(rad)*(8-2.5), y2=10+Math.sin(rad)*(8-2.5);
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={on?'#fff':'#111'} strokeWidth="1.1" />;
      })}
    </svg>
  ),
};

// ---- Colour band helpers ----
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const MAX_ZONES = 6;
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
function sanitizeZones(zones, min, max) {
  if (!Array.isArray(zones) || zones.length === 0) return DEFAULTS.colorBandZones;
  const out = [];
  let last = -Infinity;
  for (const z of zones.slice(0, MAX_ZONES)) {
    const color = typeof z?.color === 'string' && HEX_RE.test(z.color) ? z.color.toLowerCase() : '#cccccc';
    let ev = Number(z?.endValue);
    if (!Number.isFinite(ev)) continue;
    // Enforce strictly increasing and within [min, max]
    ev = Math.max(min, Math.min(max, ev));
    if (ev <= last) ev = last + (max - min) / 1e6; // nudge forward
    last = ev;
    out.push({ color, endValue: ev });
  }
  if (out.length === 0) return DEFAULTS.colorBandZones;
  // Snap the final stop to max so the band always reaches the dial end.
  out[out.length - 1].endValue = max;
  return out;
}

// ---- URL state helpers ----
// We round-trip only the fields that differ from DEFAULTS, using short keys,
// so the hash stays as short as possible. Old base64-JSON URLs still decode
// via the fallback below.
const HASH_KEYS = {
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
  fontFamily: 'ff',
  outlineOnExport: 'ote',
  colorBandEnabled: 'cbe',
  colorBandThickness: 'cbt',
  colorBandPosition: 'cbp',
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

function encodeHashState(p, defaults) {
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

function decodeHashState(hash, defaults) {
  if (!hash) return null;

  // New short-key format: parse `s=arc&sa=135&...` into a diff object.
  try {
    const usp = new URLSearchParams(hash);
    const result = {};
    for (const [shortKey, value] of usp.entries()) {
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

export default function App() {
  const [p, setP] = useState(() => {
    const fromHash = decodeHashState(window.location.hash.slice(1), DEFAULTS);
    return fromHash ? sanitizeParams({ ...DEFAULTS, ...fromHash }) : DEFAULTS;
  });
  const svgWrapRef = useRef(null);

  // Write the diff back into the URL hash (debounced). If nothing differs
  // from defaults we drop the hash entirely so the URL stays clean.
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const encoded = encodeHashState(p, DEFAULTS);
        if (encoded) {
          window.history.replaceState(null, '', '#' + encoded);
        } else if (window.location.hash) {
          window.history.replaceState(null, '', window.location.pathname + window.location.search);
        }
      } catch { /* ignore */ }
    }, 250);
    return () => clearTimeout(t);
  }, [p]);

  // React to the URL hash changing externally (paste, back/forward, manual
  // edit). An empty hash means "reset to defaults" — without that branch the
  // app silently ignored hash removal and the URL stopped reflecting state.
  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash.slice(1);
      if (!hash) {
        setP(DEFAULTS);
        return;
      }
      const next = decodeHashState(hash, DEFAULTS);
      if (next) setP(sanitizeParams({ ...DEFAULTS, ...next }));
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Load Google Fonts on demand. We keep a single <link> tag in <head> and
  // rewrite its href when the selected font changes. Helvetica/Arial are
  // assumed to be system-installed, so no link is needed for those.
  useEffect(() => {
    const meta = FONT_BY_FAMILY[p.fontFamily];
    if (!meta || !meta.gfont) return;
    const id = 'dials-gfont';
    let link = document.getElementById(id);
    if (!link) {
      link = document.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
    link.href = `https://fonts.googleapis.com/css2?family=${meta.gfont}&display=swap`;
  }, [p.fontFamily]);

  const set = (k, v) => setP((prev) => ({ ...prev, [k]: v }));
  const setMany = (obj) => setP((prev) => ({ ...prev, ...obj }));

  const params = useMemo(() => clean(p), [p]);

  const shape = p.shape;
  const isArc = shape !== 'straight';

  // ---- Zoom / pan ----
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const stageRef = useRef(null);
  const zoomRef = useRef(1);
  const dragRef = useRef(null);

  // ---- Fit the canvas to the available stage area ----
  // SVG percent-sizing breaks when the parent has no defined dimensions, so
  // we measure the stage and set the wrapper size explicitly.
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const update = () => setStageSize({ w: node.clientWidth, h: node.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  const STAGE_PADDING = 16;
  const canvasAspect = params.width / params.height || 1;
  const availW = Math.max(0, stageSize.w - STAGE_PADDING);
  const availH = Math.max(0, stageSize.h - STAGE_PADDING);
  let fitW = availW;
  let fitH = availW / canvasAspect;
  if (fitH > availH) {
    fitH = availH;
    fitW = availH * canvasAspect;
  }

  const applyZoom = useCallback((targetZ, cursorPos) => {
    const oldZ = zoomRef.current;
    const newZ = Math.max(0.2, Math.min(8, targetZ));
    if (Math.abs(newZ - oldZ) < 1e-6) return;
    const s = newZ / oldZ;
    zoomRef.current = newZ;
    setZoom(newZ);
    if (cursorPos && stageRef.current) {
      const rect = stageRef.current.getBoundingClientRect();
      const dx = cursorPos.x - rect.left - rect.width / 2;
      const dy = cursorPos.y - rect.top - rect.height / 2;
      setPan((prev) => ({
        x: dx * (1 - s) + prev.x * s,
        y: dy * (1 - s) + prev.y * s,
      }));
    }
  }, []);

  const onWheel = useCallback((e) => {
    const factor = Math.exp(-e.deltaY * 0.0015);
    applyZoom(zoomRef.current * factor, { x: e.clientX, y: e.clientY });
  }, [applyZoom]);

  // Mirror pan into a ref so the global mousemove handler reads fresh values
  // and so mousedown can capture the current pan synchronously.
  const panRef = useRef(pan);
  useEffect(() => { panRef.current = pan; }, [pan]);

  const onStageMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.zoom-ctl')) return;
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      panX: panRef.current.x, panY: panRef.current.y,
    };
    setIsDragging(true);
    e.preventDefault();
  }, []);

  useEffect(() => {
    const onMove = (ev) => {
      if (!dragRef.current) return;
      setPan({
        x: dragRef.current.panX + (ev.clientX - dragRef.current.startX),
        y: dragRef.current.panY + (ev.clientY - dragRef.current.startY),
      });
    };
    const onUp = () => {
      if (dragRef.current) {
        dragRef.current = null;
        setIsDragging(false);
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const resetView = useCallback(() => {
    zoomRef.current = 1;
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const zoomedOrPanned = zoom !== 1 || pan.x !== 0 || pan.y !== 0;

  // ---- Presets ----
  const PRESET_KEY = 'dialMaker.presets.v1';
  const [presets, setPresets] = useState(() => {
    try {
      const raw = localStorage.getItem(PRESET_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  });
  const persistPresets = useCallback((next) => {
    setPresets(next);
    try { localStorage.setItem(PRESET_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  }, []);
  const savePreset = useCallback(() => {
    const name = (window.prompt('Preset name') || '').trim();
    if (!name) return;
    if (presets[name] && !window.confirm(`Overwrite preset "${name}"?`)) return;
    persistPresets({ ...presets, [name]: p });
  }, [presets, p, persistPresets]);
  const loadPreset = useCallback((name) => {
    const saved = presets[name];
    if (!saved) return;
    const merged = { ...DEFAULTS, ...saved };
    // Back-compat: presets saved before "subdivisions" had a minorStep field
    if (saved.subdivisions === undefined && saved.minorStep !== undefined) {
      merged.subdivisions = saved.minorStep > 0 && saved.majorStep > 0
        ? Math.max(0, Math.round(saved.majorStep / saved.minorStep) - 1)
        : 0;
    }
    delete merged.minorStep;
    setP(sanitizeParams(merged));
  }, [presets]);
  const deletePreset = useCallback((name) => {
    if (!window.confirm(`Delete preset "${name}"?`)) return;
    const next = { ...presets };
    delete next[name];
    persistPresets(next);
  }, [presets, persistPresets]);
  const presetNames = useMemo(
    () => Object.keys(presets).sort((a, b) => a.localeCompare(b)),
    [presets],
  );

  const onShape = (s) => {
    const preset = SHAPE_PRESETS[s === 'arc' ? 'arc270' : s] || {};
    setMany({ ...preset, shape: s });
  };

  // ---- Share ----
  const [linkStatus, setLinkStatus] = useState('idle'); // idle | ok | error
  const linkResetRef = useRef(null);
  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setLinkStatus('ok');
    } catch {
      setLinkStatus('error');
    }
    if (linkResetRef.current) clearTimeout(linkResetRef.current);
    linkResetRef.current = setTimeout(() => setLinkStatus('idle'), 1500);
  }, []);

  // ---- Export ----
  // Clone the live SVG, normalise its sizing attributes, and (when requested)
  // outline every <text> to a <path>. Returns an off-DOM SVG element.
  const buildExportSvg = useCallback(async () => {
    const live = svgWrapRef.current?.querySelector('svg');
    if (!live) return null;
    const clone = live.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', params.width);
    clone.setAttribute('height', params.height);
    clone.removeAttribute('style');
    if (params.outlineOnExport) {
      try {
        await outlineTextInSvg(clone, params.fontFamily);
      } catch (err) {
        // If outlining fails (network blip, parse error), fall back to the
        // text-as-text export rather than blocking the action entirely.
        console.error('outlineOnExport failed', err);
      }
    }
    return clone;
  }, [params]);

  const serializeSvg = (el) => '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(el);

  const [copyStatus, setCopyStatus] = useState('idle'); // idle | ok | error
  const copyResetRef = useRef(null);
  const copySVG = useCallback(async () => {
    const clone = await buildExportSvg();
    if (!clone) return;
    try {
      await navigator.clipboard.writeText(serializeSvg(clone));
      setCopyStatus('ok');
    } catch {
      setCopyStatus('error');
    }
    if (copyResetRef.current) clearTimeout(copyResetRef.current);
    copyResetRef.current = setTimeout(() => setCopyStatus('idle'), 1500);
  }, [buildExportSvg]);

  const exportSVG = useCallback(async () => {
    const clone = await buildExportSvg();
    if (!clone) return;
    const blob = new Blob([serializeSvg(clone)], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `dial-${params.shape}.svg`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [buildExportSvg, params]);

  const exportPNG = useCallback(async () => {
    const clone = await buildExportSvg();
    if (!clone) return;
    const xml = serializeSvg(clone);
    const svg64 = btoa(unescape(encodeURIComponent(xml)));
    const img = new Image();
    img.onload = () => {
      const scale = params.pngScale || 2;
      const cnv = document.createElement('canvas');
      cnv.width = params.width * scale;
      cnv.height = params.height * scale;
      const ctx = cnv.getContext('2d');
      if (params.bg === 'transparent') {
        ctx.clearRect(0, 0, cnv.width, cnv.height);
      } else {
        ctx.fillStyle = params.bg || '#ffffff';
        ctx.fillRect(0, 0, cnv.width, cnv.height);
      }
      ctx.drawImage(img, 0, 0, cnv.width, cnv.height);
      cnv.toBlob((b) => {
        if (!b) {
          console.error('PNG export: canvas.toBlob returned null');
          window.alert('PNG export failed — the canvas was rejected by the browser. Try a smaller canvas / PNG scale.');
          return;
        }
        const url = URL.createObjectURL(b);
        const a = document.createElement('a');
        a.href = url; a.download = `dial-${params.shape}@${scale}x.png`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }, 'image/png');
    };
    img.onerror = () => {
      // Rare: very large dimensions or an SVG the browser refuses to parse as
      // an image. Surface it rather than failing silently.
      console.error('PNG export: failed to load SVG as image');
      window.alert('PNG export failed — the browser could not rasterise the SVG. Try a smaller canvas / PNG scale.');
    };
    img.src = 'data:image/svg+xml;base64,' + svg64;
  }, [buildExportSvg, params]);

  const reset = () => setP(DEFAULTS);

  return (
    <div className="app">
      <aside className="side">
        <div className="brand">
          <h1>Dials</h1>
          <span className="v mono">v1.0</span>
        </div>

        <Sec id="shape" title="Shape">
          <Seg
            icon
            options={[
              { value: 'straight', label: 'Line',  render: ShapeIcon.straight, title: 'Straight line' },
              { value: 'semi',     label: 'Semi',  render: ShapeIcon.semi,     title: 'Semi-circle' },
              { value: 'arc',      label: 'Arc',   render: ShapeIcon.arc,      title: 'Custom arc' },
              { value: 'circle',   label: 'Round', render: ShapeIcon.circle,   title: 'Full circle' },
            ]}
            value={shape}
            onChange={onShape}
          />

          {shape === 'straight' && (
            <div className="gap-top-lg">
              <div className="row">
                <label>Orientation</label>
                <Seg
                  options={[{ value: 'horizontal', label: 'Horiz.' }, { value: 'vertical', label: 'Vert.' }]}
                  value={p.orientation}
                  onChange={(v) => {
                    // Self-correcting: place the longer dimension on the active
                    // axis. Means clicking the active button while the canvas
                    // is mismatched snaps it back into shape, instead of just
                    // doing nothing.
                    const longer = Math.max(p.width, p.height);
                    const shorter = Math.min(p.width, p.height);
                    const newWidth = v === 'horizontal' ? longer : shorter;
                    const newHeight = v === 'horizontal' ? shorter : longer;
                    if (v === p.orientation && newWidth === p.width && newHeight === p.height) return;
                    setMany({ orientation: v, width: newWidth, height: newHeight });
                  }}
                />
              </div>
              <div className="row gap-top">
                <label>Tick side</label>
                <Seg
                  options={[
                    { value: 'below', label: p.orientation === 'vertical' ? 'Right' : 'Below' },
                    { value: 'above', label: p.orientation === 'vertical' ? 'Left' : 'Above' },
                    { value: 'both',  label: 'Both' },
                  ]}
                  value={p.tickSide}
                  onChange={(v) => set('tickSide', v)}
                />
              </div>
            </div>
          )}

          {shape === 'arc' && (
            <div className="gap-top-lg">
              <Slider
                label="Start angle" suffix="°"
                value={p.startAngle} min={-180} max={360} step={1}
                onChange={(v) => set('startAngle', v)}
              />
              <Slider
                label="Sweep" suffix="°"
                value={p.sweepAngle} min={30} max={360} step={1}
                onChange={(v) => set('sweepAngle', v)}
              />
            </div>
          )}

          {isArc && (
            <div className="gap-top-sm">
              <div className="row">
                <label>Ticks</label>
                <Seg
                  options={[
                    { value: 'inward', label: 'Inward' },
                    { value: 'outward', label: 'Outward' },
                    { value: 'both', label: 'Both' },
                  ]}
                  value={p.tickDirection}
                  onChange={(v) => set('tickDirection', v)}
                />
              </div>
              <div className="row">
                <label>Numbers</label>
                <Seg
                  options={[
                    { value: 'inside', label: 'Inside' },
                    { value: 'outside', label: 'Outside' },
                  ]}
                  value={p.numberPlacement}
                  onChange={(v) => set('numberPlacement', v)}
                />
              </div>
            </div>
          )}

          <div className="row gap-top">
            <label>Reverse direction</label>
            <Toggle checked={p.reverse} onChange={(v) => set('reverse', v)} />
          </div>
        </Sec>

        <Sec id="range" title="Range">
          <div className="grid-2">
            <NumField label="Min" value={p.min} onChange={(v) => set('min', v)} />
            <NumField label="Max" value={p.max} onChange={(v) => set('max', v)} />
          </div>
        </Sec>

        <Sec id="graduations" title="Graduations">
          <div className="grid-2">
            <NumField
              label="Major step"
              value={p.majorStep} step={p.majorStep < 1 ? 0.1 : 1}
              onChange={(v) => set('majorStep', Math.min(1e9, Math.max(0.0001, Number(v) || 0.0001)))}
            />
            <NumField
              label="Subdivisions"
              value={p.subdivisions} step={1}
              onChange={(v) => set('subdivisions', Math.min(100, Math.max(0, Math.round(Number(v) || 0))))}
            />
          </div>
          <p className="hint">Subdivisions = minor ticks between adjacent majors. 0 hides them.</p>
          <Slider label="Major length" value={p.majorLen} min={2} max={60} step={1} onChange={(v) => set('majorLen', v)} suffix="px" />
          <Slider label="Minor length" value={p.minorLen} min={1} max={40} step={1} onChange={(v) => set('minorLen', v)} suffix="px" />
          <Slider label="Major weight" value={p.majorWeight} min={0.5} max={8} step={0.5} onChange={(v) => set('majorWeight', v)} suffix="px" />
          <Slider label="Minor weight" value={p.minorWeight} min={0.25} max={5} step={0.25} onChange={(v) => set('minorWeight', v)} suffix="px" />
          <Slider label="Corner radius" value={p.tickCornerRadius} min={0} max={100} step={1} onChange={(v) => set('tickCornerRadius', v)} suffix="%" />
          {p.tickCornerRadius > 0 && (
            <div className="row gap-top">
              <label>Round both ends</label>
              <Toggle checked={p.tickRoundBoth} onChange={(v) => set('tickRoundBoth', v)} />
            </div>
          )}
        </Sec>

        <Sec id="rim" title="Rim">
          <div className="row">
            <label>Rim</label>
            <Toggle checked={p.rim} onChange={(v) => set('rim', v)} />
          </div>
          {p.rim && (
            <Slider label="Thickness" value={p.rimThickness} min={0.5} max={12} step={0.5} onChange={(v) => set('rimThickness', v)} suffix="px" />
          )}
        </Sec>

        <Sec id="colorband" title="Colour band">
          <div className="row">
            <label>Show band</label>
            <Toggle checked={p.colorBandEnabled} onChange={(v) => set('colorBandEnabled', v)} />
          </div>
          {p.colorBandEnabled && (
            <ColorBandEditor
              zones={p.colorBandZones}
              min={p.min}
              max={p.max}
              position={p.colorBandPosition}
              thickness={p.colorBandThickness}
              onChangeZones={(zones) => set('colorBandZones', zones)}
              onChangePosition={(v) => set('colorBandPosition', v)}
              onChangeThickness={(v) => set('colorBandThickness', v)}
            />
          )}
        </Sec>

        <Sec id="typography" title="Typography">
          <div className="row">
            <label>Font</label>
            <select
              className="select mono"
              value={p.fontFamily}
              onChange={(e) => set('fontFamily', e.target.value)}
            >
              {FONTS.map((f) => (
                <option key={f.family} value={f.family}>{f.label}</option>
              ))}
            </select>
          </div>
          <p className="hint">Applies to tick numbers, custom labels, and the centre title text.</p>
        </Sec>

        <Sec id="numbers" title="Numbers">
          <div className="row">
            <label>Show numbers</label>
            <Toggle checked={p.showNumbers} onChange={(v) => set('showNumbers', v)} />
          </div>
          {p.showNumbers && (
            <>
              <Slider label="Size" value={p.numberSize} min={6} max={48} step={1} onChange={(v) => set('numberSize', v)} suffix="px" />
              <Slider label="Offset" value={p.numberOffset} min={0} max={40} step={1} onChange={(v) => set('numberOffset', v)} suffix="px" />
              <Slider label="Weight" value={p.numberWeight} min={100} max={900} step={100} onChange={(v) => set('numberWeight', v)} />
              <div className="grid-2 gap-top">
                <TextField label="Suffix" value={p.numberSuffix} placeholder="° % mph" onChange={(v) => set('numberSuffix', v)} />
              </div>
              <div className="gap-top">
                <TextField label="Custom labels" value={p.customLabels} placeholder="e.g. L, M, H" wide onChange={(v) => set('customLabels', v)} />
              </div>
              <p className="hint">Comma-separated, one per major tick. Leave an entry blank to keep the numeric value at that position.</p>
            </>
          )}
        </Sec>

        {isArc && (
          <Sec id="center" title="Center">
            <div className="row">
              <label>Hub dot</label>
              <Toggle checked={p.centerDot} onChange={(v) => set('centerDot', v)} />
            </div>
            {p.centerDot && (
              <Slider label="Hub size" value={p.centerDotSize} min={1} max={80} step={1} onChange={(v) => set('centerDotSize', v)} suffix="px" />
            )}

            <div className="gap-top">
              <TextField label="Title text" value={p.centerText} placeholder="e.g. RPM × 1000" wide onChange={(v) => set('centerText', v)} />
            </div>
            {p.centerText && (
              <>
                <Slider label="Text size" value={p.centerTextSize} min={8} max={96} step={1} onChange={(v) => set('centerTextSize', v)} suffix="px" />
                <Slider label="Text weight" value={p.centerTextWeight} min={100} max={900} step={100} onChange={(v) => set('centerTextWeight', v)} />
                <Slider label="Text position" value={p.centerTextOffset} min={-300} max={300} step={1} onChange={(v) => set('centerTextOffset', v)} suffix="px" />
              </>
            )}
            <p className="hint">Rendered at the dial's pivot. For a semi-circle this sits at the bottom of the arc; for a full circle, the geometric centre.</p>
          </Sec>
        )}

        <Sec id="canvas" title="Canvas">
          <div className="grid-2">
            <NumField label="Width"  value={p.width}  onChange={(v) => set('width',  Math.min(8192, Math.max(80, Math.round(Number(v) || 80))))} />
            <NumField label="Height" value={p.height} onChange={(v) => set('height', Math.min(8192, Math.max(80, Math.round(Number(v) || 80))))} />
          </div>
          <div className="row gap-top">
            <label>Texture size</label>
            <Seg
              options={[
                { value: 512,  label: '512' },
                { value: 1024, label: '1024' },
                { value: 2048, label: '2048' },
              ]}
              value={p.width === p.height ? p.width : null}
              onChange={(n) => setMany({ width: n, height: n })}
            />
          </div>
          <div className="row gap-top">
            <label>Background</label>
            <Seg
              options={[
                { value: '#ffffff', label: 'White' },
                { value: 'transparent', label: 'None' },
              ]}
              value={p.bg}
              onChange={(v) => set('bg', v)}
            />
          </div>
          <div className="row gap-top">
            <label>Invert (white on black)</label>
            <Toggle checked={p.invert} onChange={(v) => set('invert', v)} />
          </div>
        </Sec>

        <Sec id="presets" title="Presets" defaultOpen={false}>
          {presetNames.length === 0 ? (
            <div className="preset-empty">No saved presets yet.</div>
          ) : (
            <div className="preset-list">
              {presetNames.map((name) => (
                <div key={name} className="preset-item">
                  <button className="preset-load" onClick={() => loadPreset(name)} title={`Load "${name}"`}>{name}</button>
                  <button className="preset-del" onClick={() => deletePreset(name)} title={`Delete "${name}"`} aria-label={`Delete preset ${name}`}>×</button>
                </div>
              ))}
            </div>
          )}
          <button className="preset-save" onClick={savePreset}>+ Save current as preset</button>
        </Sec>

        <div className="foot">
          <div className="row">
            <label>PNG scale</label>
            <Seg
              options={[
                { value: 1, label: '1×' },
                { value: 2, label: '2×' },
                { value: 3, label: '3×' },
                { value: 4, label: '4×' },
              ]}
              value={p.pngScale}
              onChange={(v) => set('pngScale', v)}
            />
          </div>
          <div className="row gap-top">
            <label>Outline text on export</label>
            <Toggle checked={p.outlineOnExport} onChange={(v) => set('outlineOnExport', v)} />
          </div>
          {p.outlineOnExport && (
            <p className="hint">Outlined glyphs are rendered at Regular weight regardless of the Number weight slider. Helvetica has no embeddable file, so outlining is a no-op when Helvetica is selected.</p>
          )}
          <div className="btn-row gap-top">
            <button className="btn" onClick={exportSVG}>Download SVG</button>
            <button className="btn alt" onClick={exportPNG}>Download PNG</button>
          </div>
          <div className="btn-row gap-top-sm">
            <button className="btn alt full-row" onClick={copySVG}>
              {copyStatus === 'ok' ? 'Copied!' : copyStatus === 'error' ? 'Copy failed' : 'Copy SVG to clipboard'}
            </button>
          </div>
          <div className="btn-row gap-top-sm">
            <button className="btn alt full-row" onClick={copyLink}>
              {linkStatus === 'ok' ? 'Link copied!' : linkStatus === 'error' ? 'Copy failed' : 'Copy share link'}
            </button>
          </div>
          <div className="btn-row gap-top-sm">
            <button className="btn alt full-row" onClick={reset}>Reset to defaults</button>
          </div>
          <p className="hint">SVG is scalable and editable in any vector tool. The share link round-trips the full dial config in the URL hash.</p>
        </div>
      </aside>

      <main
        className={'stage' + (zoomedOrPanned ? ' zoomed' : '') + (isDragging ? ' dragging' : '')}
        ref={stageRef}
        onWheel={onWheel}
        onMouseDown={onStageMouseDown}
      >
        <div
          className="stage-inner"
          ref={svgWrapRef}
          style={{
            width: fitW,
            height: fitH,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          }}
        >
          <Dial params={params} />
        </div>
        <div className="stage-meta">
          <span className="dot" />
          {params.width} × {params.height} · {shape === 'straight' ? 'straight' : shape === 'circle' ? 'circle' : shape === 'semi' ? 'semi-circle' : `arc ${params.sweepAngle}°`}
        </div>
        <div className="zoom-ctl" onMouseDown={(e) => e.stopPropagation()}>
          <button onClick={() => applyZoom(zoomRef.current / 1.25)} title="Zoom out" aria-label="Zoom out">−</button>
          <div className="zlbl">{Math.round(zoom * 100)}%</div>
          <button onClick={() => applyZoom(zoomRef.current * 1.25)} title="Zoom in" aria-label="Zoom in">+</button>
          <button onClick={resetView} title="Reset view" aria-label="Reset view">Fit</button>
        </div>
      </main>
    </div>
  );
}
