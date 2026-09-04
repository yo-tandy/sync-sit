import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb, PROJECT_ID } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

/**
 * End-to-end pin for the post-IDV trust model (owner decision 2026-08-17):
 * a freshly enrolled tutor reaches searchTutors visibility through their OWN
 * searchable toggle alone — no admin review step exists anywhere in between.
 *
 * The toggle is exercised the way the client does it: a Firestore write under
 * the tutor's own ID token via the emulator REST API, so security rules are
 * enforced (an admin-SDK write would bypass them and prove nothing about the
 * owner path).
 */

const FIRESTORE_PORT = process.env.TEST_FIRESTORE_PORT ?? '8080';
const TUTOR_EMAIL = 'fresh.activation@ejm-test.org';
const CODE = '123456';

/**
 * Polls for onUserWrittenRecomputeSearchable's write (issue #435 PR2) to land
 * after the owner's rules-enforced searchable toggle below — the trigger is
 * async, so asserting immediately after the toggle would race it. Mirrors
 * guardian-mirroring.test.ts's waitForDoc idiom for the same class of problem
 * (an async Firestore trigger this suite cannot otherwise synchronize with).
 */
async function waitForEffectiveSearchable(
  uid: string,
  expected: boolean,
  attempts = 20,
  delayMs = 300,
): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    const snap = await getDb().collection('users').doc(uid).get();
    if (snap.data()?.profiles?.tutor?.effectiveSearchable === expected) return;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(
    `onUserWrittenRecomputeSearchable never converged profiles.tutor.effectiveSearchable to ${expected} for ${uid} after ${attempts * delayMs}ms`,
  );
}

/** Rules-enforced client write: set profiles.tutor.searchable via REST. */
async function ownerToggleSearchable(uid: string, idToken: string): Promise<Response> {
  const url =
    `http://127.0.0.1:${FIRESTORE_PORT}/v1/projects/${PROJECT_ID}` +
    `/databases/(default)/documents/users/${uid}` +
    `?updateMask.fieldPaths=profiles.tutor.searchable`;
  return fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      fields: {
        profiles: {
          mapValue: {
            fields: {
              tutor: {
                mapValue: {
                  fields: { searchable: { booleanValue: true } },
                },
              },
            },
          },
        },
      },
    }),
  });
}

describe('tutor activation without admin step', () => {
  let seed: SeedData;
  let parentToken: string;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    parentToken = await getIdToken(seed.parent1.uid); // verified family
    await getDb().collection('verificationCodes').doc(TUTOR_EMAIL).set({
      code: CODE,
      // The stamp verifyEjmEmail writes (issue #322): this enrollment is
      // EJM-gated and refuses a code without it.
      identityClass: 'ejm',
      email: TUTOR_EMAIL,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      attempts: 0,
      createdAt: new Date(),
    });
  });

  afterAll(async () => {
    await clearAll();
  });

  it('fresh enrollment + own searchable toggle = visible in searchTutors', async () => {
    // 1. Enroll: subjects present, complete at creation, not yet searchable.
    const { uid } = await callFunction<{ uid: string }>('enrollTutor', {
      ejemEmail: TUTOR_EMAIL,
      verificationCode: CODE,
      password: 'Str0ngPass1',
      consentVersion: '1.0',
      enrollment: {
        firstName: 'Fara',
        lastName: 'Fresh',
        dateOfBirth: '2006-02-10',
        classLevel: 'L1',
        subjects: [{ subject: 'math', levels: ['6e'], rate: 30 }],
        sessionLengthsMin: [60],
        locationPrefs: ['online'],
        paddingMin: 15,
        contactEmail: 'fara@test.com',
        areaMode: 'distance',
        areaAddress: 'Paris center',
        areaLatLng: { lat: 48.8566, lng: 2.3522 },
        areaRadiusKm: 5,
      },
    });

    const before = (await getDb().collection('users').doc(uid).get()).data()!;
    expect(before.profiles.tutor.enrollmentComplete).toBe(true);
    expect(before.profiles.tutor.searchable).toBe(false);
    // onUserWrittenRecomputeSearchable (issue #435 PR2) already ran on
    // enrollTutor's create write and converged effectiveSearchable to false
    // (searchable is false at creation) — wait for it so the "not visible
    // yet" assertion below is about the SEARCH GATE, not trigger latency.
    await waitForEffectiveSearchable(uid, false);

    // Not visible yet: searchable is still false.
    const preToggle = await callFunction<{ results: Array<{ uid: string }> }>(
      'searchTutors',
      { subject: 'math', level: '6e', latLng: { lat: 48.8566, lng: 2.3522 } },
      parentToken,
    );
    expect(preToggle.results.map((r) => r.uid)).not.toContain(uid);

    // 2. The tutor flips their own toggle (rules-enforced client write).
    const tutorToken = await getIdToken(uid);
    const res = await ownerToggleSearchable(uid, tutorToken);
    expect(res.status).toBe(200);

    // onUserWrittenRecomputeSearchable fires off this write too — the real,
    // end-to-end proof that a plain owner toggle (not a callable, not a
    // backfill) reaches effectiveSearchable through the actual deployed
    // trigger, not a hand-computed test shortcut.
    await waitForEffectiveSearchable(uid, true);

    // 3. Immediately visible to a verified family — no admin step happened.
    const postToggle = await callFunction<{ results: Array<{ uid: string }> }>(
      'searchTutors',
      { subject: 'math', level: '6e', latLng: { lat: 48.8566, lng: 2.3522 } },
      parentToken,
    );
    expect(postToggle.results.map((r) => r.uid)).toContain(uid);
  });
});
