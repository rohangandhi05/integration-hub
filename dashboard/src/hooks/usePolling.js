import { useState, useEffect, useCallback, useRef } from 'react';

export function usePolling(fn, intervalMs = 5000, immediate = true) {
  const [data, setData]     = useState(null);
  const [error, setError]   = useState(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const execute = useCallback(async () => {
    try {
      const result = await fnRef.current();
      setData(result);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (immediate) execute();
    const id = setInterval(execute, intervalMs);
    return () => clearInterval(id);
  }, [execute, intervalMs, immediate]);

  return { data, error, loading, refresh: execute };
}

export function useOnce(fn) {
  const [data, setData]     = useState(null);
  const [error, setError]   = useState(null);
  const [loading, setLoading] = useState(true);

  const execute = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fn());
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { execute(); }, [execute]);
  return { data, error, loading, refresh: execute };
}
