export function text(value) {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

export function number(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function toStringArray(value) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
}

export function uniqueStrings(values) {
  return Array.from(new Set(values.map(String).map((item) => item.trim()).filter(Boolean)));
}

export function estimateTokens(value) {
  return Math.ceil(String(value || '').length / 3.5);
}

export function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
