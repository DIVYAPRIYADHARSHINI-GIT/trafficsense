// API client with Render cold-start handling and an offline fallback.
//
//  * VITE_API_URL points at the FastAPI backend (default http://localhost:8000).
//  * Render's free tier sleeps after 15 min idle and takes up to ~1 min to wake. The
//    first request therefore waits (with a friendly banner) and retries automatically.
//  * If the backend still can't be reached, read-only data is served from the
//    precomputed JSON in public/data/ and an "Offline mode" badge is shown. A
//    background probe keeps checking and switches back to live data when it wakes.
import { offlineApi } from './lib/offline';

export const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '');
const OFFLINE_ONLY = import.meta.env.VITE_OFFLINE_ONLY === '1';

const REQUEST_TIMEOUT_MS = 20000;   // a single attempt
const WAKE_DEADLINE_MS = 75000;     // total time we keep trying before going offline
const RETRY_DELAY_MS = 3000;
const OFFLINE_PROBE_MS = 15000;     // how often to re-check the backend while offline
const PATIENCE_MS = 8000;           // while waking, show saved data after this long
const OFFLINE_MEMORY_MS = 3 * 60 * 1000; // remember "offline" across page reloads
const OFFLINE_KEY = 'ts-offline-at';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// --------------------------------------------------------- connection state
// status: 'connecting' (first contact) | 'waking' (slow / retrying) | 'online' | 'offline'
// servedOffline: some on-screen data came from the offline JSON and should be refreshed
// once the live backend answers.
function recentlyOffline() {
  try {
    const at = Number(sessionStorage.getItem(OFFLINE_KEY));
    return at && Date.now() - at < OFFLINE_MEMORY_MS;
  } catch {
    return false;
  }
}
let state = {
  status: OFFLINE_ONLY || recentlyOffline() ? 'offline' : 'connecting',
  since: Date.now(),
  attempts: 0,
  servedOffline: false,
};
const listeners = new Set();
function setState(patch) {
  const next = { ...state, ...patch };
  if (next.status !== state.status) next.since = Date.now();
  if (next.status !== state.status) {
    try {
      if (next.status === 'offline') sessionStorage.setItem(OFFLINE_KEY, String(Date.now()));
      else if (next.status === 'online') sessionStorage.removeItem(OFFLINE_KEY);
    } catch {
      /* ignore */
    }
  }
  state = next;
  listeners.forEach((fn) => fn(state));
}
export const connection = {
  get: () => state,
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  retryNow: () => wake(true),
  /** Called by the UI after it refetched live data. */
  markRefreshed: () => setState({ servedOffline: false }),
};

// ----------------------------------------------------------------- transport
function describe(detail) {
  if (!detail) return null;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d) => `${(d.loc || []).filter((p) => p !== 'body' && p !== 'query').join('.')}: ${d.msg}`)
      .join('; ');
  }
  return JSON.stringify(detail);
}

function buildUrl(path, params) {
  let url = `${API_URL}${path}`;
  if (params) {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
    });
    const s = qs.toString();
    if (s) url += `?${s}`;
  }
  return url;
}

class NetworkError extends Error {}

/** One HTTP attempt. Network failures, timeouts and 502/503/504 (Render waking) are retryable. */
async function attempt(url, options, timeout = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let response;
  try {
    response = await fetch(url, { ...options, signal: controller.signal });
  } catch {
    throw new NetworkError('unreachable');
  } finally {
    clearTimeout(timer);
  }
  if ([502, 503, 504].includes(response.status)) throw new NetworkError(`status ${response.status}`);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) throw new ApiError(describe(body?.detail) || `Request failed (${response.status})`, response.status);
  return body;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A single shared "wake up" loop so many concurrent page requests don't each retry.
let wakePromise = null;
let probeTimer = null;
function wake(force = false) {
  if (OFFLINE_ONLY) return Promise.resolve(false);
  if (wakePromise && !force) return wakePromise;
  clearTimeout(probeTimer);
  wakePromise = (async () => {
    const started = Date.now();
    let tries = 0;
    if (state.status === 'offline') setState({ status: 'waking' });
    while (Date.now() - started < WAKE_DEADLINE_MS) {
      tries += 1;
      setState({ attempts: tries });
      const slowTimer = setTimeout(() => state.status === 'connecting' && setState({ status: 'waking' }), 2500);
      try {
        const health = await attempt(`${API_URL}/api/health`, {}, REQUEST_TIMEOUT_MS);
        clearTimeout(slowTimer);
        if (health?.status === 'ok') {
          setState({ status: 'online' });
          return true;
        }
      } catch {
        clearTimeout(slowTimer);
      }
      setState({ status: 'waking' });
      await sleep(RETRY_DELAY_MS);
    }
    setState({ status: 'offline' });
    scheduleProbe();
    return false;
  })().finally(() => {
    wakePromise = null;
  });
  return wakePromise;
}

function scheduleProbe() {
  if (OFFLINE_ONLY) return;
  clearTimeout(probeTimer);
  probeTimer = setTimeout(async () => {
    try {
      const health = await attempt(`${API_URL}/api/health`, {}, 10000);
      if (health?.status === 'ok') {
        setState({ status: 'online' });
        return;
      }
    } catch {
      /* still offline */
    }
    scheduleProbe();
  }, OFFLINE_PROBE_MS);
}
// Reloaded while recently offline: render saved data immediately, keep probing quietly.
if (state.status === 'offline' && !OFFLINE_ONLY) {
  setTimeout(async () => {
    try {
      const health = await attempt(`${API_URL}/api/health`, {}, 10000);
      if (health?.status === 'ok') return setState({ status: 'online' });
    } catch {
      /* still offline */
    }
    return scheduleProbe();
  }, 500);
}

const PATIENCE = Symbol('patience');

async function serveOffline(offline) {
  try {
    const body = await offline();
    if (!state.servedOffline) setState({ servedOffline: true });
    return body;
  } catch (err) {
    throw new ApiError(err.message || String(err), err.status || 0);
  }
}

/**
 * Call the live backend; on network trouble wait for it to wake, then fall back to
 * `offline()` (if provided). Write operations pass no fallback and surface an error.
 */
async function call(path, { params, offline, ...options } = {}) {
  const url = buildUrl(path, params);
  if (state.status !== 'offline') {
    try {
      const body = await attempt(url, options);
      if (state.status !== 'online') setState({ status: 'online' });
      return body;
    } catch (err) {
      if (!(err instanceof NetworkError)) throw err;
    }
    // Backend unreachable or still booting: wait for the shared wake loop, then retry once.
    // Read-only calls don't block for the whole cold start: after PATIENCE_MS they show the
    // saved data while the wake loop keeps going; the UI refreshes once the server is up.
    const waking = wake();
    const outcome = offline
      ? await Promise.race([waking, sleep(PATIENCE_MS).then(() => PATIENCE)])
      : await waking;
    if (outcome === PATIENCE) return serveOffline(offline);
    if (outcome) {
      try {
        return await attempt(url, options);
      } catch (err) {
        if (!(err instanceof NetworkError)) throw err;
        setState({ status: 'offline' });
        scheduleProbe();
      }
    }
  }
  if (offline) return serveOffline(offline);
  throw new ApiError(
    'The live server is offline, so this action is unavailable. Offline mode can show the dashboards, '
      + 'predictions and best travel times from precomputed data.',
    0,
  );
}

const json = (payload) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

export const api = {
  meta: () => call('/api/meta', { offline: () => offlineApi.meta() }),
  summary: () => call('/api/summary', { offline: () => offlineApi.summary() }),
  trends: (granularity = 'daily', road) =>
    call('/api/trends', { params: { granularity, road }, offline: () => offlineApi.trends(granularity, road) }),
  heatmap: (road, metric = 'vehicle_count') =>
    call('/api/heatmap', { params: { road, metric }, offline: () => offlineApi.heatmap(road, metric) }),
  insights: (road) => call('/api/insights', { params: { road }, offline: () => offlineApi.insights(road) }),
  predict: (payload) => call('/api/predict', { ...json(payload), offline: () => offlineApi.predict(payload) }),
  bestTime: (params) => call('/api/best-time', { params, offline: () => offlineApi.bestTime(params) }),
  modelMetrics: () => call('/api/model-metrics', { offline: () => offlineApi.modelMetrics() }),
  upload: (file, mode = 'replace') => {
    const form = new FormData();
    form.append('file', file);
    form.append('mode', mode);
    return call('/api/upload', { method: 'POST', body: form });
  },
  reset: () => call('/api/reset', { method: 'POST' }),
  templateUrl: () => `${API_URL}/api/sample-csv`,
  datasetUrl: () => `${API_URL}/api/dataset.csv`,
};
