const nf = new Intl.NumberFormat('en-US');
const compactNf = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

export const fmt = (n) => (n === null || n === undefined || Number.isNaN(n) ? '-' : nf.format(Math.round(n)));
export const fmtCompact = (n) => (n === null || n === undefined ? '-' : compactNf.format(n));
export const fmtDec = (n, digits = 1) =>
  n === null || n === undefined ? '-' : Number(n).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
export const fmtPct = (n, digits = 0, signed = false) =>
  n === null || n === undefined ? '-' : `${signed && n > 0 ? '+' : ''}${Number(n).toFixed(digits)}%`;

export const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Local YYYY-MM-DD (avoids the UTC shift of toISOString). */
export function isoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function parseIsoDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function prettyDate(iso, opts = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) {
  if (!iso) return '-';
  return parseIsoDate(iso).toLocaleDateString('en-US', opts);
}

export const hourLabel = (h) => `${String(h).padStart(2, '0')}:00`;

export function hour12(h) {
  const suffix = h < 12 ? 'AM' : 'PM';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return `${hr} ${suffix}`;
}

export const hourRange12 = (h) => `${hour12(h)} - ${hour12((h + 1) % 24)}`;

export const HOURS = Array.from({ length: 24 }, (_, h) => h);
