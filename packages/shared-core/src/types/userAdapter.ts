import type { User, ParentProfile } from './user.js';
import type { Gender } from '../constants/index.js';

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

/**
 * TRUE membership, mirroring the server's classification exactly
 * (addProfileToUser, issue #279): EITHER membership field counts -- the
 * Plan D pointer (profiles.parent.familyId) or the legacy Plan C root
 * familyId, with or without a parent profile. The server rejects a parent
 * add for both shapes (the orphan-parent carve-out serves only docs with
 * NEITHER field), so the client guards match it 1:1 (PR #284 round 7
 * closed the root-only-no-profile server gap that round 5 had mirrored).
 */
export function hasFamilyMembership(user: User | null | undefined): boolean {
  return !!(
    user?.profiles?.parent?.familyId || (user as { familyId?: string } | null | undefined)?.familyId
  );
}

/**
 * The family this user belongs to, or null — read from the SAME two places
 * `hasFamilyMembership` accepts, so a surface can never disagree with the
 * guard that let the user reach it.
 *
 * That divergence was a real defect, twice (PR #345 rounds 2-4): pages read
 * `getParentProfile(user)?.familyId` alone, so a legacy Plan C parent passed
 * the membership guard and then hit a page that queried on `undefined` — no
 * error, just an authoritative empty state shown to a family with live data.
 * Encoding it once here is what makes "the client guards match the server
 * 1:1" true rather than true in the places someone remembered.
 *
 * Access is still gated server-side on `families/{id}.parentIds`, never on
 * this pointer, so resolving it in more places grants nothing new.
 */
export function getFamilyId(user: User | null | undefined): string | null {
  // `||`, not `??`, so this mirrors hasFamilyMembership EXACTLY (PR #345
  // round 5). With `??`, a doc carrying `profiles.parent.familyId: ''` and a
  // real root pointer would pass the guard (truthiness falls through) and
  // resolve to `''` here (nullishness does not) — a value that is falsy for
  // load guards but is not `null`, which is enough to strand a page on a
  // spinner forever. The invariant is pinned:
  //     hasFamilyMembership(u) === (getFamilyId(u) !== null)
  return (
    user?.profiles?.parent?.familyId ||
    (user as { familyId?: string } | null | undefined)?.familyId ||
    null
  );
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

// ---------------------------------------------------------------------------
// Student-identity accessors (issue #435 milestone, PR1)
// ---------------------------------------------------------------------------
//
// classLevel and gender are canonical at the ROOT of users/{uid}, same
// promotion as ejemEmail above; the nested profiles.{babysitter,tutor}
// copies are back-compat duplicates the enrollment callables no longer write
// for new accounts. EVERY read goes through these helpers (root ?? babysitter
// ?? tutor) so un-backfilled and legacy docs keep resolving correctly
// regardless of which app enrolled the user first.

/** The user's class level (French lycée year): root ?? babysitter ?? tutor. */
export function getClassLevel(user: User | null | undefined): string | undefined {
  return (
    nonEmpty(user?.classLevel)
    ?? nonEmpty(profileField(user, 'babysitter', 'classLevel'))
    ?? nonEmpty(profileField(user, 'tutor', 'classLevel'))
  );
}

/**
 * The user's gender: root ?? babysitter ?? tutor, same promotion as
 * classLevel. Note this collapses "never asked" and "asked, answered with an
 * empty/junk value" into the same undefined result — a caller that needs to
 * tell those apart (e.g. the crossApp gap-filling UI deciding whether to
 * re-ask the question) should read the raw field at whichever level it
 * cares about, not this resolver.
 */
export function getGender(user: User | null | undefined): Gender | undefined {
  return (
    (nonEmpty(user?.gender) as Gender | undefined)
    ?? (nonEmpty(profileField(user, 'babysitter', 'gender')) as Gender | undefined)
    ?? (nonEmpty(profileField(user, 'tutor', 'gender')) as Gender | undefined)
  );
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
