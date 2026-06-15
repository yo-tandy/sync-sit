import type { User, ParentProfile } from './user.js';

// ---------------------------------------------------------------------------
// Dual-read adapters (Plan D transition)
// ---------------------------------------------------------------------------
//
// During the migration window the users/{uid} collection contains a mix of:
//   - NEW docs: profiles.{babysitter|tutor|parent} maps, no top-level role
//   - LEGACY docs: top-level `role` + flat role-specific fields, no profiles
//
// These helpers read the new shape when present and synthesize an equivalent
// profile from the legacy flat fields otherwise, so consumer code can be
// written once against the new shape. After the prod migration runs and is
// verified, a follow-up PR deletes the legacy fallback branches (and the
// LegacyUserFields shim) — `grep -r getParentProfile` finds every call site.

/** Flat fields that lived on the pre-Plan-D user document. */
export interface LegacyUserFields {
  role?: 'babysitter' | 'tutor' | 'parent' | 'admin';
  enrollmentComplete?: boolean;
  familyId?: string;
  phone?: string;
  whatsapp?: string;
}

export function getParentProfile(
  user: (User & Partial<LegacyUserFields>) | null | undefined,
): ParentProfile | undefined {
  if (!user) return undefined;
  if (user.profiles?.parent) return user.profiles.parent;
  if (user.role === 'parent') {
    return {
      enrollmentComplete: user.enrollmentComplete ?? true,
      familyId: user.familyId ?? '',
      phone: user.phone,
      whatsapp: user.whatsapp,
    };
  }
  return undefined;
}

export function isAdmin(
  user: (User & Partial<LegacyUserFields>) | null | undefined,
): boolean {
  if (!user) return false;
  if (user.isAdmin === true) return true;
  return user.role === 'admin';
}

export function isParent(
  user: (User & Partial<LegacyUserFields>) | null | undefined,
): boolean {
  if (!user) return false;
  return !!user.profiles?.parent || user.role === 'parent';
}

export function isBabysitter(
  user: (User & Partial<LegacyUserFields>) | null | undefined,
): boolean {
  if (!user) return false;
  return !!user.profiles?.babysitter || user.role === 'babysitter';
}

export function isTutor(
  user: (User & Partial<LegacyUserFields>) | null | undefined,
): boolean {
  if (!user) return false;
  return !!user.profiles?.tutor || user.role === 'tutor';
}

/**
 * The user's primary role as a string, cross-app (covers tutor). For
 * display/audit and backend gating that doesn't need the concrete profile.
 * Admin is reported only when no service/parent profile is present, matching
 * the legacy single-role model; callers needing "is also admin" use isAdmin().
 */
export function getUserRole(
  user: (User & Partial<LegacyUserFields>) | null | undefined,
): 'babysitter' | 'tutor' | 'parent' | 'admin' | undefined {
  if (!user) return undefined;
  if (user.profiles?.babysitter) return 'babysitter';
  if (user.profiles?.tutor) return 'tutor';
  if (user.profiles?.parent) return 'parent';
  if (user.role) return user.role;
  if (user.isAdmin) return 'admin';
  return undefined;
}

/**
 * Flattened parent record: the User base fields merged with the parent
 * profile. Equivalent to the pre-Plan-D flat parent doc, so existing
 * consumers that read both user-level (email, firstName) and parent-level
 * (familyId, phone) fields off one object keep working with a one-line swap.
 */
export type ParentView = User & ParentProfile;

export function getParentView(
  user: (User & Partial<LegacyUserFields>) | null | undefined,
): ParentView | null {
  const profile = getParentProfile(user);
  if (!user || !profile) return null;
  return { ...user, ...profile };
}
