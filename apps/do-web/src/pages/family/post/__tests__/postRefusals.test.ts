import { describe, expect, it } from 'vitest';
import en from '@/i18n/en';
import fr from '@/i18n/fr';
import {
  POST_DENIAL_KEYS,
  POST_DENIED_FALLBACK_KEY,
  isPostDenial,
  publishErrorCopyKey,
  type PostDenial,
} from '../postRefusals';

// The seam between `loadVerifiedFamilyCaller`'s `details.reason` strings and
// the copy a parent actually reads (issue #333). A missing or misspelled key
// degrades to the union copy silently — which is exactly the state this fix
// exists to leave behind — so pin that every reason resolves in BOTH locales
// and that the three messages are genuinely different from each other.

const REASONS: PostDenial[] = [
  'account_not_active',
  'not_parent',
  'family_not_verified',
];

function lookup(bundle: unknown, dottedKey: string): unknown {
  return dottedKey
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], bundle);
}

describe('POST_DENIAL_KEYS', () => {
  it('covers exactly the three reasons loadVerifiedFamilyCaller can emit', () => {
    expect(Object.keys(POST_DENIAL_KEYS).sort()).toEqual([...REASONS].sort());
  });

  it('resolves each key to real copy in EN and FR', () => {
    for (const reason of REASONS) {
      const key = POST_DENIAL_KEYS[reason];
      expect(typeof lookup(en, key), `en missing ${key}`).toBe('string');
      expect(typeof lookup(fr, key), `fr missing ${key}`).toBe('string');
    }
  });

  it('gives each case its own message — the whole point of naming them', () => {
    const en3 = REASONS.map((r) => lookup(en, POST_DENIAL_KEYS[r]));
    expect(new Set(en3).size).toBe(3);
    const fr3 = REASONS.map((r) => lookup(fr, POST_DENIAL_KEYS[r]));
    expect(new Set(fr3).size).toBe(3);
  });

  it('says only what its own case is — no per-case copy re-states the union', () => {
    // The not-verified message may talk about verification; the other two
    // must not, or the fix has bought nothing.
    expect(lookup(en, POST_DENIAL_KEYS.account_not_active)).not.toMatch(/verif/i);
    expect(lookup(en, POST_DENIAL_KEYS.not_parent)).not.toMatch(/verif/i);
    expect(lookup(en, POST_DENIAL_KEYS.family_not_verified)).toMatch(/verif/i);
  });
});

describe('isPostDenial', () => {
  it('accepts the three reasons and nothing else', () => {
    for (const reason of REASONS) expect(isPostDenial(reason)).toBe(true);
    for (const other of ['task_cap', 'photo_not_ready', '', undefined, null, 7, {}]) {
      expect(isPostDenial(other)).toBe(false);
    }
  });
});

describe('publishErrorCopyKey', () => {
  it('routes each denial to its own key', () => {
    for (const reason of REASONS) {
      expect(publishErrorCopyKey(reason)).toBe(POST_DENIAL_KEYS[reason]);
    }
  });

  it('keeps the union copy for an unnamed permission-denied', () => {
    // Reachable whenever a browser holding this bundle talks to a functions
    // deployment older than it — not dead code.
    expect(publishErrorCopyKey('denied')).toBe(POST_DENIED_FALLBACK_KEY);
    expect(typeof lookup(en, POST_DENIED_FALLBACK_KEY)).toBe('string');
    expect(typeof lookup(fr, POST_DENIED_FALLBACK_KEY)).toBe('string');
  });

  it('keeps the cap and generic branches', () => {
    expect(publishErrorCopyKey('cap')).toBe('family.post.capError');
    expect(publishErrorCopyKey('generic')).toBe('family.post.publishError');
  });
});
