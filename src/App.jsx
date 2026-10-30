import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import Dial from './Dial.jsx';
import { Slider, NumField, TextField, Seg, Toggle, NumericInput } from './Controls.jsx';
import { DEFAULTS, MAX_ZONES, clean, sanitizeParams, sanitizeZones, updateParams, readPresets, encodeHashState, decodeHashState } from './state.js';
import { FONTS, installFont } from './fonts.js';
import { buildExportSvg, downloadBlob, serializeSvg, rasterizeSvg } from './exports.js';
import { MAX_TICKS, tickCount } from './ticks.js';

// Preset shape configs
const SHAPE_PRESETS = {
  straight: { shape: 'straight', width: 800, height: 220, orientation: 'horizontal' },
  semi:     { shape: 'semi', width: 600, height: 380, startAngle: 180, sweepAngle: 180 },
  quarter:  { shape: 'arc', width: 480, height: 480, startAngle: 180, sweepAngle: 90 },
  arc270:   { shape: 'arc', width: 560, height: 560, startAngle: 135, sweepAngle: 270 },
  circle:   { shape: 'circle', width: 560, height: 560, startAngle: -90, sweepAngle: 360 },
};

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
      <h2><button
        className="section-head"
        onClick={toggle}
        type="button"
        aria-expanded={open}
      >
        <span className="chev" aria-hidden="true">▸</span>
        {title}
      </button></h2>
      {open && <div className="section-body">{children}</div>}
    </div>
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

function ColorBandEditor({
  zones, min, max, position, thickness,
  bandStart, bandEnd,
  onChangeZones, onChangePosition, onChangeThickness,
  onChangeBandStart, onChangeBandEnd,
}) {
  const span = Math.max(1e-9, max - min);
  const updateZone = (i, patch) => {
    const next = zones.map((z, idx) => (idx === i ? { ...z, ...patch } : z));
    onChangeZones(sanitizeZones(next, min, max));
  };
  const removeZone = (i) => {
    if (zones.length <= 1) return;
    const next = zones.filter((_, idx) => idx !== i).map(z => ({ ...z }));
    next[next.length - 1].endValue = max;
    onChangeZones(next);
  };
  const addZone = () => {
    if (zones.length >= MAX_ZONES) return;
    // Split the last zone in half.
    const lastIdx = zones.length - 1;
    const prev = lastIdx === 0 ? min : zones[lastIdx - 1].endValue;
    const mid = prev + (zones[lastIdx].endValue - prev) / 2;
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

      <div className="grid-2 gap-top">
        <NumField
          label="Start" min={min} max={bandEnd - span / 1e6}
          value={bandStart}
          onChange={(v) => onChangeBandStart(Math.max(min, Math.min(bandEnd, Number(v))))}
        />
        <NumField
          label="End" min={bandStart + span / 1e6} max={max}
          value={bandEnd}
          onChange={(v) => onChangeBandEnd(Math.max(bandStart, Math.min(max, Number(v))))}
        />
      </div>

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
            <NumericInput
              className="num mono band-end"
              aria-label={`Zone ${i + 1} end`}
              value={z.endValue}
              min={(i === 0 ? min : zones[i - 1].endValue) + span / 1e6}
              max={i === zones.length - 1 ? max : zones[i + 1].endValue - span / 1e6}
              step={1}
              disabled={i === zones.length - 1}
              title={i === zones.length - 1 ? 'Last zone always ends at max' : 'End value'}
              onChange={(value) => updateZone(i, { endValue: value })}
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
          aria-label="Colour band preset"
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

export default function App() {
  const [p, setP] = useState(() => {
    const fromHash = decodeHashState(window.location.hash.slice(1), DEFAULTS);
    return sanitizeParams(fromHash);
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
        setP(sanitizeParams(DEFAULTS));
        return;
      }
      const next = decodeHashState(hash, DEFAULTS);
      if (next) setP(sanitizeParams(next));
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => { installFont(p.fontFamily); }, [p.fontFamily]);

  const set = (k, v) => setP(prev => updateParams(prev, { [k]: v }));
  const setMany = (obj) => setP(prev => updateParams(prev, obj));

  const params = useMemo(() => clean(p), [p]);
  const majorCount = tickCount(params.min, params.max, params.majorStep);
  const minorCount = tickCount(params.min, params.max, params.minorStep);
  const tickStatus = majorCount > MAX_TICKS || minorCount > MAX_TICKS
    ? 'Tick limit reached. Increase the major step or reduce subdivisions.' : '';

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
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.0015);
    applyZoom(zoomRef.current * factor, { x: e.clientX, y: e.clientY });
  }, [applyZoom]);
  useEffect(() => {
    const stage = stageRef.current;
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  // Keep the current pan available when a new pointer drag begins.
  const panRef = useRef(pan);
  useEffect(() => { panRef.current = pan; }, [pan]);

  const onStagePointerDown = useCallback((e) => {
    if (e.button !== 0 || !e.isPrimary) return;
    if (e.target.closest('.zoom-ctl')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY,
      panX: panRef.current.x, panY: panRef.current.y,
    };
    setIsDragging(true);
    e.preventDefault();
  }, []);

  useEffect(() => {
    const onMove = (ev) => {
      if (!dragRef.current || ev.pointerId !== dragRef.current.pointerId) return;
      setPan({
        x: dragRef.current.panX + (ev.clientX - dragRef.current.startX),
        y: dragRef.current.panY + (ev.clientY - dragRef.current.startY),
      });
    };
    const onUp = (event) => {
      if (dragRef.current && event.pointerId === dragRef.current.pointerId) {
        dragRef.current = null;
        setIsDragging(false);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
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
      return readPresets(raw);
    } catch { return {}; }
  });
  const persistPresets = useCallback((modify) => {
    try {
      const next = modify(readPresets(localStorage.getItem(PRESET_KEY)));
      localStorage.setItem(PRESET_KEY, JSON.stringify(next));
      setPresets(next);
    } catch { window.alert('Presets could not be saved. Browser storage may be full or disabled.'); }
  }, []);
  useEffect(() => {
    const onStorage = event => { if (event.key === PRESET_KEY || event.key === null) setPresets(readPresets(event.newValue)); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const savePreset = useCallback(() => {
    const name = (window.prompt('Preset name') || '').trim();
    if (!name) return;
    if (Object.hasOwn(presets, name) && !window.confirm(`Overwrite preset "${name}"?`)) return;
    persistPresets(latest => ({ ...latest, [name]: sanitizeParams(p) }));
  }, [presets, p, persistPresets]);
  const loadPreset = useCallback((name) => {
    const saved = presets[name];
    if (!saved) return;
    setP(sanitizeParams(saved));
  }, [presets]);
  const deletePreset = useCallback((name) => {
    if (!window.confirm(`Delete preset "${name}"?`)) return;
    persistPresets(latest => {
      const next = { ...latest };
      delete next[name];
      return next;
    });
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
      const url = new URL(window.location.href);
      url.hash = encodeHashState(p, DEFAULTS);
      await navigator.clipboard.writeText(url.href);
      setLinkStatus('ok');
    } catch {
      setLinkStatus('error');
    }
    if (linkResetRef.current) clearTimeout(linkResetRef.current);
    linkResetRef.current = setTimeout(() => setLinkStatus('idle'), 1500);
  }, [p]);

  // ---- Export ----
  const [exportStatus, setExportStatus] = useState('');
  const [exportBusy, setExportBusy] = useState(false);
  const exportBusyRef = useRef(false);
  const [copyStatus, setCopyStatus] = useState('idle');
  const copyResetRef = useRef(null);
  const runExport = async (kind) => {
    if (exportBusyRef.current) return;
    exportBusyRef.current = true;
    setExportBusy(true);
    setExportStatus('Preparing export…');
    try {
      // Clone synchronously so changing controls during the export cannot mix states.
      const result = buildExportSvg(svgWrapRef.current?.querySelector('svg'), params);
      if (kind === 'copy') {
        if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
          const data = result.then(svg => new Blob([serializeSvg(svg)], { type: 'text/plain' }));
          await Promise.all([result, navigator.clipboard.write([new ClipboardItem({ 'text/plain': data })])]);
        } else {
          await navigator.clipboard.writeText(serializeSvg(await result));
        }
        setCopyStatus('ok');
        clearTimeout(copyResetRef.current);
        copyResetRef.current = setTimeout(() => setCopyStatus('idle'), 1500);
      } else if (kind === 'png') {
        const blob = await rasterizeSvg(await result, params);
        downloadBlob(blob, `dial-${params.shape}@${params.pngScale}x.png`);
      } else {
        downloadBlob(new Blob([serializeSvg(await result)], { type: 'image/svg+xml' }), `dial-${params.shape}.svg`);
      }
      setExportStatus(kind === 'copy' ? 'SVG copied.' : 'Export ready.');
    } catch (error) {
      setExportStatus(error.message || 'Export failed. Please try again.');
      if (kind === 'copy') setCopyStatus('error');
    } finally {
      exportBusyRef.current = false;
      setExportBusy(false);
    }
  };
  useEffect(() => () => {
    clearTimeout(linkResetRef.current);
    clearTimeout(copyResetRef.current);
  }, []);
  const exportSVG = () => runExport('svg');
  const exportPNG = () => runExport('png');
  const copySVG = () => runExport('copy');

  const reset = () => setP(sanitizeParams(DEFAULTS));

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
            <Toggle label="Reverse direction" checked={p.reverse} onChange={(v) => set('reverse', v)} />
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
              label="Major step" min={0.0001} max={1e9}
              value={p.majorStep} step={p.majorStep < 1 ? 0.1 : 1}
              onChange={(v) => set('majorStep', Math.min(1e9, Math.max(0.0001, Number(v) || 0.0001)))}
            />
            <NumField
              label="Subdivisions" min={0} max={100} integer
              value={p.subdivisions} step={1}
              onChange={(v) => set('subdivisions', Math.min(100, Math.max(0, Math.round(Number(v) || 0))))}
            />
          </div>
          <p className="hint">Subdivisions = minor ticks between adjacent majors. 0 hides them.</p>
          <div className="hint tick-status" role="status">{tickStatus}</div>
          <Slider label="Major length" value={p.majorLen} min={2} max={60} step={1} onChange={(v) => set('majorLen', v)} suffix="px" />
          <Slider label="Minor length" value={p.minorLen} min={1} max={40} step={1} onChange={(v) => set('minorLen', v)} suffix="px" />
          <Slider label="Major weight" value={p.majorWeight} min={0.5} max={8} step={0.5} onChange={(v) => set('majorWeight', v)} suffix="px" />
          <Slider label="Minor weight" value={p.minorWeight} min={0.25} max={5} step={0.25} onChange={(v) => set('minorWeight', v)} suffix="px" />
          <Slider label="Corner radius" value={p.tickCornerRadius} min={0} max={100} step={1} onChange={(v) => set('tickCornerRadius', v)} suffix="%" />
          {p.tickCornerRadius > 0 && (
            <div className="row gap-top">
              <label>Round both ends</label>
              <Toggle label="Round both ends" checked={p.tickRoundBoth} onChange={(v) => set('tickRoundBoth', v)} />
            </div>
          )}
        </Sec>

        <Sec id="rim" title="Rim">
          <div className="row">
            <label>Rim</label>
            <Toggle label="Rim" checked={p.rim} onChange={(v) => set('rim', v)} />
          </div>
          {p.rim && (
            <Slider label="Thickness" value={p.rimThickness} min={0.5} max={12} step={0.5} onChange={(v) => set('rimThickness', v)} suffix="px" />
          )}
        </Sec>

        <Sec id="colorband" title="Colour band">
          <div className="row">
            <label>Show band</label>
            <Toggle label="Show band" checked={p.colorBandEnabled} onChange={(v) => set('colorBandEnabled', v)} />
          </div>
          {p.colorBandEnabled && (
            <ColorBandEditor
              zones={p.colorBandZones}
              min={p.min}
              max={p.max}
              position={p.colorBandPosition}
              thickness={p.colorBandThickness}
              bandStart={p.colorBandStart}
              bandEnd={p.colorBandEnd}
              onChangeZones={(zones) => set('colorBandZones', zones)}
              onChangePosition={(v) => set('colorBandPosition', v)}
              onChangeThickness={(v) => set('colorBandThickness', v)}
              onChangeBandStart={(v) => set('colorBandStart', v)}
              onChangeBandEnd={(v) => set('colorBandEnd', v)}
            />
          )}
        </Sec>

        <Sec id="typography" title="Typography">
          <div className="row">
            <label>Font</label>
            <select
              className="select mono"
              aria-label="Font"
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
            <Toggle label="Show numbers" checked={p.showNumbers} onChange={(v) => set('showNumbers', v)} />
          </div>
          {p.showNumbers && (
            <>
              <Slider label="Size" value={p.numberSize} min={6} max={48} step={1} onChange={(v) => set('numberSize', v)} suffix="px" />
              <Slider label="Offset" value={p.numberOffset} min={0} max={40} step={1} onChange={(v) => set('numberOffset', v)} suffix="px" />
              <Slider label="Weight" value={p.numberWeight} min={100} max={900} step={100} onChange={(v) => set('numberWeight', v)} />
              <div className="grid-2 gap-top">
                <TextField maxLength={32} label="Suffix" value={p.numberSuffix} placeholder="° % mph" onChange={(v) => set('numberSuffix', v)} />
              </div>
              <div className="gap-top">
                <TextField maxLength={1024} label="Custom labels" value={p.customLabels} placeholder="e.g. L, M, H" wide onChange={(v) => set('customLabels', v)} />
              </div>
              <p className="hint">Comma-separated, one per major tick. Leave an entry blank to keep the numeric value at that position.</p>
            </>
          )}
        </Sec>

        {isArc && (
          <Sec id="center" title="Center">
            <div className="row">
              <label>Hub dot</label>
              <Toggle label="Hub dot" checked={p.centerDot} onChange={(v) => set('centerDot', v)} />
            </div>
            {p.centerDot && (
              <Slider label="Hub size" value={p.centerDotSize} min={1} max={80} step={1} onChange={(v) => set('centerDotSize', v)} suffix="px" />
            )}

            <div className="gap-top">
              <TextField maxLength={256} label="Title text" value={p.centerText} placeholder="e.g. RPM × 1000" wide onChange={(v) => set('centerText', v)} />
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
            <NumField label="Width" min={80} max={8192} integer value={p.width}  onChange={(v) => set('width',  Math.min(8192, Math.max(80, Math.round(Number(v) || 80))))} />
            <NumField label="Height" min={80} max={8192} integer value={p.height} onChange={(v) => set('height', Math.min(8192, Math.max(80, Math.round(Number(v) || 80))))} />
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
            <Toggle label="Invert (white on black)" checked={p.invert} onChange={(v) => set('invert', v)} />
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
            <label>Transparent PNG</label>
            <Toggle label="Transparent PNG" checked={p.pngTransparent} onChange={(v) => set('pngTransparent', v)} />
          </div>
          <div className="row gap-top">
            <label>Outline text on export</label>
            <Toggle label="Outline text on export" checked={p.outlineOnExport} onChange={(v) => set('outlineOnExport', v)} />
          </div>
          <p className="hint export-hint">{p.outlineOnExport
            ? 'Text becomes vector paths. Helvetica cannot be outlined; choose another font.'
            : 'Selected fonts are embedded in SVG and PNG exports.'}</p>
          <div className="export-status" role="status" aria-live="polite">{exportStatus}</div>
          <div className="btn-row gap-top">
            <button className="btn" disabled={exportBusy} onClick={exportSVG}>Download SVG</button>
            <button className="btn alt" disabled={exportBusy} onClick={exportPNG}>Download PNG</button>
          </div>
          <div className="btn-row gap-top-sm">
            <button className="btn alt full-row" disabled={exportBusy} onClick={copySVG}>
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
        onPointerDown={onStagePointerDown}
      >
        <div
          className={'stage-inner' + (params.bg === 'transparent' ? ' transparent' : '')}
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
