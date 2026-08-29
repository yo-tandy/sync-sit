import { describe, expect, it } from 'vitest';
// The script guards its main() behind require.main, so importing it here only
// loads the pure helpers (no firebase-admin resolution).
import { appScopedPatch, isChannels } from '../backfill-369-app-scoped-notifprefs.cjs';
// Imported from source by relative path: the `scripts` vitest project is
// rooted at ./scripts and has no workspace node_modules of its own.
import { resolveNotifPref } from '../../packages/shared-core/src/utils/notifPrefs.js';

describe('isChannels', () => {
  it('accepts an object carrying at least one boolean channel', () => {
    expect(isChannels({ push: true, email: false })).toBe(true);
    expect(isChannels({ email: false })).toBe(true);
  });

  it('rejects anything that is not a channel map', () => {
    expect(isChannels(undefined)).toBe(false);
    expect(isChannels(null)).toBe(false);
    expect(isChannels('yes')).toBe(false);
    expect(isChannels([true])).toBe(false);
    expect(isChannels({})).toBe(false);
    expect(isChannels({ push: 'yes' })).toBe(false);
  });
});

describe('appScopedPatch — the shape move', () => {
  it('routes the shared categories into the shared block', () => {
    const patch = appScopedPatch({
      notifPrefs: {
        reminders: { push: true, email: false },
        references: { push: false, email: true },
      },
    });
    expect(patch).toEqual({
      'notifPrefs.shared': {
        reminders: { push: true, email: false },
        references: { push: false, email: true },
      },
    });
  });

  it('copies the per-engagement trio into ALL THREE app blocks', () => {
    // Delivery-preserving: the flat value was in force for every app's
    // senders, so every app block has to start from it.
    const patch = appScopedPatch({
      notifPrefs: {
        newRequest: { push: true, email: false },
        confirmed: { push: true, email: true },
        cancelled: { push: false, email: false },
      },
    });
    const trio = {
      newRequest: { push: true, email: false },
      confirmed: { push: true, email: true },
      cancelled: { push: false, email: false },
    };
    expect(patch).toEqual({
      'notifPrefs.sit': trio,
      'notifPrefs.study': trio,
      'notifPrefs.do': trio,
    });
  });

  it('writes DOTTED paths, never a whole-object notifPrefs', () => {
    const patch = appScopedPatch({ notifPrefs: { reminders: { push: true, email: true } } })!;
    for (const key of Object.keys(patch)) {
      expect(key.startsWith('notifPrefs.')).toBe(true);
    }
    expect(patch).not.toHaveProperty('notifPrefs');
  });

  it('never carries the legacy flat keys forward into the patch', () => {
    // The flat keys stay on the doc for the transitional window; the patch
    // must not restate or delete them.
    const patch = appScopedPatch({ notifPrefs: { newRequest: { email: false } } })!;
    expect(Object.keys(patch).sort()).toEqual([
      'notifPrefs.do',
      'notifPrefs.sit',
      'notifPrefs.study',
    ]);
  });
});

describe('appScopedPatch — idempotency and the skip cases', () => {
  it('skips a doc that already carries any new block', () => {
    for (const block of ['shared', 'sit', 'study', 'do']) {
      expect(
        appScopedPatch({
          notifPrefs: { [block]: { newRequest: { push: true, email: true } }, newRequest: { email: false } },
        }),
      ).toBeNull();
    }
  });

  it('is a no-op when re-run over its own output', () => {
    const before = { notifPrefs: { newRequest: { email: false }, reminders: { push: true, email: false } } };
    const patch = appScopedPatch(before)!;
    const after = { notifPrefs: { ...before.notifPrefs } as Record<string, unknown> };
    for (const [path, value] of Object.entries(patch)) {
      after.notifPrefs[path.slice('notifPrefs.'.length)] = value;
    }
    expect(appScopedPatch(after)).toBeNull();
  });

  it('skips a doc with no notifPrefs at all — absence already means defaults', () => {
    expect(appScopedPatch({})).toBeNull();
    expect(appScopedPatch({ notifPrefs: undefined })).toBeNull();
    expect(appScopedPatch({ notifPrefs: null })).toBeNull();
    expect(appScopedPatch({ notifPrefs: 'nope' })).toBeNull();
    expect(appScopedPatch(undefined)).toBeNull();
  });

  it('skips a notifPrefs object with nothing copyable in it', () => {
    expect(appScopedPatch({ notifPrefs: {} })).toBeNull();
    expect(appScopedPatch({ notifPrefs: { newRequest: {} } })).toBeNull();
    expect(appScopedPatch({ notifPrefs: { boardDigest: { push: true } } })).toBeNull();
  });

  it('copies a HALF-populated category as-is rather than inventing the other channel', () => {
    // The resolver merges the missing channel over the product default, so
    // inventing a value here would freeze a default that product may change.
    expect(appScopedPatch({ notifPrefs: { newRequest: { email: false } } })).toEqual({
      'notifPrefs.sit': { newRequest: { email: false } },
      'notifPrefs.study': { newRequest: { email: false } },
      'notifPrefs.do': { newRequest: { email: false } },
    });
  });

  it('drops junk channel values instead of migrating them', () => {
    expect(
      appScopedPatch({ notifPrefs: { newRequest: { push: 'yes', email: false } } }),
    ).toEqual({
      'notifPrefs.sit': { newRequest: { email: false } },
      'notifPrefs.study': { newRequest: { email: false } },
      'notifPrefs.do': { newRequest: { email: false } },
    });
  });
});

describe('appScopedPatch — nobody’s delivery changes on migration day', () => {
  const flat = {
    newRequest: { push: false, email: false },
    confirmed: { push: true, email: false },
    cancelled: { push: false, email: true },
    reminders: { push: false, email: true },
    references: { push: true, email: false },
  };

  it('resolves identically before and after the patch, for every app and category', () => {
    const patch = appScopedPatch({ notifPrefs: flat })!;
    const after: Record<string, unknown> = { ...flat };
    for (const [path, value] of Object.entries(patch)) {
      after[path.slice('notifPrefs.'.length)] = value;
    }
    for (const app of ['sit', 'study', 'do'] as const) {
      for (const category of [
        'newRequest',
        'confirmed',
        'cancelled',
        'reminders',
        'references',
      ] as const) {
        expect(resolveNotifPref(after, app, category), `${app}.${category}`).toEqual(
          resolveNotifPref(flat, app, category),
        );
      }
    }
  });
});
