import { HttpsError } from 'firebase-functions/v2/https';
import type { DocumentSnapshot } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';

export type ProfileKey = 'babysitter' | 'tutor' | 'parent';

export interface AddProfileParams {
  uid: string;
  profileKey: ProfileKey;
  profileData: Record<string, unknown>;
  /**
   * Written only when the field is EMPTY on the existing doc — absent, null,
   * or '' (an empty base field is repairable; a populated one always wins,
   * matching the set-once identity rule). Keys must be top-level field
   * names; dotted paths are not supported (the emptiness check reads plain
   * object keys while update() would treat dots as field paths).
   */
  fillBaseFields?: Record<string, unknown>;
  /**
   * Base fields the caller wants written UNCONDITIONALLY, overwriting a
   * populated value. Use only for data the user just entered in this very
   * flow: `fillBaseFields`' empty-only rule is right for set-once identity,
   * but wrong for contact typed in the wizard — it silently kept an older
   * value while every reader resolves root-first (PR #206 review). Undefined
   * entries are skipped, so "not supplied" still means "leave it alone".
   */
  setBaseFields?: Record<string, unknown>;
  auditAction: string;
  auditDetails?: Record<string, unknown>;
}

function assertAddable(snap: DocumentSnapshot, profileKey: ProfileKey): void {
  if (!snap.exists) {
    throw new HttpsError('failed-precondition', 'User record not found');
  }
  const data = snap.data()!;
  if (data.status !== 'active') {
    throw new HttpsError('permission-denied', 'Account is not active');
  }
  if (data.profiles?.[profileKey] !== undefined) {
    // Re-attach carve-out (issue #279 / PR #284 review): a PARENT profile
    // whose familyId is absent is the orphan state removeCoParent leaves
    // behind -- membership cleared, profile retained. Rejecting it here
    // bricked the account: no server path could ever put a familyId back
    // (rules block the client via parentFamilyIdUnchanged). A family-LESS
    // parent profile may therefore be re-attached through a fresh invite;
    // a parent profile WITH a familyId still rejects, as ever. Provider
    // profiles keep the strict check -- they have no equivalent orphan
    // state or re-attach flow.
    const isOrphanParent =
      profileKey === 'parent' &&
      (data.profiles.parent as { familyId?: string } | undefined)?.familyId === undefined;
    if (!isOrphanParent) {
      throw new HttpsError(
        'already-exists',
        `This account already has a ${profileKey} profile`,
        { reason: 'profile-exists', profile: profileKey },
      );
    }
  }
  // Providing (tutoring, babysitting) is for EJM students; parents are the
  // adults who hire them — provider and parent roles are mutually exclusive
  // in BOTH directions (issue #116). This chokepoint covers every add-profile
  // path (enrollTutor, enrollBabysitter, enrollFamily, joinFamily).
  // Deliberate reversal of the cross-app-enrollment combos; student↔student
  // (tutor+babysitter) remains allowed.
  if (profileKey === 'tutor' && data.profiles?.parent !== undefined) {
    throw new HttpsError(
      'failed-precondition',
      'Tutoring is for EJM students — a parent account cannot enroll as a tutor.',
      { reason: 'role-exclusive', profile: 'tutor' },
    );
  }
  if (profileKey === 'babysitter' && data.profiles?.parent !== undefined) {
    throw new HttpsError(
      'failed-precondition',
      'Babysitting is for EJM students — a parent account cannot enroll as a babysitter.',
      { reason: 'role-exclusive', profile: 'babysitter' },
    );
  }
  if (
    profileKey === 'parent' &&
    (data.profiles?.tutor !== undefined || data.profiles?.babysitter !== undefined)
  ) {
    throw new HttpsError(
      'failed-precondition',
      'A student provider account (tutor or babysitter) cannot also hold a parent role.',
      { reason: 'role-exclusive', profile: 'parent' },
    );
  }
}

/**
 * Read-only preflight with the same checks as addProfileToUser. Callables
 * that create sibling documents first (enrollFamily creates the family doc
 * before the profile merge) call this to avoid orphans on a doomed merge.
 */
export async function assertCanAddProfile(uid: string, profileKey: ProfileKey): Promise<void> {
  const snap = await db.collection('users').doc(uid).get();
  assertAddable(snap, profileKey);
}

/**
 * Merge profiles.{key} into an existing users/{uid} doc. The existing doc
 * wins for base fields: entries in fillBaseFields are written only when the
 * field is absent. Consent is deliberately NOT touched — record the new
 * app's consent version in auditDetails instead.
 */
export async function addProfileToUser(params: AddProfileParams): Promise<void> {
  const ref = db.collection('users').doc(params.uid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    assertAddable(snap, params.profileKey);
    const data = snap.data()!;
    const update: Record<string, unknown> = {
      updatedAt: new Date(),
    };
    if (data.profiles?.[params.profileKey] !== undefined) {
      // Orphan-parent re-attach (the only shape assertAddable lets through
      // with an existing profile): merge field-by-field so whatever
      // survived removal (phone, enrollmentComplete) is kept, not clobbered
      // by a whole-map replace.
      for (const [field, value] of Object.entries(params.profileData)) {
        update[`profiles.${params.profileKey}.${field}`] = value;
      }
    } else {
      update[`profiles.${params.profileKey}`] = params.profileData;
    }
    for (const [field, value] of Object.entries(params.fillBaseFields ?? {})) {
      // Empty (absent/null/'') is fillable; populated always wins. Strict
      // undefined-only here disagreed with enrollTutor's truthiness presence
      // check: a doc holding firstName '' demanded the payload value and
      // then silently never wrote it.
      const existing = data[field];
      if ((existing === undefined || existing === null || existing === '') && value !== undefined) {
        update[field] = value;
      }
    }
    for (const [field, value] of Object.entries(params.setBaseFields ?? {})) {
      if (value !== undefined) update[field] = value;
    }
    tx.update(ref, update);
  });
  await writeUserActivity(params.uid, params.auditAction, params.auditDetails ?? {});
}

/**
 * Create the empty schedules/{uid} grid if it doesn't exist. schedules/{uid}
 * is a single per-user doc shared by both apps (babysitter and tutor
 * availability) — an existing grid must never be clobbered.
 */
export async function ensureScheduleDoc(uid: string): Promise<void> {
  const emptySlots = new Array(96).fill(false);
  try {
    await db.collection('schedules').doc(uid).create({
      userId: uid,
      weekly: {
        mon: emptySlots,
        tue: emptySlots,
        wed: emptySlots,
        thu: emptySlots,
        fri: emptySlots,
        sat: emptySlots,
        sun: emptySlots,
      },
      overrides: {},
      holidayMode: 'same',
      updatedAt: new Date(),
    });
  } catch (err: unknown) {
    if ((err as { code?: number }).code === 6) return; // gRPC 6 = ALREADY_EXISTS
    throw err;
  }
}
