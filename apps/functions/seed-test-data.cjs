/**
 * Seed script — creates test data in Firebase emulators for local testing.
 *
 * Creates:
 *   - 1 admin user
 *   - 2 families (one with 2 parents, one with 1 parent)
 *   - 4 babysitters with different availabilities and profiles
 *   - A few sample appointments
 *
 * Usage:
 *   node apps/functions/seed-test-data.cjs
 *
 * Prerequisites: Firebase emulators must be running.
 * All passwords are "test1234".
 */

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';

const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const app = initializeApp({ projectId: 'sync-sit' });
const auth = getAuth(app);
const db = getFirestore(app);

const PASSWORD = 'test1234';
const NOW = new Date();

// Helper: create auth user, return uid
async function createUser(email, displayName) {
  try {
    const user = await auth.createUser({ email, password: PASSWORD, displayName });
    return user.uid;
  } catch (err) {
    if (err.code === 'auth/email-already-exists') {
      const user = await auth.getUserByEmail(email);
      return user.uid;
    }
    throw err;
  }
}

// Helper: generate 96-slot availability array (15-min slots for 24h)
// slots is an array of [startHour, endHour] ranges that are available
function makeSlots(ranges) {
  const slots = new Array(96).fill(false);
  for (const [start, end] of ranges) {
    const startIdx = Math.floor((start * 60) / 15);
    const endIdx = Math.floor((end * 60) / 15);
    for (let i = startIdx; i < endIdx && i < 96; i++) {
      slots[i] = true;
    }
  }
  return slots;
}

async function seed() {
  console.log('\n=== Seeding Test Data ===\n');

  // ─── Admin ───
  console.log('Creating admin...');
  const adminUid = await createUser('admin@syncsit.test', 'Admin User');
  await db.collection('users').doc(adminUid).set({
    uid: adminUid, role: 'admin', email: 'admin@syncsit.test', status: 'active',
    firstName: 'Admin', lastName: 'User', language: 'en',
    notifPrefs: { newRequest: { push: true, email: true }, confirmed: { push: true, email: true }, cancelled: { push: true, email: true }, reminders: { push: true, email: false } },
    fcmTokens: [], createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  });
  console.log(`  admin@syncsit.test (${adminUid})`);

  // ─── Family 1: Dupont (2 parents) ───
  console.log('\nCreating Family 1 (Dupont, 2 parents)...');
  const parent1Uid = await createUser('marie.dupont@test.com', 'Marie Dupont');
  const parent2Uid = await createUser('pierre.dupont@test.com', 'Pierre Dupont');
  const family1Id = 'family-dupont';

  await db.collection('users').doc(parent1Uid).set({
    uid: parent1Uid, role: 'parent', email: 'marie.dupont@test.com', status: 'active',
    firstName: 'Marie', lastName: 'Dupont', familyId: family1Id, language: 'fr',
    phone: '+33 612345678', whatsapp: '+33 612345678',
    notifPrefs: { newRequest: { push: true, email: true }, confirmed: { push: true, email: true }, cancelled: { push: true, email: true }, reminders: { push: true, email: true } },
    fcmTokens: [], createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  });

  await db.collection('users').doc(parent2Uid).set({
    uid: parent2Uid, role: 'parent', email: 'pierre.dupont@test.com', status: 'active',
    firstName: 'Pierre', lastName: 'Dupont', familyId: family1Id, language: 'fr',
    phone: '+33 698765432',
    notifPrefs: { newRequest: { push: true, email: true }, confirmed: { push: true, email: true }, cancelled: { push: true, email: true }, reminders: { push: true, email: true } },
    fcmTokens: [], createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  });

  await db.collection('families').doc(family1Id).set({
    familyId: family1Id, familyName: 'Dupont',
    address: '15 Rue de Passy, 75016 Paris',
    latLng: { lat: 48.8566, lng: 2.2769 },
    pets: 'Small dog (friendly)',
    parentIds: [parent1Uid, parent2Uid],
    preferredBabysitters: [],
    status: 'active',
    verification: { isFullyVerified: true, verifiedAt: NOW, method: 'admin' },
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  });

  // Kids for Family 1
  await db.collection('families').doc(family1Id).collection('kids').doc('kid1').set({
    kidId: 'kid1', firstName: 'Lucas', age: 6, languages: ['French', 'English'],
  });
  await db.collection('families').doc(family1Id).collection('kids').doc('kid2').set({
    kidId: 'kid2', firstName: 'Emma', age: 4, languages: ['French'],
  });
  await db.collection('families').doc(family1Id).collection('kids').doc('kid3').set({
    kidId: 'kid3', firstName: 'Louis', age: 9, languages: ['French', 'English'],
  });
  console.log(`  marie.dupont@test.com (${parent1Uid})`);
  console.log(`  pierre.dupont@test.com (${parent2Uid})`);
  console.log(`  Family: ${family1Id} (3 kids: Lucas 6, Emma 4, Louis 9)`);

  // ─── Family 2: Martin (1 parent) ───
  console.log('\nCreating Family 2 (Martin, 1 parent)...');
  const parent3Uid = await createUser('sophie.martin@test.com', 'Sophie Martin');
  const family2Id = 'family-martin';

  await db.collection('users').doc(parent3Uid).set({
    uid: parent3Uid, role: 'parent', email: 'sophie.martin@test.com', status: 'active',
    firstName: 'Sophie', lastName: 'Martin', familyId: family2Id, language: 'en',
    phone: '+33 655443322', whatsapp: '+33 655443322',
    notifPrefs: { newRequest: { push: true, email: true }, confirmed: { push: true, email: true }, cancelled: { push: true, email: true }, reminders: { push: true, email: false } },
    fcmTokens: [], createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  });

  await db.collection('families').doc(family2Id).set({
    familyId: family2Id, familyName: 'Martin',
    address: '42 Avenue Mozart, 75016 Paris',
    latLng: { lat: 48.8550, lng: 2.2650 },
    parentIds: [parent3Uid],
    preferredBabysitters: [],
    status: 'active',
    verification: { isFullyVerified: true, verifiedAt: NOW, method: 'admin' },
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  });

  await db.collection('families').doc(family2Id).collection('kids').doc('kid4').set({
    kidId: 'kid4', firstName: 'Chloe', age: 7, languages: ['English', 'French'],
  });
  await db.collection('families').doc(family2Id).collection('kids').doc('kid5').set({
    kidId: 'kid5', firstName: 'Noah', age: 3, languages: ['English'],
  });
  console.log(`  sophie.martin@test.com (${parent3Uid})`);
  console.log(`  Family: ${family2Id} (2 kids: Chloe 7, Noah 3)`);

  // ─── Babysitter 1: Lea — available weekday evenings, near 16e ───
  console.log('\nCreating Babysitter 1 (Lea Bernard)...');
  const bs1Uid = await createUser('lea.bernard@ejm.org', 'Lea Bernard');
  await db.collection('users').doc(bs1Uid).set({
    uid: bs1Uid, role: 'babysitter', email: 'lea.bernard@ejm.org', ejemEmail: 'lea.bernard@ejm.org',
    status: 'active', searchable: true,
    firstName: 'Lea', lastName: 'Bernard',
    dateOfBirth: new Date('2008-03-15'), gender: 'female', classLevel: '1ère',
    languages: ['French', 'English', 'Spanish'],
    aboutMe: 'I love working with kids! I have two younger siblings and often help with their homework.',
    kidAgeRange: { min: 3, max: 10 }, maxKids: 3, hourlyRate: 12,
    contactEmail: 'lea.bernard@ejm.org', contactPhone: '+33 611223344',
    areaMode: 'arrondissement', arrondissements: ['15e', '16e', '7e'],
    areaLatLng: { lat: 48.8530, lng: 2.2750 },
    notifPrefs: { newRequest: { push: true, email: true }, confirmed: { push: true, email: true }, cancelled: { push: true, email: true }, reminders: { push: true, email: true } },
    fcmTokens: [], language: 'fr',
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  });
  // Schedule: weekday evenings 17:00-22:00
  await db.collection('schedules').doc(bs1Uid).set({
    weekly: {
      mon: makeSlots([[17, 22]]), tue: makeSlots([[17, 22]]), wed: makeSlots([[14, 22]]),
      thu: makeSlots([[17, 22]]), fri: makeSlots([[17, 23]]),
      sat: makeSlots([[10, 23]]), sun: makeSlots([[10, 20]]),
    },
  });
  console.log(`  lea.bernard@ejm.org (${bs1Uid}) — weekday evenings + weekends, 16e area`);

  // ─── Babysitter 2: Hugo — available weekends only, near 15e ───
  console.log('\nCreating Babysitter 2 (Hugo Leroy)...');
  const bs2Uid = await createUser('hugo.leroy@ejm.org', 'Hugo Leroy');
  await db.collection('users').doc(bs2Uid).set({
    uid: bs2Uid, role: 'babysitter', email: 'hugo.leroy@ejm.org', ejemEmail: 'hugo.leroy@ejm.org',
    status: 'active', searchable: true,
    firstName: 'Hugo', lastName: 'Leroy',
    dateOfBirth: new Date('2007-09-22'), gender: 'male', classLevel: 'Terminale',
    languages: ['French', 'English'],
    aboutMe: 'Sporty and energetic! I enjoy playing games and doing activities with kids.',
    kidAgeRange: { min: 5, max: 14 }, maxKids: 4, hourlyRate: 15,
    contactEmail: 'hugo.leroy@ejm.org', contactPhone: '+33 622334455',
    areaMode: 'distance', areaAddress: '8 Rue Lecourbe, 75015 Paris',
    areaLatLng: { lat: 48.8450, lng: 2.3050 }, areaRadiusKm: 5,
    notifPrefs: { newRequest: { push: true, email: true }, confirmed: { push: true, email: true }, cancelled: { push: true, email: true }, reminders: { push: true, email: true } },
    fcmTokens: [], language: 'en',
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  });
  // Schedule: weekends only, all day
  await db.collection('schedules').doc(bs2Uid).set({
    weekly: {
      mon: makeSlots([]), tue: makeSlots([]), wed: makeSlots([[14, 18]]),
      thu: makeSlots([]), fri: makeSlots([[19, 23]]),
      sat: makeSlots([[9, 23]]), sun: makeSlots([[9, 21]]),
    },
  });
  console.log(`  hugo.leroy@ejm.org (${bs2Uid}) — weekends + Wed/Fri, 15e area (5km radius)`);

  // ─── Babysitter 3: Camille — very available, wide area ───
  console.log('\nCreating Babysitter 3 (Camille Moreau)...');
  const bs3Uid = await createUser('camille.moreau@ejm.org', 'Camille Moreau');
  await db.collection('users').doc(bs3Uid).set({
    uid: bs3Uid, role: 'babysitter', email: 'camille.moreau@ejm.org', ejemEmail: 'camille.moreau@ejm.org',
    status: 'active', searchable: true,
    firstName: 'Camille', lastName: 'Moreau',
    dateOfBirth: new Date('2008-06-10'), gender: 'female', classLevel: '1ère',
    languages: ['French', 'English', 'Hebrew'],
    aboutMe: 'Patient and creative. I love arts and crafts, reading stories, and cooking simple meals with kids.',
    kidAgeRange: { min: 1, max: 12 }, maxKids: 3, hourlyRate: 13,
    contactEmail: 'camille.moreau@ejm.org', contactPhone: '+33 633445566', whatsapp: '+33 633445566',
    areaMode: 'arrondissement', arrondissements: ['14e', '15e', '16e', '6e', '7e', 'Boulogne-Billancourt'],
    areaLatLng: { lat: 48.8480, lng: 2.2800 },
    notifPrefs: { newRequest: { push: true, email: true }, confirmed: { push: true, email: true }, cancelled: { push: true, email: true }, reminders: { push: true, email: true } },
    fcmTokens: [], language: 'fr',
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  });
  // Schedule: available most days
  await db.collection('schedules').doc(bs3Uid).set({
    weekly: {
      mon: makeSlots([[16, 21]]), tue: makeSlots([[16, 21]]), wed: makeSlots([[10, 21]]),
      thu: makeSlots([[16, 21]]), fri: makeSlots([[16, 23]]),
      sat: makeSlots([[10, 23]]), sun: makeSlots([[10, 20]]),
    },
  });
  console.log(`  camille.moreau@ejm.org (${bs3Uid}) — very available, wide area`);

  // ─── Babysitter 4: Tom — limited availability, inactive ───
  console.log('\nCreating Babysitter 4 (Tom Petit — NOT searchable)...');
  const bs4Uid = await createUser('tom.petit@ejm.org', 'Tom Petit');
  await db.collection('users').doc(bs4Uid).set({
    uid: bs4Uid, role: 'babysitter', email: 'tom.petit@ejm.org', ejemEmail: 'tom.petit@ejm.org',
    status: 'active', searchable: false, // inactive — won't appear in search
    firstName: 'Tom', lastName: 'Petit',
    dateOfBirth: new Date('2009-01-28'), gender: 'male', classLevel: '2nde',
    languages: ['French'],
    aboutMe: 'New to babysitting but very responsible. Good with older kids.',
    kidAgeRange: { min: 6, max: 14 }, maxKids: 2, hourlyRate: 10,
    contactEmail: 'tom.petit@ejm.org',
    areaMode: 'arrondissement', arrondissements: ['16e'],
    areaLatLng: { lat: 48.8600, lng: 2.2700 },
    notifPrefs: { newRequest: { push: true, email: true }, confirmed: { push: true, email: true }, cancelled: { push: true, email: true }, reminders: { push: true, email: true } },
    fcmTokens: [], language: 'fr',
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  });
  await db.collection('schedules').doc(bs4Uid).set({
    weekly: {
      mon: makeSlots([]), tue: makeSlots([]), wed: makeSlots([[14, 18]]),
      thu: makeSlots([]), fri: makeSlots([]),
      sat: makeSlots([[14, 20]]), sun: makeSlots([]),
    },
  });
  console.log(`  tom.petit@ejm.org (${bs4Uid}) — limited, NOT searchable (inactive)`);

  // ─── Sample Appointments ───
  console.log('\nCreating sample appointments...');

  // Tomorrow's date
  const tomorrow = new Date(NOW);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  // Next Saturday
  const nextSat = new Date(NOW);
  nextSat.setDate(nextSat.getDate() + ((6 - nextSat.getDay() + 7) % 7 || 7));
  const nextSatStr = nextSat.toISOString().split('T')[0];

  // Confirmed appointment: Family Dupont + Lea (tomorrow evening)
  const apt1Id = 'apt-confirmed-1';
  await db.collection('appointments').doc(apt1Id).set({
    appointmentId: apt1Id, type: 'one_time', status: 'confirmed',
    familyId: family1Id, familyName: 'Dupont',
    babysitterUserId: bs1Uid, createdByUserId: parent1Uid,
    date: tomorrowStr, startTime: '18:00', endTime: '22:00',
    kidIds: ['kid1', 'kid2'], kids: [{ age: 6, languages: ['French', 'English'] }, { age: 4, languages: ['French'] }],
    address: '15 Rue de Passy, 75016 Paris', latLng: { lat: 48.8566, lng: 2.2769 },
    offeredRate: 12, message: 'Hi Lea, could you please also help Lucas with his reading homework?',
    confirmedAt: NOW, createdAt: NOW, updatedAt: NOW,
  });
  console.log(`  ${apt1Id}: Dupont + Lea (confirmed, ${tomorrowStr} 18-22h)`);

  // Pending appointment: Family Dupont + Camille (next Saturday)
  const apt2Id = 'apt-pending-1';
  await db.collection('appointments').doc(apt2Id).set({
    appointmentId: apt2Id, type: 'one_time', status: 'pending',
    familyId: family1Id, familyName: 'Dupont',
    babysitterUserId: bs3Uid, createdByUserId: parent1Uid,
    date: nextSatStr, startTime: '19:00', endTime: '23:00',
    kidIds: ['kid1', 'kid2', 'kid3'], kids: [{ age: 6, languages: ['French', 'English'] }, { age: 4, languages: ['French'] }, { age: 9, languages: ['French', 'English'] }],
    address: '15 Rue de Passy, 75016 Paris', latLng: { lat: 48.8566, lng: 2.2769 },
    offeredRate: 15, message: 'Date night! All three kids. Bedtime at 21h for the younger two.',
    pets: 'Small dog (friendly)',
    createdAt: NOW, updatedAt: NOW,
  });
  console.log(`  ${apt2Id}: Dupont + Camille (pending, ${nextSatStr} 19-23h)`);

  // Declined appointment: Family Martin + Hugo
  const apt3Id = 'apt-declined-1';
  await db.collection('appointments').doc(apt3Id).set({
    appointmentId: apt3Id, type: 'one_time', status: 'rejected',
    statusReason: 'declined_by_babysitter',
    familyId: family2Id, familyName: 'Martin',
    babysitterUserId: bs2Uid, createdByUserId: parent3Uid,
    date: nextSatStr, startTime: '14:00', endTime: '18:00',
    kidIds: ['kid4', 'kid5'], kids: [{ age: 7, languages: ['English', 'French'] }, { age: 3, languages: ['English'] }],
    address: '42 Avenue Mozart, 75016 Paris', latLng: { lat: 48.8550, lng: 2.2650 },
    offeredRate: 15,
    createdAt: NOW, updatedAt: NOW,
  });
  console.log(`  ${apt3Id}: Martin + Hugo (declined, ${nextSatStr} 14-18h)`);

  // Pending appointment: Family Martin + Lea
  const apt4Id = 'apt-pending-2';
  await db.collection('appointments').doc(apt4Id).set({
    appointmentId: apt4Id, type: 'one_time', status: 'pending',
    familyId: family2Id, familyName: 'Martin',
    babysitterUserId: bs1Uid, createdByUserId: parent3Uid,
    date: nextSatStr, startTime: '10:00', endTime: '13:00',
    kidIds: ['kid4'], kids: [{ age: 7, languages: ['English', 'French'] }],
    address: '42 Avenue Mozart, 75016 Paris', latLng: { lat: 48.8550, lng: 2.2650 },
    offeredRate: 14, message: 'Just Chloe — she loves drawing and board games!',
    createdAt: NOW, updatedAt: NOW,
  });
  console.log(`  ${apt4Id}: Martin + Lea (pending, ${nextSatStr} 10-13h)`);

  // ─── Add a reference for Lea ───
  await db.collection('references').add({
    babysitterUserId: bs1Uid, type: 'manual', status: 'approved',
    fullName: 'Claire Dubois', phone: '+33 644556677', email: 'claire@example.com',
    isEjmFamily: true, numberOfKids: 2, kidAges: [5, 8],
    notes: 'Lea was wonderful with our kids. Very responsible.',
    createdAt: FieldValue.serverTimestamp(),
  });
  await db.collection('references').add({
    babysitterUserId: bs3Uid, type: 'manual', status: 'approved',
    fullName: 'Anne Laurent', email: 'anne@example.com',
    isEjmFamily: true, numberOfKids: 1, kidAges: [4],
    notes: 'Camille is creative and our daughter loves her.',
    createdAt: FieldValue.serverTimestamp(),
  });

  // ─── Summary ───
  console.log('\n=== Seed Complete ===');
  console.log('\nAll passwords: ' + PASSWORD);
  console.log('\nAccounts:');
  console.log('  Admin:    admin@syncsit.test');
  console.log('  Parent 1: marie.dupont@test.com   (Family Dupont, 2 parents)');
  console.log('  Parent 2: pierre.dupont@test.com   (Family Dupont, co-parent)');
  console.log('  Parent 3: sophie.martin@test.com   (Family Martin, single parent)');
  console.log('  Sitter 1: lea.bernard@ejm.org      (active, weekday eves + weekends)');
  console.log('  Sitter 2: hugo.leroy@ejm.org       (active, weekends + Wed/Fri)');
  console.log('  Sitter 3: camille.moreau@ejm.org   (active, very available)');
  console.log('  Sitter 4: tom.petit@ejm.org        (inactive, won\'t appear in search)');
  console.log('');

  process.exit(0);
}

seed().catch(function(err) {
  console.error('Seed failed:', err);
  process.exit(1);
});
