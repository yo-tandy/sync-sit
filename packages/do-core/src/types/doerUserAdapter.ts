import type { User } from '@ejm/shared-core';
import type { DoerProfile } from './doerProfile.js';

/**
 * Narrow the shared User's generic `profiles.doer` slot (ProfileBase — see
 * plan §3.3: shared-core must never import from a leaf package) to the
 * concrete DoerProfile at do-core's read sites, exactly as study-core's
 * getTutorProfile and sit-core's babysitter adapter narrow theirs.
 */
export function getDoerProfile(
  user: User | null | undefined,
): DoerProfile | undefined {
  return user?.profiles?.doer as DoerProfile | undefined;
}
