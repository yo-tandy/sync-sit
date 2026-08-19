import { describe, it, expect } from 'vitest';
import { getEjemEmail, getContact, hasAnyContact } from '../userAdapter.js';
import type { User } from '../user.js';

// Loose doc builder — the helpers must tolerate real Firestore docs, which
// are looser than the User type (nested profiles carry app-specific fields).
function docOf(shape: Record<string, unknown>): User {
  return shape as unknown as User;
}

describe('getEjemEmail (root ?? babysitter ?? tutor)', () => {
  it('prefers the root field', () => {
    const user = docOf({
      ejemEmail: 'root@ejm.org',
      profiles: { babysitter: { ejemEmail: 'bs@ejm.org' }, tutor: { ejemEmail: 'tu@ejm.org' } },
    });
    expect(getEjemEmail(user)).toBe('root@ejm.org');
  });

  it('falls back to the babysitter copy, then the tutor copy', () => {
    expect(getEjemEmail(docOf({
      profiles: { babysitter: { ejemEmail: 'bs@ejm.org' }, tutor: { ejemEmail: 'tu@ejm.org' } },
    }))).toBe('bs@ejm.org');
    expect(getEjemEmail(docOf({
      profiles: { tutor: { ejemEmail: 'tu@ejm.org' } },
    }))).toBe('tu@ejm.org');
  });

  it("treats '' as absent at every level", () => {
    expect(getEjemEmail(docOf({
      ejemEmail: '',
      profiles: { babysitter: { ejemEmail: '' }, tutor: { ejemEmail: 'tu@ejm.org' } },
    }))).toBe('tu@ejm.org');
  });

  it('returns undefined when no level has a value', () => {
    expect(getEjemEmail(docOf({ profiles: { babysitter: {} } }))).toBeUndefined();
    expect(getEjemEmail(docOf({ profiles: {} }))).toBeUndefined();
    expect(getEjemEmail(null)).toBeUndefined();
    expect(getEjemEmail(undefined)).toBeUndefined();
  });

  it('ignores non-string junk in a nested copy', () => {
    expect(getEjemEmail(docOf({
      profiles: { babysitter: { ejemEmail: 42 }, tutor: { ejemEmail: 'tu@ejm.org' } },
    }))).toBe('tu@ejm.org');
  });
});

describe('getContact (per-field root ?? babysitter ?? tutor)', () => {
  it('resolves each field independently across levels', () => {
    const user = docOf({
      contactEmail: 'root@contact.com', // post-change Account edit
      profiles: {
        babysitter: { contactPhone: '+33 6 11' }, // pre-change enrollment
        tutor: { whatsapp: '+33 6 22' },
      },
    });
    expect(getContact(user)).toEqual({
      contactEmail: 'root@contact.com',
      contactPhone: '+33 6 11',
      whatsapp: '+33 6 22',
    });
  });

  it('root wins over both nested copies per field', () => {
    const user = docOf({
      contactPhone: '+33 6 00',
      profiles: {
        babysitter: { contactPhone: '+33 6 11' },
        tutor: { contactPhone: '+33 6 22' },
      },
    });
    expect(getContact(user).contactPhone).toBe('+33 6 00');
  });

  it('babysitter copy wins over tutor copy', () => {
    const user = docOf({
      profiles: {
        babysitter: { contactEmail: 'bs@contact.com' },
        tutor: { contactEmail: 'tu@contact.com' },
      },
    });
    expect(getContact(user).contactEmail).toBe('bs@contact.com');
  });

  it("null and '' are absent (nested null does not shadow a tutor value)", () => {
    const user = docOf({
      contactEmail: null,
      profiles: {
        babysitter: { contactEmail: '' },
        tutor: { contactEmail: 'tu@contact.com' },
      },
    });
    expect(getContact(user).contactEmail).toBe('tu@contact.com');
  });

  it('resolves to null when nothing is set anywhere', () => {
    expect(getContact(docOf({ profiles: {} }))).toEqual({
      contactEmail: null, contactPhone: null, whatsapp: null,
    });
    expect(getContact(null)).toEqual({
      contactEmail: null, contactPhone: null, whatsapp: null,
    });
  });
});

describe('hasAnyContact', () => {
  it('true when any channel resolves at any level', () => {
    expect(hasAnyContact(docOf({ contactPhone: '+33 6' , profiles: {} }))).toBe(true);
    expect(hasAnyContact(docOf({ profiles: { babysitter: { whatsapp: '+33 6' } } }))).toBe(true);
    expect(hasAnyContact(docOf({ profiles: { tutor: { contactEmail: 'x@y.fr' } } }))).toBe(true);
  });

  it('false when all channels are empty everywhere', () => {
    expect(hasAnyContact(docOf({
      contactEmail: null,
      profiles: { babysitter: { contactPhone: '' } },
    }))).toBe(false);
    expect(hasAnyContact(null)).toBe(false);
  });
});
