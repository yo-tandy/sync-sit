import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  hasNotifPrefScope,
  notifCategoryScope,
  notifPrefPath,
  notifPrefScopesForUser,
  resolveNotifPref,
} from '../notifPrefs.js';
import {
  DEFAULT_APP_NOTIF_PREFS,
  DEFAULT_NOTIF_PREFS,
  DEFAULT_SHARED_NOTIF_PREFS,
  type StoredNotifPrefs,
} from '../../types/common.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('notifCategoryScope — the shared/per-app split (issue #369)', () => {
  it('scopes the per-engagement categories to the app', () => {
    expect(notifCategoryScope('newRequest')).toBe('app');
    expect(notifCategoryScope('confirmed')).toBe('app');
    expect(notifCategoryScope('cancelled')).toBe('app');
  });

  it('keeps the person-level categories shared', () => {
    // One calendar, one reputation — see the justification in common.ts.
    expect(notifCategoryScope('reminders')).toBe('shared');
    expect(notifCategoryScope('references')).toBe('shared');
  });

  it('returns null for anything that is not a category', () => {
    expect(notifCategoryScope('boardDigest')).toBeNull();
    expect(notifCategoryScope('')).toBeNull();
  });
});

describe('resolveNotifPref — reading the app-scoped shape', () => {
  it('reads a per-app category from that app block only', () => {
    const prefs: StoredNotifPrefs = {
      sit: { newRequest: { push: true, email: true } },
      do: { newRequest: { push: false, email: false } },
    };
    expect(resolveNotifPref(prefs, 'sit', 'newRequest')).toEqual({ push: true, email: true });
    expect(resolveNotifPref(prefs, 'do', 'newRequest')).toEqual({ push: false, email: false });
  });

  it('does NOT let one app block leak into another (the whole point of the reshape)', () => {
    // Muting sync-do's high-volume offer feed must not mute a sit request
    // about somebody's child.
    const prefs: StoredNotifPrefs = { do: { newRequest: { push: false, email: false } } };
    expect(resolveNotifPref(prefs, 'sit', 'newRequest')).toEqual(DEFAULT_APP_NOTIF_PREFS.newRequest);
  });

  it('reads a shared category from the shared block whichever app asks', () => {
    const prefs: StoredNotifPrefs = { shared: { reminders: { push: false, email: true } } };
    for (const app of ['sit', 'study', 'do'] as const) {
      expect(resolveNotifPref(prefs, app, 'reminders')).toEqual({ push: false, email: true });
    }
  });

  it('ignores an app block for a shared category', () => {
    const prefs = {
      shared: { references: { push: true, email: true } },
      sit: { references: { push: false, email: false } },
    } as unknown as StoredNotifPrefs;
    expect(resolveNotifPref(prefs, 'sit', 'references')).toEqual({ push: true, email: true });
  });
});

describe('resolveNotifPref — the fail direction', () => {
  it('falls back to the PRODUCT DEFAULT, not to a blanket notify', () => {
    // reminders.email is false by design; a blanket "notify on missing"
    // would start emailing every user who never opened the screen.
    expect(resolveNotifPref(undefined, 'sit', 'reminders')).toEqual({ push: true, email: false });
    expect(resolveNotifPref({}, 'study', 'reminders')).toEqual(DEFAULT_SHARED_NOTIF_PREFS.reminders);
    expect(resolveNotifPref({}, 'do', 'confirmed')).toEqual(DEFAULT_APP_NOTIF_PREFS.confirmed);
  });

  it('merges a partially-stored category channel-by-channel', () => {
    const prefs = { sit: { newRequest: { email: false } } } as unknown as StoredNotifPrefs;
    // push must survive: the doc said nothing about it.
    expect(resolveNotifPref(prefs, 'sit', 'newRequest')).toEqual({ push: true, email: false });
  });

  it('ignores non-boolean channel values rather than coercing them', () => {
    const prefs = {
      sit: { cancelled: { push: 'yes', email: 0 } },
    } as unknown as StoredNotifPrefs;
    expect(resolveNotifPref(prefs, 'sit', 'cancelled')).toEqual({ push: true, email: true });
  });

  it('fails CLOSED and warns on an unknown category', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(
      resolveNotifPref({}, 'do', 'boardDigest' as never),
    ).toEqual({ push: false, email: false });
    expect(warn).toHaveBeenCalledOnce();
  });

  it('fails CLOSED and warns on an unknown app scope', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveNotifPref({}, 'shop' as never, 'newRequest')).toEqual({
      push: false,
      email: false,
    });
    expect(warn).toHaveBeenCalledOnce();
  });

  it('never returns the default object itself (a caller must not be able to mutate it)', () => {
    const resolved = resolveNotifPref(undefined, 'sit', 'confirmed');
    expect(resolved).not.toBe(DEFAULT_APP_NOTIF_PREFS.confirmed);
    resolved.email = false;
    expect(DEFAULT_APP_NOTIF_PREFS.confirmed.email).toBe(true);
  });
});

describe('resolveNotifPref — transitional read of the pre-#369 flat shape', () => {
  it('reads the flat shape when no scoped block exists', () => {
    const legacy: StoredNotifPrefs = {
      newRequest: { push: false, email: false },
      reminders: { push: false, email: true },
    };
    expect(resolveNotifPref(legacy, 'sit', 'newRequest')).toEqual({ push: false, email: false });
    expect(resolveNotifPref(legacy, 'study', 'newRequest')).toEqual({ push: false, email: false });
    expect(resolveNotifPref(legacy, 'do', 'reminders')).toEqual({ push: false, email: true });
  });

  it('prefers the scoped block over a stale flat copy left beside it', () => {
    // Mid-migration a doc carries BOTH. The backfill deliberately does not
    // delete the flat keys, so the new shape has to win.
    const both: StoredNotifPrefs = {
      newRequest: { push: false, email: false },
      sit: { newRequest: { push: true, email: true } },
    };
    expect(resolveNotifPref(both, 'sit', 'newRequest')).toEqual({ push: true, email: true });
  });

  it('falls through a scoped block that is missing THIS category to the flat copy', () => {
    const both: StoredNotifPrefs = {
      cancelled: { push: false, email: false },
      sit: { newRequest: { push: true, email: true } },
    };
    expect(resolveNotifPref(both, 'sit', 'cancelled')).toEqual({ push: false, email: false });
  });
});

describe('notifPrefPath — what a surface writes', () => {
  it('routes a per-app category into the app block and a shared one into shared', () => {
    expect(notifPrefPath('do', 'newRequest', 'email')).toBe('notifPrefs.do.newRequest.email');
    expect(notifPrefPath('study', 'confirmed')).toBe('notifPrefs.study.confirmed');
    expect(notifPrefPath('do', 'reminders', 'push')).toBe('notifPrefs.shared.reminders.push');
    expect(notifPrefPath('sit', 'references')).toBe('notifPrefs.shared.references');
  });

  it('never yields a whole-object notifPrefs write', () => {
    for (const category of ['newRequest', 'confirmed', 'cancelled', 'reminders', 'references'] as const) {
      expect(notifPrefPath('sit', category).split('.').length).toBeGreaterThan(2);
    }
  });
});

describe('notifPrefScopesForUser — the rendering rule', () => {
  it('a user with NO doer profile is never offered do rows', () => {
    const sitOnlyParent = { profiles: { parent: { familyId: 'f1', enrollmentComplete: true } } };
    expect(notifPrefScopesForUser(sitOnlyParent)).not.toContain('do');
    expect(hasNotifPrefScope(sitOnlyParent, 'do')).toBe(false);

    const babysitter = { profiles: { babysitter: { enrollmentComplete: true } } };
    expect(notifPrefScopesForUser(babysitter)).not.toContain('do');

    const tutor = { profiles: { tutor: { enrollmentComplete: true } } };
    expect(notifPrefScopesForUser(tutor)).not.toContain('do');
  });

  it('a user WITH a doer profile is offered do rows', () => {
    const doer = { profiles: { doer: { enrollmentComplete: true } } };
    expect(notifPrefScopesForUser(doer)).toContain('do');
    expect(hasNotifPrefScope(doer, 'do')).toBe(true);
  });

  it('always offers the shared block', () => {
    expect(notifPrefScopesForUser(undefined)).toEqual(['shared']);
    expect(notifPrefScopesForUser({ profiles: {} })).toEqual(['shared']);
    expect(notifPrefScopesForUser({ profiles: { doer: {} } })).toEqual(['shared', 'do']);
  });

  it('maps each provider profile to exactly its own app', () => {
    expect(notifPrefScopesForUser({ profiles: { babysitter: {} } })).toEqual(['shared', 'sit']);
    expect(notifPrefScopesForUser({ profiles: { tutor: {} } })).toEqual(['shared', 'study']);
    expect(notifPrefScopesForUser({ profiles: { doer: {} } })).toEqual(['shared', 'do']);
  });

  it('gives a parent sit and study — the two apps that ship a family account page', () => {
    expect(notifPrefScopesForUser({ profiles: { parent: {} } })).toEqual(['shared', 'sit', 'study']);
  });

  it('does not duplicate a scope for a user holding both roles in one app', () => {
    const both = { profiles: { babysitter: {}, parent: {} } };
    const scopes = notifPrefScopesForUser(both);
    expect(scopes.filter((s) => s === 'sit')).toHaveLength(1);
  });
});

describe('DEFAULT_NOTIF_PREFS is the new shape', () => {
  it('carries a shared block and one block per app', () => {
    expect(Object.keys(DEFAULT_NOTIF_PREFS).sort()).toEqual(['do', 'shared', 'sit', 'study']);
    expect(Object.keys(DEFAULT_NOTIF_PREFS.shared).sort()).toEqual(['references', 'reminders']);
    expect(Object.keys(DEFAULT_NOTIF_PREFS.sit).sort()).toEqual([
      'cancelled',
      'confirmed',
      'newRequest',
    ]);
  });

  it('resolves identically to an absent notifPrefs field', () => {
    for (const app of ['sit', 'study', 'do'] as const) {
      for (const category of ['newRequest', 'confirmed', 'cancelled', 'reminders', 'references'] as const) {
        expect(resolveNotifPref(DEFAULT_NOTIF_PREFS, app, category)).toEqual(
          resolveNotifPref(undefined, app, category),
        );
      }
    }
  });
});
