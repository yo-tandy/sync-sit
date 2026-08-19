import { describe, expect, it } from 'vitest';
// The script guards its main() behind require.main, so importing it here only
// loads the pure helpers (no firebase-admin resolution).
import { computeRootPatch, isEmpty, SHARED_FIELDS } from '../backfill-shared-identity.cjs';

describe('isEmpty', () => {
  it("treats absent, null and '' as empty; anything else as populated", () => {
    expect(isEmpty(undefined)).toBe(true);
    expect(isEmpty(null)).toBe(true);
    expect(isEmpty('')).toBe(true);
    expect(isEmpty('x')).toBe(false);
    expect(isEmpty(0)).toBe(false);
  });
});

describe('computeRootPatch', () => {
  it('copies nested babysitter values to an empty root', () => {
    expect(computeRootPatch({
      profiles: { babysitter: { ejemEmail: 'a@ejm.org', contactPhone: '+33 6' } },
    })).toEqual({ ejemEmail: 'a@ejm.org', contactPhone: '+33 6' });
  });

  it('copies from the tutor profile when the babysitter copy is absent', () => {
    expect(computeRootPatch({
      profiles: { tutor: { ejemEmail: 't@ejm.org', whatsapp: '+33 7' } },
    })).toEqual({ ejemEmail: 't@ejm.org', whatsapp: '+33 7' });
  });

  it('babysitter copy WINS over a disagreeing tutor copy (sit-origin tiebreak)', () => {
    expect(computeRootPatch({
      profiles: {
        babysitter: { ejemEmail: 'bs@ejm.org', contactEmail: 'bs@contact.com' },
        tutor: { ejemEmail: 'tu@ejm.org', contactEmail: 'tu@contact.com' },
      },
    })).toEqual({ ejemEmail: 'bs@ejm.org', contactEmail: 'bs@contact.com' });
  });

  it('resolves per FIELD: babysitter email + tutor phone combine', () => {
    expect(computeRootPatch({
      profiles: {
        babysitter: { contactEmail: 'bs@contact.com' },
        tutor: { contactPhone: '+33 7' },
      },
    })).toEqual({ contactEmail: 'bs@contact.com', contactPhone: '+33 7' });
  });

  it('NEVER touches a populated root field (idempotent)', () => {
    const doc = {
      ejemEmail: 'root@ejm.org',
      contactEmail: 'root@contact.com',
      contactPhone: '+33 6 00',
      whatsapp: '+33 6 00',
      profiles: {
        babysitter: { ejemEmail: 'bs@ejm.org', contactEmail: 'bs@contact.com', contactPhone: '+33 6 11', whatsapp: '+33 6 11' },
      },
    };
    expect(computeRootPatch(doc)).toBeNull();
  });

  it("a root '' or null IS backfillable (empty, not populated)", () => {
    expect(computeRootPatch({
      ejemEmail: '',
      contactEmail: null,
      profiles: { babysitter: { ejemEmail: 'bs@ejm.org', contactEmail: 'bs@contact.com' } },
    })).toEqual({ ejemEmail: 'bs@ejm.org', contactEmail: 'bs@contact.com' });
  });

  it("skips nested nulls and '' — they are absence, not values", () => {
    expect(computeRootPatch({
      profiles: {
        babysitter: { contactEmail: null, contactPhone: '' },
        tutor: { contactPhone: '+33 7' },
      },
    })).toEqual({ contactPhone: '+33 7' });
  });

  it('ignores non-string junk in nested copies', () => {
    expect(computeRootPatch({
      profiles: { babysitter: { ejemEmail: 42, contactPhone: { nope: true } } },
    })).toBeNull();
  });

  it('returns null for docs with nothing to lift (parents, empty profiles)', () => {
    expect(computeRootPatch({ profiles: { parent: { familyId: 'f1', phone: '+33 6' } } })).toBeNull();
    expect(computeRootPatch({ profiles: {} })).toBeNull();
    expect(computeRootPatch({})).toBeNull();
  });

  it('covers exactly the four shared fields', () => {
    expect(SHARED_FIELDS).toEqual(['ejemEmail', 'contactEmail', 'contactPhone', 'whatsapp']);
  });
});
