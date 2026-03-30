/**
 * Seed script — creates an admin user in the Firebase emulator.
 *
 * Usage:
 *   pnpm seed:admin              # uses defaults
 *   pnpm seed:admin admin@ejm.org mypassword
 *
 * Prerequisites: Firebase emulators must be running (pnpm emulators).
 */

process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';

const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const EMAIL = process.argv[2] || 'admin@syncsit.app';
const PASSWORD = process.argv[3] || 'admin123';

const app = initializeApp({ projectId: 'demo-ejm-babysitter' });
const adminAuth = getAuth(app);
const db = getFirestore(app);

async function seed() {
  console.log('\nSeeding admin user: ' + EMAIL);

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
      newRequest: { push: true, email: true },
      confirmed: { push: true, email: true },
      cancelled: { push: true, email: true },
      reminders: { push: true, email: false },
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
