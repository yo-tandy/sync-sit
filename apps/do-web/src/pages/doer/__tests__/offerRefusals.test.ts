import { describe, expect, it } from 'vitest';
import en from '@/i18n/en';
import fr from '@/i18n/fr';
import { REFUSAL_KEYS, type Refusal } from '../offerRefusals';

// The refusal map is the seam between `doSubmitOffer`/`doUpdateOffer`'s
// `details.reason` strings and the copy a doer actually reads. A missing or
// misspelled key degrades to the generic error silently, so pin that every
// mapped reason resolves in BOTH locales.

const REASONS: Refusal[] = [
  'task_offer_cap',
  'offer_cap',
  'under_15',
  'offer_exists',
  'task_not_open',
  'not_pending',
];

function lookup(bundle: unknown, dottedKey: string): unknown {
  return dottedKey
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], bundle);
}

describe('REFUSAL_KEYS', () => {
  it('covers every refusal the offer callables can emit', () => {
    expect(Object.keys(REFUSAL_KEYS).sort()).toEqual([...REASONS].sort());
  });

  it('resolves each key to real copy in EN and FR', () => {
    for (const reason of REASONS) {
      const key = REFUSAL_KEYS[reason];
      expect(typeof lookup(en, key), `en missing ${key}`).toBe('string');
      expect(typeof lookup(fr, key), `fr missing ${key}`).toBe('string');
    }
  });

  it('gives the oversubscribed case its own copy, distinct from the per-doer cap', () => {
    // §6.4's write-set bound (task full) and §4.2's per-doer ceiling are
    // different situations and must not share a message.
    expect(REFUSAL_KEYS.task_offer_cap).not.toBe(REFUSAL_KEYS.offer_cap);
  });
});
