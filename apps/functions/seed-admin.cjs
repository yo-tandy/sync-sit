/**
 * Seed script — creates an admin user in the Firebase emulator.
 *
 * Usage:
 *   pnpm seed:admin              # lane 1 (the shared dev stack), as always
 *   pnpm seed:admin admin@ejm.org mypassword
 *   LANE=3 pnpm seed:admin       # seed emulator lane 3 instead
 *   pnpm seed:admin:lane3        # the same thing, spelled as a script
 *
 * Prerequisites: Firebase emulators must be running (`pnpm emulators`, or
 * `firebase emulators:start --config firebase.lane3.json ...` for a lane).
 *
 * The endpoint comes from the SAME resolver the three web apps use for their
 * VITE_EMULATOR_* vars (issue #376), under plain `EMULATOR_*` names plus
 * `LANE` / `E2E_LANE` — so "start lane N → seed lane N → run the app against
 * lane N" is one dial end to end. With none of them set this targets
 * localhost:8080 / localhost:9099 exactly as it always did.
 * See docs/emulator-lanes.md.
 */

const { applySeedEmulatorTarget } = require('./emulator-target.cjs');

// Sets FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST from the lane
// vars. `localhost` is this script's historical default host; keep it so a
// bare `pnpm seed:admin` produces the byte-identical target it always has.
const emulator = applySeedEmulatorTarget(process.env, 'localhost');

const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const EMAIL = process.argv[2] || 'admin@syncsit.app';
const PASSWORD = process.argv[3] || 'admin123';

// Targets the demo-test emulator namespace (matching `pnpm emulators` and both
// apps' .env.development); override with SEED_PROJECT_ID=<id> if the emulator
// runs under a different --project.
const app = initializeApp({ projectId: process.env.SEED_PROJECT_ID || 'demo-test' });
const adminAuth = getAuth(app);
const db = getFirestore(app);

async function seed() {
  console.log('\nSeeding admin user: ' + EMAIL);
  console.log(
    '  Target: lane ' +
      emulator.lane +
      ' — firestore ' +
      process.env.FIRESTORE_EMULATOR_HOST +
      ', auth ' +
      process.env.FIREBASE_AUTH_EMULATOR_HOST,
  );

  let uid;

  try {
    const user = await adminAuth.createUser({
      email: EMAIL,
      password: PASSWORD,
      displayName: 'Admin User',
    });
    uid = user.uid;
    console.log('  Created Auth user: ' + uid);
  } catch (err) {
    if (err.code === 'auth/email-already-exists') {
      const user = await adminAuth.getUserByEmail(EMAIL);
      uid = user.uid;
      console.log('  Auth user already exists: ' + uid);
    } else {
      throw err;
    }
  }

  await db.collection('users').doc(uid).set({
    uid,
    role: 'admin',
    email: EMAIL,
    status: 'active',
    firstName: 'Admin',
    lastName: 'User',
    language: 'en',
    notifPrefs: {
      shared: { reminders: { push: true, email: false } },
      sit: {
        newRequest: { push: true, email: true },
        confirmed: { push: true, email: true },
        cancelled: { push: true, email: true },
      },
      study: {
        newRequest: { push: true, email: true },
        confirmed: { push: true, email: true },
        cancelled: { push: true, email: true },
      },
      do: {
        newRequest: { push: true, email: true },
        confirmed: { push: true, email: true },
        cancelled: { push: true, email: true },
      },
    },
    fcmTokens: [],
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  console.log('  Wrote Firestore doc: users/' + uid);
  console.log('\n  Login at /login with:');
  console.log('    Email:    ' + EMAIL);
  console.log('    Password: ' + PASSWORD + '\n');

  process.exit(0);
}

seed().catch(function(err) {
  console.error('Seed failed:', err);
  process.exit(1);
});
