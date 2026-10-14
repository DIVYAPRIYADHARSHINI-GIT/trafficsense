import { useEffect, useState } from 'react';
import { CloudOff, Loader2, RefreshCw, WifiOff } from 'lucide-react';
import { useApp } from '../lib/AppContext';

/** Seconds since the current status started (re-renders every second while waking). */
function useElapsed(since, active) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return Math.max(0, Math.round((now - since) / 1000));
}

/** Full-width banner while the free Render server is waking up, or while offline. */
export function ConnectionBanner() {
  const { connection, retryConnection } = useApp();
  const waking = connection.status === 'waking';
  const elapsed = useElapsed(connection.since, waking);

  if (waking) {
    const progress = Math.min(95, (elapsed / 60) * 100);
    return (
      <div className="mb-6 overflow-hidden rounded-2xl border border-brand-200 bg-brand-50 text-sm text-brand-900 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-100" role="status" aria-live="polite">
        <div className="flex items-start gap-3 p-4">
          <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-brand-600 dark:text-brand-300" aria-hidden />
          <div className="flex-1">
            <p className="font-semibold">Waking up the server, this can take up to a minute...</p>
            <p className="mt-0.5 text-brand-800/80 dark:text-brand-200/80">
              The free backend sleeps when nobody is using it. Retrying automatically ({elapsed}s, attempt {connection.attempts}).
              {connection.servedOffline && ' Meanwhile you are seeing saved data; it refreshes as soon as the server is up.'}
            </p>
          </div>
        </div>
        <div className="h-1 bg-brand-100 dark:bg-brand-500/20">
          <div className="h-full bg-gradient-to-r from-brand-500 to-blue-500 transition-[width] duration-1000" style={{ width: `${progress}%` }} />
        </div>
      </div>
    );
  }

  if (connection.status === 'offline') {
    return (
      <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100" role="status">
        <p className="flex items-start gap-2">
          <CloudOff className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <span>
            <span className="font-semibold">Offline mode.</span> The live server is unavailable, so TrafficSense is showing precomputed data and
            predictions from the bundled 6-month dataset. Uploading CSVs needs the live server. It keeps retrying in the background.
          </span>
        </p>
        <button type="button" className="btn-ghost shrink-0" onClick={retryConnection}>
          <RefreshCw className="h-4 w-4" aria-hidden /> Retry now
        </button>
      </div>
    );
  }
  return null;
}

/** Small pill for the navbar. */
export function OfflineBadge() {
  const { connection, retryConnection } = useApp();
  if (connection.status !== 'offline' && connection.status !== 'waking') return null;
  const offline = connection.status === 'offline';
  return (
    <button
      type="button"
      onClick={retryConnection}
      title={offline ? 'Showing precomputed data. Click to retry the live server.' : 'Waking up the live server...'}
      className={`chip ring-1 ring-inset ${
        offline
          ? 'bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/30'
          : 'bg-brand-50 text-brand-700 ring-brand-600/20 dark:bg-brand-500/10 dark:text-brand-300 dark:ring-brand-400/30'
      }`}
    >
      {offline ? <WifiOff className="h-3.5 w-3.5" aria-hidden /> : <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
      <span className="hidden sm:inline">{offline ? 'Offline mode' : 'Waking server'}</span>
      <span className="sm:hidden">{offline ? 'Offline' : 'Waking'}</span>
    </button>
  );
}
