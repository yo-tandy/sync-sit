import type { User } from '@ejm/shared-core';
import { getDoRole } from '@/utils/doRole';

/**
 * Post-sign-in landing, mirroring study-web's postLoginRouter branch on
 * role. Parents land in the family portal (plan §13 PR7); everyone else —
 * doers until their portal ships at PR8, admins (whose panel lives only in
 * apps/web, plan §9.4), and accounts with no sync-do role yet — lands on
 * the shell home.
 */
export function postLoginRouter(userDoc: User | null): string {
  return getDoRole(userDoc) === 'parent' ? '/family' : '/home';
}
