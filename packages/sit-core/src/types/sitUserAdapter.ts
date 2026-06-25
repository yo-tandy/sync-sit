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
export type BabysitterView = User & BabysitterProfile;

export function getBabysitterView(
  user: User | null | undefined,
): BabysitterView | null {
  const profile = getBabysitterProfile(user);
  if (!user || !profile) return null;
  return { ...user, ...profile };
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
