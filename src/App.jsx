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
  showNumbers: true,
  numberSize: 18,
  numberOffset: 8,
  numberWeight: 400,
  numberSuffix: '',
  customLabels: '',
  centerText: '',
  centerTextSize: 28,
  centerTextWeight: 500,
  tickColor: '#111111',
  bg: '#ffffff',
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

// Preset shape configs
const SHAPE_PRESETS = {
  straight: { shape: 'straight', width: 800, height: 220 },
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

  // Coerce numeric fields and guarantee a non-empty range. The NumField draft
  // pattern already prevents '' from entering state, but old presets and
  // future paths could still produce equal or inverted min/max.
  const minN = Number(out.min);
  const maxN = Number(out.max);
  out.min = Number.isFinite(minN) ? minN : 0;
  out.max = Number.isFinite(maxN) ? maxN : 100;
  if (out.max <= out.min) {
    const fallback = Math.max(1, Math.abs(Number(out.majorStep) || 1));
    out.max = out.min + fallback;
  }

  // Derive the minor step from subdivisions count (minor ticks between adjacent majors)
  out.minorStep = p.subdivisions > 0 ? out.majorStep / (p.subdivisions + 1) : 0;
  return out;
}

function Sec({ title, children }) {
  return (
    <div className="section">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange, suffix = '' }) {
  return (
    <div className="slider-row">
      <div className="slider-head">
        <label>{label}</label>
        <span className="val mono">{value}{suffix}</span>
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

function TextField({ label, value, onChange, placeholder = '' }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input
        className="num mono"
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        style={{ textAlign: 'left' }}
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

export default function App() {
  const [p, setP] = useState(DEFAULTS);
  const svgWrapRef = useRef(null);

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

  const onStageMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    if (e.target.closest('.zoom-ctl')) return;
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      panX: 0, panY: 0,
      _initialized: false,
    };
    setIsDragging(true);
    e.preventDefault();
  }, []);

  // Mirror pan into a ref so the global mousemove handler reads fresh values
  const panRef = useRef(pan);
  useEffect(() => { panRef.current = pan; }, [pan]);

  useEffect(() => {
    const onMove = (ev) => {
      if (!dragRef.current) return;
      if (!dragRef.current._initialized) {
        dragRef.current.panX = panRef.current.x;
        dragRef.current.panY = panRef.current.y;
        dragRef.current._initialized = true;
      }
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
    setP(merged);
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

  // ---- Export ----
  const exportSVG = useCallback(() => {
    const live = svgWrapRef.current?.querySelector('svg');
    if (!live) return;
    const clone = live.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', params.width);
    clone.setAttribute('height', params.height);
    clone.removeAttribute('style');
    const xml = new XMLSerializer().serializeToString(clone);
    const blob = new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + xml], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `dial-${params.shape}.svg`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [params]);

  const exportPNG = useCallback(() => {
    const live = svgWrapRef.current?.querySelector('svg');
    if (!live) return;
    const clone = live.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', params.width);
    clone.setAttribute('height', params.height);
    clone.removeAttribute('style');
    const xml = new XMLSerializer().serializeToString(clone);
    const svg64 = btoa(unescape(encodeURIComponent('<?xml version="1.0" encoding="UTF-8"?>\n' + xml)));
    const img = new Image();
    img.onload = () => {
      const scale = 2;
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
        const url = URL.createObjectURL(b);
        const a = document.createElement('a');
        a.href = url; a.download = `dial-${params.shape}@2x.png`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }, 'image/png');
    };
    img.src = 'data:image/svg+xml;base64,' + svg64;
  }, [params]);

  const reset = () => setP(DEFAULTS);

  return (
    <div className="app">
      <aside className="side">
        <div className="brand">
          <h1>Dials</h1>
          <span className="v mono">v1.0</span>
        </div>

        <Sec title="Shape">
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
            <div style={{ marginTop: 12 }}>
              <div className="row">
                <label>Orientation</label>
                <Seg
                  options={[{ value: 'horizontal', label: 'Horiz.' }, { value: 'vertical', label: 'Vert.' }]}
                  value={p.orientation}
                  onChange={(v) => {
                    if (v === p.orientation) return;
                    // Swap canvas dimensions so the dial fits the new orientation
                    setMany({ orientation: v, width: p.height, height: p.width });
                  }}
                />
              </div>
              <div className="row" style={{ marginTop: 8 }}>
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
            <div style={{ marginTop: 12 }}>
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
            <div style={{ marginTop: 4 }}>
              <div className="row">
                <label>Ticks</label>
                <Seg
                  options={[
                    { value: 'inward', label: 'Inward' },
                    { value: 'outward', label: 'Outward' },
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

          <div className="row" style={{ marginTop: 10 }}>
            <label>Reverse direction</label>
            <Toggle checked={p.reverse} onChange={(v) => set('reverse', v)} />
          </div>
        </Sec>

        <Sec title="Range">
          <div className="grid-2">
            <NumField label="Min" value={p.min} onChange={(v) => set('min', v)} />
            <NumField label="Max" value={p.max} onChange={(v) => set('max', v)} />
          </div>
        </Sec>

        <Sec title="Graduations">
          <div className="grid-2">
            <NumField
              label="Major step"
              value={p.majorStep} step={p.majorStep < 1 ? 0.1 : 1}
              onChange={(v) => set('majorStep', Math.max(0.0001, Number(v) || 0.0001))}
            />
            <NumField
              label="Subdivisions"
              value={p.subdivisions} step={1}
              onChange={(v) => set('subdivisions', Math.max(0, Math.round(Number(v) || 0)))}
            />
          </div>
          <p className="hint" style={{ marginTop: -2 }}>Subdivisions = minor ticks between adjacent majors. 0 hides them.</p>
          <Slider label="Major length" value={p.majorLen} min={2} max={60} step={1} onChange={(v) => set('majorLen', v)} suffix="px" />
          <Slider label="Minor length" value={p.minorLen} min={1} max={40} step={1} onChange={(v) => set('minorLen', v)} suffix="px" />
          <Slider label="Major weight" value={p.majorWeight} min={0.5} max={8} step={0.5} onChange={(v) => set('majorWeight', v)} suffix="px" />
          <Slider label="Minor weight" value={p.minorWeight} min={0.25} max={5} step={0.25} onChange={(v) => set('minorWeight', v)} suffix="px" />
        </Sec>

        <Sec title="Rim">
          <div className="row">
            <label>Rim</label>
            <Toggle checked={p.rim} onChange={(v) => set('rim', v)} />
          </div>
          {p.rim && (
            <Slider label="Thickness" value={p.rimThickness} min={0.5} max={12} step={0.5} onChange={(v) => set('rimThickness', v)} suffix="px" />
          )}
        </Sec>

        <Sec title="Numbers">
          <div className="row">
            <label>Show numbers</label>
            <Toggle checked={p.showNumbers} onChange={(v) => set('showNumbers', v)} />
          </div>
          {p.showNumbers && (
            <>
              <Slider label="Size" value={p.numberSize} min={6} max={48} step={1} onChange={(v) => set('numberSize', v)} suffix="px" />
              <Slider label="Offset" value={p.numberOffset} min={0} max={40} step={1} onChange={(v) => set('numberOffset', v)} suffix="px" />
              <Slider label="Weight" value={p.numberWeight} min={100} max={900} step={100} onChange={(v) => set('numberWeight', v)} />
              <div className="grid-2" style={{ marginTop: 8 }}>
                <TextField label="Suffix" value={p.numberSuffix} placeholder="° % mph" onChange={(v) => set('numberSuffix', v)} />
              </div>
              <div className="field" style={{ marginTop: 8 }}>
                <label>Custom labels</label>
                <input
                  className="num mono"
                  type="text"
                  value={p.customLabels}
                  placeholder="e.g. L, M, H"
                  style={{ width: '100%', textAlign: 'left' }}
                  onChange={(e) => set('customLabels', e.target.value)}
                />
              </div>
              <p className="hint">Comma-separated, one per major tick. Leave an entry blank to keep the numeric value at that position.</p>
            </>
          )}
        </Sec>

        {isArc && (
          <Sec title="Title">
            <div className="field">
              <label>Center text</label>
              <input
                className="num mono"
                type="text"
                value={p.centerText}
                placeholder="e.g. RPM × 1000"
                style={{ width: '100%', textAlign: 'left' }}
                onChange={(e) => set('centerText', e.target.value)}
              />
            </div>
            {p.centerText && (
              <>
                <Slider label="Size" value={p.centerTextSize} min={8} max={96} step={1} onChange={(v) => set('centerTextSize', v)} suffix="px" />
                <Slider label="Weight" value={p.centerTextWeight} min={100} max={900} step={100} onChange={(v) => set('centerTextWeight', v)} />
              </>
            )}
            <p className="hint">Rendered at the dial's pivot. For a semi-circle this sits at the bottom of the arc; for a full circle, the geometric centre.</p>
          </Sec>
        )}

        <Sec title="Canvas">
          <div className="grid-2">
            <NumField label="Width"  value={p.width}  onChange={(v) => set('width',  Math.max(80, Number(v) || 80))} />
            <NumField label="Height" value={p.height} onChange={(v) => set('height', Math.max(80, Number(v) || 80))} />
          </div>
          <div className="row" style={{ marginTop: 10 }}>
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
          <div className="row" style={{ marginTop: 10 }}>
            <label>Invert (white on black)</label>
            <Toggle checked={p.invert} onChange={(v) => set('invert', v)} />
          </div>
        </Sec>

        <Sec title="Presets">
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
          <div className="btn-row">
            <button className="btn" onClick={exportSVG}>Download SVG</button>
            <button className="btn alt" onClick={exportPNG}>Download PNG</button>
          </div>
          <div className="btn-row" style={{ marginTop: 8 }}>
            <button className="btn alt" onClick={reset} style={{ gridColumn: '1 / -1' }}>Reset to defaults</button>
          </div>
          <p className="hint">PNG exports at 2× the canvas resolution. SVG is scalable and editable in any vector tool.</p>
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
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
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
