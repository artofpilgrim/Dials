export const MAX_TICKS = 5000;

export function tickCount(min, max, step) {
  if (![min, max, step].every(Number.isFinite) || step <= 0 || max <= min) return 0;
  const ratio = (max - min) / step;
  if (!Number.isFinite(ratio)) return Infinity;
  return Math.floor(ratio + Number.EPSILON * Math.max(1, ratio) * 8) + 1;
}

export function buildTickValues(min, max, step) {
  const count = tickCount(min, max, step);
  if (!count || count > MAX_TICKS) return [];
  const ticks = [];
  const tolerance = Number.EPSILON * Math.max(Math.abs(min), Math.abs(max), step) * 8;
  for (let i = 0; i < count; i++) {
    let value = min + i * step;
    if (value > max + tolerance) break;
    if (Math.abs(value - max) <= tolerance) value = max;
    if (ticks.length && value <= ticks[ticks.length - 1]) continue;
    ticks.push(value);
  }
  return ticks;
}

function decimalPlaces(value) {
  const [mantissa, exponent = '0'] = String(value).toLowerCase().split('e');
  return Math.max(0, (mantissa.split('.')[1]?.length || 0) - Number(exponent));
}

export function labelPrecision(min, step) {
  return Math.min(12, Math.max(decimalPlaces(min), decimalPlaces(step)));
}

export function fmtNum(value, digits = 2) {
  // Numeric conversion removes trailing zeros and the floating-point '-0'.
  return String(Number(value.toFixed(digits)));
}
