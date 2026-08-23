import { describe, it, expect } from 'vitest';
import { getBabysitterView } from '../sitUserAdapter';
import type { User } from '@ejm/shared-core';

// The flattened view spreads the NESTED profile over the root, so a root
// shared-identity field surviving in the view would let a consumer read the
// nested copy through a root-looking name and silently bypass getContact's
// root-first resolution (issue #203; PR #206 review). The view therefore
// DROPS the root quartet at runtime, not only in the type — pinned here so a
// refactor that "simplifies" the destructure is caught.
describe('BabysitterView narrowing (issue #203)', () => {
  it('drops the root shared-identity quartet; only the profile copies survive', () => {
    const user = {
      uid: 'u1',
      firstName: 'Lea',
      ejemEmail: 'root@ejm.org',
      contactEmail: 'root@x.com',
      contactPhone: '+33 6 99',
      whatsapp: '+33 6 99',
      profiles: { babysitter: { enrollmentComplete: true, contactEmail: 'nested@x.com' } },
    } as unknown as User;
    const view = getBabysitterView(user) as unknown as Record<string, unknown>;

    // Base fields still flatten through.
    expect(view.firstName).toBe('Lea');
    // The profile's own copy is what the view carries...
    expect(view.contactEmail).toBe('nested@x.com');
    // ...and root-only values do NOT leak in under a root-looking name.
    expect(view.contactPhone).toBeUndefined();
    expect(view.whatsapp).toBeUndefined();
    expect(view.ejemEmail).toBeUndefined();
  });
});
