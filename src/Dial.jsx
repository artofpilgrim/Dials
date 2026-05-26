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

// Hard ceiling on tick count so a misconfigured range/step can't freeze the
// browser. Picked well above any realistic dial; pathological values bail.
const MAX_TICKS = 5000;

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
    return sides.map((s) => {
      const off = perp(len, s);
      const back = perp(rimExt, -s);
      return (
        <line
          key={`${key}-${s}`}
          x1={a.x + back.dx} y1={a.y + back.dy}
          x2={a.x + off.dx} y2={a.y + off.dy}
          stroke={tickColor}
          strokeWidth={weight}
          strokeLinecap="butt"
        />
      );
    });
  };

  return (
    <g>
      {rim && (
        <line
          x1={axisX0} y1={axisY0}
          x2={axisX1} y2={axisY1}
          stroke={tickColor}
          strokeWidth={rimThickness}
          strokeLinecap="butt"
        />
      )}

      {ticksMinor.map((v, i) => tickLine(v, minorLen, minorWeight, `mi-${i}`))}
      {ticksMajor.map((v, i) => tickLine(v, majorLen, majorWeight, `mj-${i}`))}

      {showNumbers && ticksMajor.map((v, i) => {
        const a = valueToPos(v);
        const side = tickSide === 'above' ? -1 : 1;
        const off = perp(majorLen + numberOffset, side);
        const tx = a.x + off.dx;
        const ty = a.y + off.dy;
        return (
          <text
            key={`n-${i}`}
            x={tx} y={ty}
            fontFamily="Helvetica, Arial, sans-serif"
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
    startAngle,
    sweepAngle,
  } = p;

  const cx = width / 2;
  const isFullCircle = Math.abs(sweepAngle) >= 360 - 0.001;
  const cy = height / 2;

  // Outer margin reserves only the rim's half-thickness plus a small slack,
  // so changing tick length or number size doesn't shrink the rim. Whatever
  // extends past the rim (outward ticks, outside labels) just clips if the
  // canvas is too small — same contract as the straight dial.
  const ringExtra = rim ? rimThickness / 2 : 0;
  const outerExtra = ringExtra + 2;

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

  const tickAt = (v, len, weight, key) => {
    const a = valueToAngle(v);
    const inner = tickDirection === 'inward' ? r - len : r - rimExt;
    const outer = tickDirection === 'inward' ? r + rimExt : r + len;
    const p1 = polar(a, inner);
    const p2 = polar(a, outer);
    return (
      <line
        key={key}
        x1={p1.x} y1={p1.y}
        x2={p2.x} y2={p2.y}
        stroke={tickColor}
        strokeWidth={weight}
        strokeLinecap="butt"
      />
    );
  };

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
      {rimEl}
      {ticksMinor.map((v, i) => tickAt(v, minorLen, minorWeight, `mi-${i}`))}
      {ticksMajor.map((v, i) => tickAt(v, majorLen, majorWeight, `mj-${i}`))}
      {showNumbers && ticksMajor.map((v, i) => {
        const a = valueToAngle(v);
        let rText;
        if (numberPlacement === 'outside') {
          rText = r + (tickDirection === 'outward' ? majorLen : 0) + numberOffset + numberSize * 0.55;
        } else {
          rText = r - (tickDirection === 'inward' ? majorLen : 0) - numberOffset - numberSize * 0.55;
        }
        const pt = polar(a, rText);
        return (
          <text
            key={`n-${i}`}
            x={pt.x} y={pt.y}
            fontFamily="Helvetica, Arial, sans-serif"
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
          fontFamily="Helvetica, Arial, sans-serif"
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
