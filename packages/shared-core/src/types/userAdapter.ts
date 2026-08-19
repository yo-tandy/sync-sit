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
// '' and null count as absent at every level for fallback purposes.

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
 * post-change root contactEmail next to a pre-change nested-only phone):
 * root ?? babysitter ?? tutor, null when no level has a value.
 */
export function getContact(user: User | null | undefined): ContactFields {
  const resolve = (field: 'contactEmail' | 'contactPhone' | 'whatsapp'): string | null =>
    nonEmpty(user?.[field])
    ?? nonEmpty(profileField(user, 'babysitter', field))
    ?? nonEmpty(profileField(user, 'tutor', field))
    ?? null;
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
export type ParentView = Omit<User, 'contactEmail' | 'contactPhone' | 'whatsapp'> & ParentProfile;

export function getParentView(
  user: User | null | undefined,
): ParentView | null {
  const profile = getParentProfile(user);
  if (!user || !profile) return null;
  // Drop the root shared-contact trio before the spread (see ParentView).
  const { contactEmail: _ce, contactPhone: _cp, whatsapp: _wa, ...base } = user;
  return { ...base, ...profile };
}
