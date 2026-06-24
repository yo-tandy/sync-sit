import type { User, ParentProfile } from './user.js';

// ---------------------------------------------------------------------------
// User-document accessors (Plan D)
// ---------------------------------------------------------------------------
//
// users/{uid} docs carry identity at the top level, role-specific data under
// profiles.{babysitter|tutor|parent}, and admin via `isAdmin: true`. The
// transitional dual-read fallbacks (which synthesized a profile from the
// pre-Plan-D flat fields) were removed once the prod migration completed.

export function getParentProfile(
  user: User | null | undefined,
): ParentProfile | undefined {
  return user?.profiles?.parent;
}

export function isAdmin(user: User | null | undefined): boolean {
  return user?.isAdmin === true;
}

export function isParent(user: User | null | undefined): boolean {
  return !!user?.profiles?.parent;
}

export function isBabysitter(user: User | null | undefined): boolean {
  return !!user?.profiles?.babysitter;
}

export function isTutor(user: User | null | undefined): boolean {
  return !!user?.profiles?.tutor;
}

/**
 * The user's primary role as a string, cross-app (covers tutor). For
 * display/audit and backend gating that doesn't need the concrete profile.
 * Admin is reported only when no service/parent profile is present, matching
 * the single-role display model; callers needing "is also admin" use isAdmin().
 */
export function getUserRole(
  user: User | null | undefined,
): 'babysitter' | 'tutor' | 'parent' | 'admin' | undefined {
  if (!user) return undefined;
  if (user.profiles?.babysitter) return 'babysitter';
  if (user.profiles?.tutor) return 'tutor';
  if (user.profiles?.parent) return 'parent';
  if (user.isAdmin) return 'admin';
  return undefined;
}

/**
 * Flattened parent record: the User base fields merged with the parent
 * profile. Lets consumers that read both user-level (email, firstName) and
 * parent-level (familyId, phone) fields off one object do so with one call.
 */
export type ParentView = User & ParentProfile;

export function getParentView(
  user: User | null | undefined,
): ParentView | null {
  const profile = getParentProfile(user);
  if (!user || !profile) return null;
  return { ...user, ...profile };
}
