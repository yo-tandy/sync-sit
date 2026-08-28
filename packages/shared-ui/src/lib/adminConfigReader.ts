import { useState, useEffect } from 'react';
/**
 * Client-side reader for the admin-configurable parameters (issue #250) --
 * ONE implementation for both apps (round-3 review: the copy-per-app twins
 * were drifting risks). Each app instantiates the factory with its own
 * firestore handle; the fallback semantics mirror the server getter
 * exactly: absent doc, absent key, read error (async OR synchronous --
 * mock-shaped test environments throw at call time), non-integer, or
 * out-of-bounds values all resolve to the caller's default, and one fetch
 * is shared per page load.
 */
export interface AdminConfigReader {
  getClientConfigValue(
    key: string,
    fallback: number,
    bounds: { min: number; max: number },
  ): Promise<number>;
  /** React convenience: the configured value as state (fallback until it resolves). */
  useClientConfigValue(
    key: string,
    fallback: number,
    bounds: { min: number; max: number },
  ): number;
  __resetAdminConfigClientCacheForTests(): void;
}

type GetDocFn = () => Promise<{ data(): Record<string, unknown> | undefined }>;

export function createAdminConfigReader(fetchDoc: GetDocFn): AdminConfigReader {
  let fetchPromise: Promise<Record<string, unknown>> | null = null;

  function fetchValues(): Promise<Record<string, unknown>> {
    if (!fetchPromise) {
      try {
        fetchPromise = fetchDoc()
          .then((snap) => snap.data() ?? {})
          .catch(() => ({}));
      } catch {
        fetchPromise = Promise.resolve({});
      }
    }
    return fetchPromise;
  }

  async function getClientConfigValue(
    key: string,
    fallback: number,
    bounds: { min: number; max: number },
  ): Promise<number> {
    const values = await fetchValues();
    const v = values[key];
    return typeof v === 'number' && Number.isInteger(v) && v >= bounds.min && v <= bounds.max
      ? v
      : fallback;
  }

  return {
    getClientConfigValue,
    // Lives on the factory so the hook exists ONCE (round-7 review: the
    // per-app adminConfigClient files had drifted into byte-identical
    // twins of it).
    useClientConfigValue(key, fallback, bounds) {
      const [value, setValue] = useState<number>(fallback);
      useEffect(() => {
        let cancelled = false;
        void getClientConfigValue(key, fallback, bounds)
          .then((v) => {
            if (!cancelled) setValue(v);
          })
          .catch(() => {});
        return () => {
          cancelled = true;
        };
        // bounds is a fresh object literal at most call sites -- keying the
        // effect on it would refetch every render.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [key, fallback]);
      return value;
    },
    __resetAdminConfigClientCacheForTests() {
      fetchPromise = null;
    },
  };
}
