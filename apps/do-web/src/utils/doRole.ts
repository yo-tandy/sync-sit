import { getParentProfile, isAdmin, type User } from '@ejm/shared-core';
import { getDoerProfile } from '@ejm/do-core';

export type DoRole = 'doer' | 'parent' | 'admin';

/**
 * Which sync-do portal does this account belong to? Mirrors study-core's
 * getStudyRole exactly (provider profile first, then parent, then admin) —
 * but lives in do-web rather than do-core because PR7 is UI-only: no shared
 * package changes. A doer profile wins over a parent profile for the same
 * reason a tutor profile does in study: the provider portal is the account's
 * primary surface once it exists.
 */
export function getDoRole(user: User | null | undefined): DoRole | undefined {
  if (!user) return undefined;
  if (getDoerProfile(user)) return 'doer';
  if (getParentProfile(user)?.familyId) return 'parent';
  if (isAdmin(user)) return 'admin';
  return undefined;
}
