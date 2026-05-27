import React from 'react';

// ============================================================
// Dial renderer — pure SVG, black & white.
// Supports: straight, semi-circle, circle, custom arc.
// ============================================================

function fmtNum(v, digits = 2) {
  if (Number.isInteger(v)) return String(v);
  const s = v.toFixed(digits);
  return s.replace(/\.?0+$/, '');
}

// Returns a (value, index) => string for the major tick label.
// Custom labels override the numeric value; an empty entry falls back to numeric.
function tickLabelFor(p) {
  const labels = (p.customLabels || '').split(',').map((s) => s.trim());
  const suffix = p.numberSuffix || '';
  return (v, i) => {
    if (i < labels.length && labels[i] !== '') return labels[i];
    return fmtNum(v) + suffix;
  };
}

// Widest major-tick label, in characters. Used to reserve enough canvas room
// for outside labels — a 3-char "140" or 4-char "KM/H" needs more horizontal
// headroom than a single digit. Approximate; the renderer doesn't measure
// real glyph widths.
function maxLabelChars(p, ticksMajor) {
  const label = tickLabelFor(p);
  let m = 0;
  for (let i = 0; i < ticksMajor.length; i++) {
    const s = label(ticksMajor[i], i);
    if (s.length > m) m = s.length;
  }
  return m;
}

// Hard ceiling on tick count so a misconfigured range/step can't freeze the
// browser. Picked well above any realistic dial; pathological values bail.
const MAX_TICKS = 5000;

// Renders a tick. cornerPct === 0 keeps the original <line> (byte-identical
// output, no path-rounding work). > 0 emits a rotated <path> so we can
// selectively round only the outer tip while keeping the rim-side short
// edge perfectly square — without that, with a thin rim the rounded end
// pinches in before meeting the rim and leaves a visible gap.
//
// flatSide names the endpoint that should stay flat (square):
//   'p1' — (x1,y1) is the rim-side end
//   'p2' — (x2,y2) is the rim-side end
//   'none' (default) — round both ends (used for straight ticks that
//     cross the axis when tickSide === 'both', where neither end is the
//     anchor).
function renderTick({ x1, y1, x2, y2, weight, color, cornerPct, flatSide = 'none', keyId }) {
  if (!cornerPct || cornerPct <= 0) {
    return (
      <line
        key={keyId}
        x1={x1} y1={y1}
        x2={x2} y2={y2}
        stroke={color}
        strokeWidth={weight}
        strokeLinecap="butt"
      />
    );
  }
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  const rx = Math.min(weight / 2, (cornerPct / 100) * (weight / 2));
  const halfLen = len / 2;
  const halfW = weight / 2;
  const roundP1 = flatSide !== 'p1';
  const roundP2 = flatSide !== 'p2';
  const hasStraightLong = rx < halfW;
  const f = (n) => n.toFixed(3);

  // Build a closed path in local coords (centred at origin, p1 at -halfLen,
  // p2 at +halfLen). Then translate + rotate into world coords.
  let d = roundP1
    ? `M ${f(-halfLen + rx)} ${f(-halfW)} `
    : `M ${f(-halfLen)} ${f(-halfW)} `;

  // Top edge → p2 end.
  if (roundP2) {
    d += `L ${f(halfLen - rx)} ${f(-halfW)} `;
    d += `A ${f(rx)} ${f(rx)} 0 0 1 ${f(halfLen)} ${f(-halfW + rx)} `;
    if (hasStraightLong) d += `L ${f(halfLen)} ${f(halfW - rx)} `;
    d += `A ${f(rx)} ${f(rx)} 0 0 1 ${f(halfLen - rx)} ${f(halfW)} `;
  } else {
    d += `L ${f(halfLen)} ${f(-halfW)} `;
    d += `L ${f(halfLen)} ${f(halfW)} `;
  }

  // Bottom edge → p1 end.
  if (roundP1) {
    d += `L ${f(-halfLen + rx)} ${f(halfW)} `;
    d += `A ${f(rx)} ${f(rx)} 0 0 1 ${f(-halfLen)} ${f(halfW - rx)} `;
    if (hasStraightLong) d += `L ${f(-halfLen)} ${f(-halfW + rx)} `;
    d += `A ${f(rx)} ${f(rx)} 0 0 1 ${f(-halfLen + rx)} ${f(-halfW)} `;
  } else {
    d += `L ${f(-halfLen)} ${f(halfW)} `;
    d += `L ${f(-halfLen)} ${f(-halfW)} `;
  }
  d += 'Z';

  return (
    <path
      key={keyId}
      d={d}
      fill={color}
      transform={`translate(${f(cx)} ${f(cy)}) rotate(${f(angle)})`}
    />
  );
}

export function buildTickValues(min, max, step) {
  const ticks = [];
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(step)) return ticks;
  if (step <= 0 || max <= min) return ticks;
  const expected = (max - min) / step;
  if (expected > MAX_TICKS) return ticks;

  // Loop on the integer index, not by accumulating step into v, so FP drift
  // doesn't compound and we round relative to min (not against zero).
  const span = max - min;
  const eps = step / 1e6;
  const count = Math.floor(span / step + eps);
  for (let i = 0; i <= count; i++) {
    ticks.push(min + i * step);
  }
  return ticks;
}

// ---- Straight dial ----
function StraightDial({ p, ticksMajor, ticksMinor }) {
  const {
    min, max, width, height,
    rim, rimThickness,
    tickColor, majorLen, minorLen, majorWeight, minorWeight,
    showNumbers, numberSize, numberOffset, numberWeight,
    tickSide,
    orientation,
    reverse,
    tickCornerRadius,
    tickRoundBoth,
    fontFamily,
    colorBandEnabled, colorBandThickness, colorBandPosition, colorBandZones,
  } = p;

  // Layout pad is a small fixed margin so the axis stays put no matter what
  // tick/number sizes the user picks — they're all cosmetic. Labels that
  // would otherwise overflow the canvas just clip (same contract as minor
  // ticks, and now matches the behaviour the user expects across the board).
  const pad = 16;
  const labelFor = tickLabelFor(p);

  const isV = orientation === 'vertical';
  const length = isV ? height - pad * 2 : width - pad * 2;
  const axisX0 = isV ? width / 2 : pad;
  const axisY0 = isV ? pad : height / 2;
  const axisX1 = isV ? width / 2 : width - pad;
  const axisY1 = isV ? height - pad : height / 2;

  const valueToPos = (v) => {
    const t0 = (v - min) / (max - min);
    const t = reverse ? 1 - t0 : t0;
    if (isV) return { x: axisX1, y: axisY0 + t * length };
    return { x: axisX0 + t * length, y: axisY0 };
  };

  const perp = (len, sign = 1) =>
    (isV ? { dx: sign * len, dy: 0 } : { dx: 0, dy: sign * len });

  const sides = tickSide === 'both' ? [-1, 1] : [tickSide === 'above' ? -1 : 1];

  // Extend the rim-side endpoint of every tick through the rim so endpoints
  // visually close the rim instead of leaving a notch.
  const rimExt = rim ? rimThickness / 2 : 0;

  const tickLine = (v, len, weight, key) => {
    const a = valueToPos(v);
    // `len` is the visible tick length past the rim edge, so the tick tip
    // sits at axis ± (rimExt + len). Otherwise a thicker rim would eat into
    // the tick and shrink its visible portion.
    if (tickCornerRadius > 0 && tickSide === 'both') {
      // sides='both' with rounding: single shape crossing the axis. Both
      // visible halves get `len` past the rim, so total length is
      // 2*(rimExt + len).
      const offPos = perp(rimExt + len, 1);
      const offNeg = perp(rimExt + len, -1);
      return renderTick({
        x1: a.x + offNeg.dx, y1: a.y + offNeg.dy,
        x2: a.x + offPos.dx, y2: a.y + offPos.dy,
        weight, color: tickColor, cornerPct: tickCornerRadius, flatSide: 'none', keyId: key,
      });
    }
    return sides.map((s) => {
      const off = perp(rimExt + len, s);
      const back = perp(rimExt, -s);
      // p1 (back-extension end) sits at the rim — keep its short edge flat
      // so the tick meets the rim line cleanly even with a thin rim. The
      // user can opt into pill-style ticks with `tickRoundBoth`.
      return renderTick({
        x1: a.x + back.dx, y1: a.y + back.dy,
        x2: a.x + off.dx, y2: a.y + off.dy,
        weight, color: tickColor, cornerPct: tickCornerRadius,
        flatSide: tickRoundBoth ? 'none' : 'p1',
        keyId: `${key}-${s}`,
      });
    });
  };

  // Colour band: one <rect> per zone, drawn beneath the ticks/rim.
  // Sits parallel to the axis on whichever side `colorBandPosition` picks.
  // 'outer' = same side as the ticks; 'inner' = opposite side.
  const renderBand = () => {
    if (!colorBandEnabled || !Array.isArray(colorBandZones) || colorBandZones.length === 0) return null;
    const primarySide = tickSide === 'above' ? -1 : 1;
    const bandSign = colorBandPosition === 'outer' ? primarySide : -primarySide;
    // Centre of band sits at `rimExt + thickness/2` from the axis so the
    // band's rim-side edge meets the rim with no gap.
    const bandOff = perp(rimExt + colorBandThickness / 2, bandSign);
    const segs = [];
    let prevEnd = min;
    for (let i = 0; i < colorBandZones.length; i++) {
      const zone = colorBandZones[i];
      const zStart = Math.max(min, prevEnd);
      const zEnd = Math.min(max, zone.endValue);
      prevEnd = zone.endValue;
      if (zEnd <= zStart) continue;
      const a = valueToPos(zStart);
      const b = valueToPos(zEnd);
      // Bounding box of the rect (with band thickness across the axis).
      const x = Math.min(a.x, b.x) + (isV ? bandOff.dx - colorBandThickness / 2 : 0);
      const y = Math.min(a.y, b.y) + (isV ? 0 : bandOff.dy - colorBandThickness / 2);
      const w = isV ? colorBandThickness : Math.abs(b.x - a.x);
      const h = isV ? Math.abs(b.y - a.y) : colorBandThickness;
      segs.push(
        <rect key={`band-${i}`} x={x} y={y} width={w} height={h} fill={zone.color} />
      );
    }
    return segs.length > 0 ? <g>{segs}</g> : null;
  };

  return (
    <g>
      {/* Colour band sits beneath everything else. */}
      {renderBand()}
      {/* Ticks first so the rim draws on top of any back-extension that
          would otherwise protrude past the rim's far edge. */}
      {ticksMinor.map((v, i) => tickLine(v, minorLen, minorWeight, `mi-${i}`))}
      {ticksMajor.map((v, i) => tickLine(v, majorLen, majorWeight, `mj-${i}`))}

      {rim && (
        <line
          x1={axisX0} y1={axisY0}
          x2={axisX1} y2={axisY1}
          stroke={tickColor}
          strokeWidth={rimThickness}
          strokeLinecap="butt"
        />
      )}

      {showNumbers && ticksMajor.map((v, i) => {
        const a = valueToPos(v);
        const side = tickSide === 'above' ? -1 : 1;
        // Labels sit `numberOffset` past the tick tip, which itself is at
        // (rimExt + majorLen) past the axis.
        const off = perp(rimExt + majorLen + numberOffset, side);
        const tx = a.x + off.dx;
        const ty = a.y + off.dy;
        return (
          <text
            key={`n-${i}`}
            x={tx} y={ty}
            fontFamily={fontFamily}
            fontSize={numberSize}
            fontWeight={numberWeight}
            fill={tickColor}
            textAnchor={isV ? (side === -1 ? 'end' : 'start') : 'middle'}
            dominantBaseline={isV ? 'middle' : (side === 1 ? 'hanging' : 'auto')}
            dy={isV ? 0 : (side === 1 ? 2 : -2)}
            dx={isV ? (side === -1 ? -4 : 4) : 0}
          >
            {labelFor(v, i)}
          </text>
        );
      })}
    </g>
  );
}

// ---- Arc dial (covers semi-circle, circle, custom arc) ----
function ArcDial({ p, ticksMajor, ticksMinor }) {
  const {
    width, height,
    rim, rimThickness,
    majorLen,
    showNumbers, numberSize, numberOffset,
    startAngle,
    sweepAngle,
    tickDirection,
    numberPlacement,
  } = p;

  const cx = width / 2;
  const isFullCircle = Math.abs(sweepAngle) >= 360 - 0.001;
  const cy = height / 2;

  // How far past the rim does the content reach? Used both as canvas headroom
  // for full circles (no shifting possible) and as bbox padding when fitting
  // a partial arc. Without this, outside labels / outward ticks on a custom
  // arc clip at the canvas edges because the bbox only sampled the rim.
  const ringExtra = rim ? rimThickness / 2 : 0;
  const charHalfWidth = numberSize * 0.3; // ~halfwidth of one char in a typical sans-serif
  const labelHalfWidth = showNumbers ? maxLabelChars(p, ticksMajor) * charHalfWidth : 0;
  const labelHalfHeight = showNumbers ? numberSize * 0.55 : 0;
  // Outside-label radial extent past the rim: tick (if outward) + offset +
  // gap between label center and rim + the larger of the label's half-extents
  // (worst case: a wide label sitting at the cardinal axis).
  const tickOutExt = (tickDirection === 'outward' || tickDirection === 'both') ? majorLen : 0;
  const outsideLabelExt = (showNumbers && numberPlacement === 'outside')
    ? tickOutExt + numberOffset + labelHalfHeight + Math.max(labelHalfWidth, labelHalfHeight) + 4
    : 0;
  // Full-circle inside labels at the cardinal points overhang the rim by
  // roughly their half-extent (text-anchor + dominant-baseline are both
  // 'middle', so the label sits centred on the radial position).
  const insideLabelExt = (isFullCircle && showNumbers && numberPlacement === 'inside')
    ? labelHalfHeight
    : 0;
  const outerExtra = ringExtra + 2 + Math.max(tickOutExt, outsideLabelExt, insideLabelExt);

  let r = Math.min(width, height) / 2 - outerExtra;
  r = Math.max(20, r);

  if (!isFullCircle) {
    // Center the visible bounding box of the arc.
    const samples = 64;
    const xs = [];
    const ys = [];
    for (let i = 0; i <= samples; i++) {
      const a = startAngle + (sweepAngle * i) / samples;
      const rad = (a * Math.PI) / 180;
      xs.push(Math.cos(rad) * r);
      ys.push(Math.sin(rad) * r);
    }
    const minX = Math.min(...xs) - outerExtra;
    const maxX = Math.max(...xs) + outerExtra;
    const minY = Math.min(...ys) - outerExtra;
    const maxY = Math.max(...ys) + outerExtra;
    const bbW = maxX - minX;
    const bbH = maxY - minY;
    const sx = (width - 2) / bbW;
    const sy = (height - 2) / bbH;
    const scale = Math.min(1, Math.min(sx, sy));
    if (scale < 1) {
      r = r * scale;
      for (let i = 0; i <= samples; i++) {
        const a = startAngle + (sweepAngle * i) / samples;
        const rad = (a * Math.PI) / 180;
        xs[i] = Math.cos(rad) * r;
        ys[i] = Math.sin(rad) * r;
      }
    }
    const newMinX = Math.min(...xs) - outerExtra;
    const newMaxX = Math.max(...xs) + outerExtra;
    const newMinY = Math.min(...ys) - outerExtra;
    const newMaxY = Math.max(...ys) + outerExtra;
    const cxBbox = (newMinX + newMaxX) / 2;
    const cyBbox = (newMinY + newMaxY) / 2;
    const shiftX = width / 2 - cxBbox;
    const shiftY = height / 2 - cyBbox;
    return (
      <g transform={`translate(${shiftX} ${shiftY})`}>
        <ArcDialBody
          p={p} ticksMajor={ticksMajor} ticksMinor={ticksMinor}
          cx={0} cy={0} r={r}
        />
      </g>
    );
  }

  return (
    <ArcDialBody
      p={p} ticksMajor={ticksMajor} ticksMinor={ticksMinor}
      cx={cx} cy={cy} r={r}
    />
  );
}

function ArcDialBody({ p, ticksMajor, ticksMinor, cx, cy, r }) {
  const {
    min, max,
    rim, rimThickness,
    tickColor, majorLen, minorLen, majorWeight, minorWeight,
    showNumbers, numberSize, numberOffset, numberWeight,
    startAngle, sweepAngle,
    tickDirection,
    numberPlacement,
    reverse,
    centerText, centerTextSize, centerTextWeight, centerTextOffset,
    centerDot, centerDotSize,
    tickCornerRadius,
    tickRoundBoth,
    fontFamily,
    colorBandEnabled, colorBandThickness, colorBandPosition, colorBandZones,
  } = p;

  const labelFor = tickLabelFor(p);
  const isFullCircle = Math.abs(sweepAngle) >= 360 - 0.001;
  const valueToAngle = (v) => {
    const t0 = (v - min) / (max - min);
    const t = reverse ? 1 - t0 : t0;
    return startAngle + t * sweepAngle;
  };
  const polar = (angleDeg, radius) => {
    const rad = (angleDeg * Math.PI) / 180;
    return { x: cx + Math.cos(rad) * radius, y: cy + Math.sin(rad) * radius };
  };

  // Extend the rim-side endpoint of each tick across the rim so arc endpoints
  // close cleanly instead of leaving a corner notch.
  const rimExt = rim ? rimThickness / 2 : 0;

  const goInward = tickDirection === 'inward' || tickDirection === 'both';
  const goOutward = tickDirection === 'outward' || tickDirection === 'both';
  const tickAt = (v, len, weight, key) => {
    const a = valueToAngle(v);
    // `len` is the visible length past the rim edge. For 'both', the tick
    // spans both sides; otherwise only the chosen side, with a small back-
    // extension into the rim band so the tick meets the rim cleanly.
    const inner = goInward ? r - rimExt - len : r - rimExt;
    const outer = goOutward ? r + rimExt + len : r + rimExt;
    const p1 = polar(a, inner);
    const p2 = polar(a, outer);
    // For 'inward', p2 sits at the rim (outer tip); for 'outward', p1 sits
    // at the rim (inner tip). For 'both', neither end is at the rim — both
    // are tips, so round both. `tickRoundBoth` overrides single-side ticks.
    let flatSide;
    if (tickDirection === 'both' || tickRoundBoth) flatSide = 'none';
    else flatSide = tickDirection === 'inward' ? 'p2' : 'p1';
    return renderTick({
      x1: p1.x, y1: p1.y,
      x2: p2.x, y2: p2.y,
      weight, color: tickColor, cornerPct: tickCornerRadius, flatSide, keyId: key,
    });
  };

  // Colour band: one arc per zone, drawn below the ticks/rim. The band's
  // rim-side edge sits at exactly the rim's outer (or inner) edge so there's
  // no gap; the rim draws on top so any sub-pixel overlap is covered.
  let bandEl = null;
  if (colorBandEnabled && Array.isArray(colorBandZones) && colorBandZones.length > 0) {
    const bandR = colorBandPosition === 'outer'
      ? r + rimExt + colorBandThickness / 2
      : r - rimExt - colorBandThickness / 2;
    const segs = [];
    let prevEnd = min;
    for (let i = 0; i < colorBandZones.length; i++) {
      const zone = colorBandZones[i];
      const zStart = Math.max(min, prevEnd);
      const zEnd = Math.min(max, zone.endValue);
      prevEnd = zone.endValue;
      if (zEnd <= zStart) continue;
      const a0 = valueToAngle(zStart);
      const a1 = valueToAngle(zEnd);
      const sweep = a1 - a0;
      const p0 = polar(a0, bandR);
      const p1 = polar(a1, bandR);
      const largeArc = Math.abs(sweep) > 180 ? 1 : 0;
      const sweepFlag = sweep >= 0 ? 1 : 0;
      const d = `M ${p0.x} ${p0.y} A ${bandR} ${bandR} 0 ${largeArc} ${sweepFlag} ${p1.x} ${p1.y}`;
      segs.push(
        <path
          key={`band-${i}`}
          d={d}
          stroke={zone.color}
          strokeWidth={colorBandThickness}
          fill="none"
          strokeLinecap="butt"
        />
      );
    }
    if (segs.length > 0) bandEl = <g>{segs}</g>;
  }

  let rimEl = null;
  if (rim) {
    if (isFullCircle) {
      rimEl = (
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={tickColor} strokeWidth={rimThickness} />
      );
    } else {
      const a0 = startAngle;
      const a1 = startAngle + sweepAngle;
      const p0 = polar(a0, r);
      const p1 = polar(a1, r);
      const largeArc = Math.abs(sweepAngle) > 180 ? 1 : 0;
      const sweepFlag = sweepAngle >= 0 ? 1 : 0;
      const d = `M ${p0.x} ${p0.y} A ${r} ${r} 0 ${largeArc} ${sweepFlag} ${p1.x} ${p1.y}`;
      rimEl = (
        <path d={d} fill="none" stroke={tickColor} strokeWidth={rimThickness} strokeLinecap="butt" />
      );
    }
  }

  return (
    <g>
      {/* Colour band sits beneath everything else so ticks and rim read on
          top of it. */}
      {bandEl}
      {/* Ticks first so the rim draws on top of any back-extension that
          would otherwise protrude past the rim's far edge. */}
      {ticksMinor.map((v, i) => tickAt(v, minorLen, minorWeight, `mi-${i}`))}
      {ticksMajor.map((v, i) => tickAt(v, majorLen, majorWeight, `mj-${i}`))}
      {rimEl}
      {showNumbers && ticksMajor.map((v, i) => {
        const a = valueToAngle(v);
        let rText;
        // Labels sit `numberOffset` past whichever edge they're outside of:
        // the rim itself, or the tick tip when the tick points the same way.
        if (numberPlacement === 'outside') {
          rText = r + rimExt + (goOutward ? majorLen : 0) + numberOffset + numberSize * 0.55;
        } else {
          rText = r - rimExt - (goInward ? majorLen : 0) - numberOffset - numberSize * 0.55;
        }
        const pt = polar(a, rText);
        return (
          <text
            key={`n-${i}`}
            x={pt.x} y={pt.y}
            fontFamily={fontFamily}
            fontSize={numberSize}
            fontWeight={numberWeight}
            fill={tickColor}
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {labelFor(v, i)}
          </text>
        );
      })}
      {centerDot && centerDotSize > 0 && (
        <circle cx={cx} cy={cy} r={centerDotSize} fill={tickColor} />
      )}
      {centerText && (
        <text
          x={cx} y={cy + (centerTextOffset || 0)}
          fontFamily={fontFamily}
          fontSize={centerTextSize}
          fontWeight={centerTextWeight}
          fill={tickColor}
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {centerText}
        </text>
      )}
    </g>
  );
}

export default function Dial({ params }) {
  const p = params;
  const { min, max, majorStep, minorStep } = p;

  // In full-circle mode the min and max values map to the same screen angle,
  // so a tick at `max` overlaps the tick at `min`. Drop it for both bands.
  const isFullCircle = p.shape !== 'straight'
    && Math.abs(p.sweepAngle) >= 360 - 0.001;
  const dropMax = (arr, step) => {
    if (!isFullCircle || arr.length === 0) return arr;
    const eps = step / 1e3;
    return Math.abs(arr[arr.length - 1] - max) < eps ? arr.slice(0, -1) : arr;
  };

  const ticksMajor = React.useMemo(
    () => dropMax(buildTickValues(min, max, majorStep), majorStep),
    [min, max, majorStep, isFullCircle],
  );
  const ticksMinorAll = React.useMemo(
    () => dropMax(buildTickValues(min, max, minorStep), minorStep),
    [min, max, minorStep, isFullCircle],
  );
  const ticksMinor = React.useMemo(() => {
    const eps = Math.min(majorStep, minorStep) / 1e3;
    return ticksMinorAll.filter((v) => !ticksMajor.some((m) => Math.abs(m - v) < eps));
  }, [ticksMinorAll, ticksMajor, majorStep, minorStep]);

  const inner = p.shape === 'straight'
    ? <StraightDial p={p} ticksMajor={ticksMajor} ticksMinor={ticksMinor} />
    : <ArcDial p={p} ticksMajor={ticksMajor} ticksMinor={ticksMinor} />;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${p.width} ${p.height}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ width: '100%', height: '100%', display: 'block' }}
      shapeRendering="geometricPrecision"
    >
      {p.bg !== 'transparent' && (
        <rect x="0" y="0" width={p.width} height={p.height} fill={p.bg} />
      )}
      {inner}
    </svg>
  );
}
