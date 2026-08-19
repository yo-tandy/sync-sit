import type { User } from '@ejm/shared-core';
import { getParentProfile, isAdmin } from '@ejm/shared-core';
import type { BabysitterProfile } from './babysitterProfile.js';

// User-doc accessors for sync-sit (Plan D). The babysitter profile lives at
// users/{uid}.profiles.babysitter.

export function getBabysitterProfile(
  user: User | null | undefined,
): BabysitterProfile | undefined {
  return user?.profiles?.babysitter as BabysitterProfile | undefined;
}

/**
 * Flattened babysitter record: User base fields merged with the babysitter
 * profile. Lets consumer code that reads both user-level and babysitter-level
 * fields off one object do so with a single call.
 */
// The root shared-identity quartet (ejemEmail + contact trio, issue #203) is
// omitted from the User half: the PROFILE copy wins in the flattened view
// (pre-change behavior). Code that wants the canonical resolution uses
// getEjemEmail/getContact from shared-core instead of the view.
export type BabysitterView =
  Omit<User, 'ejemEmail' | 'contactEmail' | 'contactPhone' | 'whatsapp'> & BabysitterProfile;

export function getBabysitterView(
  user: User | null | undefined,
): BabysitterView | null {
  const profile = getBabysitterProfile(user);
  if (!user || !profile) return null;
  const { ejemEmail: _ee, contactEmail: _ce, contactPhone: _cp, whatsapp: _wa, ...base } = user;
  return { ...base, ...profile };
}

/** The user's role within sync-sit, for routing and guards. */
export function getSitRole(
  user: User | null | undefined,
): 'babysitter' | 'parent' | 'admin' | undefined {
  if (!user) return undefined;
  if (getBabysitterProfile(user)) return 'babysitter';
  if (getParentProfile(user)) return 'parent';
  if (isAdmin(user)) return 'admin';
  return undefined;
}
