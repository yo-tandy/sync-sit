import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unit pin for the §11.4 prefix-erasure DELETE OPTIONS.
//
// Why here and not in the emulator suite: the thing under test is a race —
// an object must vanish BETWEEN `getFiles()` and the `file.delete()` that
// follows it. The integration suite calls a callable running inside the
// functions emulator, so it cannot reach in and remove an object mid-erasure;
// deleting it beforehand only means the listing never returns it and the
// `ignoreNotFound` path is never entered. (An earlier revision of this PR
// shipped exactly that test and it passed with the fix removed — the failure
// this file exists to prevent.)
//
// The mock encodes Google Cloud Storage's documented behaviour: `delete()`
// rejects with a 404 `ApiError` when the object is gone, UNLESS
// `ignoreNotFound: true` is passed. So "the object vanished mid-erasure" is
// modelled at the seam where it actually matters — the options each delete
// carries — rather than by trying to win a race.

const h = vi.hoisted(() => ({
  /** Object paths the erasure listed, per prefix query. */
  listed: [] as string[],
  /** Paths whose delete is told the object is already gone. */
  vanished: new Set<string>(),
  /** Paths whose delete fails with a non-404 (a Storage 5xx). */
  erroring: new Set<string>(),
  /** Options each delete actually received. */
  deleteOptions: [] as { path: string; options: Record<string, unknown> }[],
  /** Number of `getFiles` calls, to pin the single-listing property. */
  getFilesCalls: 0,
}));

/** An empty Firestore: this test is only about the Storage half. */
const emptySnap = { docs: [] as unknown[], empty: true, size: 0 };
const query: Record<string, unknown> = {};
query.where = () => query;
query.get = async () => emptySnap;

vi.mock('../../config/firebase.js', () => ({
  db: {
    collection: () => ({
      ...query,
      doc: () => ({ get: async () => ({ exists: false, data: () => undefined }) }),
    }),
    batch: () => ({ delete: () => {}, update: () => {}, commit: async () => {} }),
    runTransaction: async () => {},
  },
}));

vi.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: () => ({
      getFiles: async ({ prefix }: { prefix: string }) => {
        h.getFilesCalls += 1;
        return [h.listed.filter((p) => p.startsWith(prefix)).map((path) => ({
          name: path,
          delete: async (options: Record<string, unknown> = {}) => {
            h.deleteOptions.push({ path, options });
            // GCS semantics: a missing object is a 404 unless the caller
            // opted out of it.
            if (h.erroring.has(path)) {
              // `ignoreNotFound` covers 404s only — a 5xx still propagates.
              const err = new Error('backend error') as Error & { code: number };
              err.code = 500;
              throw err;
            }
            if (h.vanished.has(path) && options.ignoreNotFound !== true) {
              const err = new Error('No such object') as Error & { code: number };
              err.code = 404;
              throw err;
            }
          },
        }))];
      },
    }),
  }),
}));

import { eraseDoUserData } from '../doGdpr.js';

const UID = 'erased-doer';

describe('sync-do prefix erasure — delete options (§11.4)', () => {
  beforeEach(() => {
    h.listed = [
      `do-photos/${UID}/a`,
      `do-photos/${UID}/b`,
      `do-uploads/${UID}/quarantined`,
    ];
    h.vanished = new Set();
    h.erroring = new Set();
    h.deleteOptions = [];
    h.getFilesCalls = 0;
  });

  it('passes ignoreNotFound on every delete, so a mid-erasure 404 cannot abort it', async () => {
    // The daily quarantine sweep removes this one after the listing.
    h.vanished.add(`do-uploads/${UID}/quarantined`);

    const stats = await eraseDoUserData(UID, null, false);

    // The erasure completed. Without `ignoreNotFound` this call rejects and
    // `deleteUser` never reaches `userRef.delete()` — objects gone, account
    // and user document still live, no audit entry.
    expect(stats.photoObjectsDeleted).toBe(3);
    expect(h.deleteOptions).toHaveLength(3);
    for (const { options } of h.deleteOptions) {
      expect(options.ignoreNotFound).toBe(true);
    }
  });

  it('erases both uid-scoped prefixes and lists each exactly once', async () => {
    await eraseDoUserData(UID, null, false);

    expect(h.deleteOptions.map((d) => d.path).sort()).toEqual([
      `do-photos/${UID}/a`,
      `do-photos/${UID}/b`,
      `do-uploads/${UID}/quarantined`,
    ]);
    // One listing per prefix, not two: pairing `getFiles` with
    // `bucket.deleteFiles()` re-streamed the same prefix internally, which
    // was the cost the parallelism was meant to save.
    expect(h.getFilesCalls).toBe(2);
  });

  it('still throws on a non-404 Storage failure, leaving the erasure retryable', async () => {
    // A 5xx is NOT swallowed: every step here is re-runnable, so aborting
    // keeps the account alive and the erasure retryable, whereas continuing
    // would delete the account and report success over objects still there.
    h.erroring.add(`do-photos/${UID}/a`);

    await expect(eraseDoUserData(UID, null, false)).rejects.toThrow('backend error');
  });
});
