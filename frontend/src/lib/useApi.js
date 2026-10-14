import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from './AppContext';

/**
 * Fetch data from the backend and refetch when `deps` (or the dataset) change.
 * Stale responses from superseded requests are ignored.
 */
export function useApi(fetcher, deps = []) {
  const { dataVersion } = useApp();
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const requestId = useRef(0);

  const run = useCallback(async () => {
    const id = ++requestId.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetcher();
      if (id === requestId.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (id === requestId.current) setState((s) => ({ ...s, error, loading: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, dataVersion]);

  useEffect(() => {
    run();
  }, [run]);

  return { ...state, reload: run };
}
