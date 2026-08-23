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

// ---------------------------------------------------------------------------
// Shared identity accessors (issue #203 / PR #205 owner decisions)
// ---------------------------------------------------------------------------
//
// ejemEmail and the contact channels are canonical at the ROOT of users/{uid};
// the nested profiles.{babysitter,tutor} copies are back-compat duplicates.
// EVERY read goes through these helpers (root ?? babysitter ?? tutor) so the
// order in which docs get backfilled, enrolled, or merged never matters.
// For ejemEmail (server-owned, client-immutable) '' and null count as absent
// at every level. For the CONTACT trio the root is different: see getContact
// — an explicit null there is a user clear, not an absence.

/** Loose view of the nested profile shapes (concrete types live in
 *  sit-core/study-core; shared-core only knows ProfileBase). */
function profileField(
  user: User | null | undefined,
  profileKey: 'babysitter' | 'tutor',
  field: string,
): unknown {
  const profile = user?.profiles?.[profileKey] as Record<string, unknown> | undefined;
  return profile?.[field];
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** The user's verified EJM identity email: root ?? babysitter ?? tutor. */
export function getEjemEmail(user: User | null | undefined): string | undefined {
  return (
    nonEmpty(user?.ejemEmail)
    ?? nonEmpty(profileField(user, 'babysitter', 'ejemEmail'))
    ?? nonEmpty(profileField(user, 'tutor', 'ejemEmail'))
  );
}

export interface ContactFields {
  contactEmail: string | null;
  contactPhone: string | null;
  whatsapp: string | null;
}

/**
 * The user's shared contact channels, resolved PER FIELD (a doc can hold a
 * post-change root contactEmail next to a pre-change nested-only phone).
 *
 * Root PRESENCE is authoritative, and that distinction matters: the Account
 * pages write the root copy ONLY, so an explicit `null` there is the user
 * CLEARING that channel. Falling back to the frozen nested enrollment copy
 * would keep disclosing a deleted phone number to approved families, in the
 * acceptance email, and back into the form on the next mount (PR #206
 * review). An ABSENT root key means "never written here" — legacy and
 * un-backfilled docs — and still falls through to babysitter ?? tutor.
 */
export function getContact(user: User | null | undefined): ContactFields {
  const resolve = (field: 'contactEmail' | 'contactPhone' | 'whatsapp'): string | null => {
    const rootValue = (user as Record<string, unknown> | null | undefined)?.[field];
    if (rootValue !== undefined) return nonEmpty(rootValue) ?? null;
    return (
      nonEmpty(profileField(user, 'babysitter', field))
      ?? nonEmpty(profileField(user, 'tutor', field))
      ?? null
    );
  };
  return {
    contactEmail: resolve('contactEmail'),
    contactPhone: resolve('contactPhone'),
    whatsapp: resolve('whatsapp'),
  };
}

/** True when any resolved contact channel is set. */
export function hasAnyContact(user: User | null | undefined): boolean {
  const contact = getContact(user);
  return !!(contact.contactEmail || contact.contactPhone || contact.whatsapp);
}

/**
 * Flattened parent record: the User base fields merged with the parent
 * profile. Lets consumers that read both user-level (email, firstName) and
 * parent-level (familyId, phone) fields off one object do so with one call.
 */
// Root `whatsapp` (shared provider contact, nullable) is shadowed by the
// parent profile's own `whatsapp?: string` in the flattened spread — omit the
// root contact trio so the intersection stays well-typed (the parent view is
// about PARENT contact; provider contact resolves via getContact instead).
//
// `ejemEmail` is omitted too, for symmetry with BabysitterView/TutorView
// rather than out of need: role exclusivity (addProfileToUser blocks
// parent+provider in both directions) means a parent doc carries no root
// ejemEmail today. These three views are the enforcement point for "a root
// field never reaches a consumer under a root-looking name through a
// flattened view", so the rule holds uniformly rather than per-role
// (PR #206 review).
export type ParentView =
  Omit<User, 'ejemEmail' | 'contactEmail' | 'contactPhone' | 'whatsapp'> & ParentProfile;

export function getParentView(
  user: User | null | undefined,
): ParentView | null {
  const profile = getParentProfile(user);
  if (!user || !profile) return null;
  // Drop the root identity+contact quartet before the spread (see ParentView).
  const { ejemEmail: _ee, contactEmail: _ce, contactPhone: _cp, whatsapp: _wa, ...base } = user;
  return { ...base, ...profile };
}
