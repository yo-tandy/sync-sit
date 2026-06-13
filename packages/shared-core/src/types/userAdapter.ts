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
