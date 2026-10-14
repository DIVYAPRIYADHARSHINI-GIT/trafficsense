import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, connection } from '../api';

// App-wide state: theme (light/dark), dataset metadata, backend connection status
// (connecting / waking / online / offline), and a `dataVersion` counter that bumps
// after an upload/reset - or when the backend comes back online - so every page
// refetches fresh data.
const AppContext = createContext(null);

function initialTheme() {
  try {
    const saved = localStorage.getItem('ts-theme');
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    /* ignore */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function AppProvider({ children }) {
  const [theme, setTheme] = useState(initialTheme);
  const [meta, setMeta] = useState(null);
  const [metaError, setMetaError] = useState(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [conn, setConn] = useState(connection.get());

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem('ts-theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  // Track the backend status. When it comes online after any offline data was shown
  // (fully offline, or saved data shown while the server was still waking), refetch live.
  useEffect(() => {
    let previous = connection.get();
    return connection.subscribe((next) => {
      setConn(next);
      const cameOnline = previous.status !== 'online' && next.status === 'online';
      if (cameOnline && (previous.status === 'offline' || next.servedOffline)) {
        connection.markRefreshed();
        setDataVersion((v) => v + 1);
      }
      previous = next;
    });
  }, []);

  const loadMeta = useCallback(async () => {
    try {
      setMeta(await api.meta());
      setMetaError(null);
    } catch (err) {
      setMetaError(err);
    }
  }, []);

  useEffect(() => {
    loadMeta();
  }, [loadMeta, dataVersion]);

  const value = useMemo(
    () => ({
      theme,
      isDark: theme === 'dark',
      toggleTheme: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
      meta,
      metaError,
      retryMeta: loadMeta,
      dataVersion,
      notifyDataChanged: () => setDataVersion((v) => v + 1),
      connection: conn,
      isOffline: conn.status === 'offline',
      retryConnection: connection.retryNow,
    }),
    [theme, meta, metaError, loadMeta, dataVersion, conn],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}
