import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/config/firebase';

/**
 * Client-side read of the admin-configurable parameters (issue #250).
 * One fetch per page load (module-level promise), fail-open to the code
 * default passed by the caller -- exactly the server getter's semantics:
 * absent doc, absent key, read error, non-integer or out-of-bounds values
 * all resolve to the default, so a rogue value can never distort the UI
 * beyond the key's sanctioned range.
 */
let fetchPromise: Promise<Record<string, unknown>> | null = null;

function fetchValues(): Promise<Record<string, unknown>> {
  if (!fetchPromise) {
    fetchPromise = getDoc(doc(db, 'adminConfig', 'values'))
      .then((snap) => snap.data() ?? {})
      .catch(() => ({}));
  }
  return fetchPromise;
}

export async function getClientConfigValue(
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

/** Test seam: drop the cached fetch. */
export function __resetAdminConfigClientCacheForTests(): void {
  fetchPromise = null;
}
