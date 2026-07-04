import { HttpsError } from 'firebase-functions/v2/https';
import type { DocumentSnapshot } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';

export type ProfileKey = 'babysitter' | 'tutor' | 'parent';

export interface AddProfileParams {
  uid: string;
  profileKey: ProfileKey;
  profileData: Record<string, unknown>;
  /** Written only when the field is absent on the existing doc. */
  fillBaseFields?: Record<string, unknown>;
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
    throw new HttpsError(
      'already-exists',
      `This account already has a ${profileKey} profile`,
      { reason: 'profile-exists', profile: profileKey },
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
      [`profiles.${params.profileKey}`]: params.profileData,
      updatedAt: new Date(),
    };
    for (const [field, value] of Object.entries(params.fillBaseFields ?? {})) {
      if (data[field] === undefined && value !== undefined) {
        update[field] = value;
      }
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
