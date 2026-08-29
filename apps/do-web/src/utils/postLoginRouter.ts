import type { User } from '@ejm/shared-core';
import { getDoRole } from '@/utils/doRole';

/**
 * Post-sign-in landing, mirroring study-web's postLoginRouter branch on
 * role. Parents land in the family portal (plan §13 PR7); everyone else
 * lands on /home — the doer board (plan §13 PR8), which admits doers,
 * admins (who pass the doer guard: no admin tree in do-web, plan §9.4),
 * and bounces no-role accounts to /signup via the guard.
 */
export function postLoginRouter(userDoc: User | null): string {
  return getDoRole(userDoc) === 'parent' ? '/family' : '/home';
}
