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
    })).toEqual({ patch: { ejemEmail: 'a@ejm.org', contactPhone: '+33 6' }, contested: [] });
  });

  it('copies from the tutor profile when the babysitter copy is absent', () => {
    expect(computeRootPatch({
      profiles: { tutor: { ejemEmail: 't@ejm.org', whatsapp: '+33 7' } },
    })).toEqual({ patch: { ejemEmail: 't@ejm.org', whatsapp: '+33 7' }, contested: [] });
  });

  it('babysitter copy WINS over a disagreeing tutor copy (sit-origin tiebreak)', () => {
    expect(computeRootPatch({
      profiles: {
        babysitter: { ejemEmail: 'bs@ejm.org', contactEmail: 'bs@contact.com' },
        tutor: { ejemEmail: 'tu@ejm.org', contactEmail: 'tu@contact.com' },
      },
    })).toEqual({
      patch: { ejemEmail: 'bs@ejm.org', contactEmail: 'bs@contact.com' },
      contested: [
        { field: 'ejemEmail', babysitter: 'bs@ejm.org', tutor: 'tu@ejm.org' },
        { field: 'contactEmail', babysitter: 'bs@contact.com', tutor: 'tu@contact.com' },
      ],
    });
  });

  it('resolves per FIELD: babysitter email + tutor phone combine', () => {
    expect(computeRootPatch({
      profiles: {
        babysitter: { contactEmail: 'bs@contact.com' },
        tutor: { contactPhone: '+33 7' },
      },
    })).toEqual({ patch: { contactEmail: 'bs@contact.com', contactPhone: '+33 7' }, contested: [] });
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

  it("an explicit root null is a user CLEAR and is NEVER resurrected", () => {
    // The Account pages write root-only, so root null means the user deleted
    // that channel; lifting the frozen nested copy back over it would undo a
    // deletion of personal contact data (PR #206 review).
    expect(computeRootPatch({
      contactEmail: null,
      contactPhone: '',
      profiles: { babysitter: { contactEmail: 'bs@contact.com', contactPhone: '+33 6' } },
    })).toBeNull();
  });

  it('lifts only the fields whose root key is ABSENT, alongside a cleared one', () => {
    expect(computeRootPatch({
      contactEmail: null, // cleared — untouched
      profiles: { babysitter: { contactEmail: 'bs@contact.com', contactPhone: '+33 6' } },
    })).toEqual({ patch: { contactPhone: '+33 6' }, contested: [] });
  });

  it("skips nested nulls and '' — they are absence, not values", () => {
    expect(computeRootPatch({
      profiles: {
        babysitter: { contactEmail: null, contactPhone: '' },
        tutor: { contactPhone: '+33 7' },
      },
    })).toEqual({ patch: { contactPhone: '+33 7' }, contested: [] });
  });

  it('MIXED junk: a junk babysitter value does not shadow a valid tutor value', () => {
    // The read helpers skip non-strings at each level and fall through; the
    // backfill must agree, or a lifted root would differ from what
    // getContact resolves pre-backfill (PR #206 review).
    expect(computeRootPatch({
      profiles: {
        babysitter: { contactPhone: { nope: true } },
        tutor: { contactPhone: '+33 7' },
      },
    })).toEqual({ patch: { contactPhone: '+33 7' }, contested: [] });
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
