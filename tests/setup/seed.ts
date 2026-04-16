/**
 * Seed test data into emulators for integration tests.
 * TypeScript port of apps/functions/seed-test-data.cjs using demo-test project.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { getDb, getAdminAuth } from './emulator.js';

const PASSWORD = 'Test1234';

function makeSlots(ranges: [number, number][]): boolean[] {
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

async function createUser(email: string, displayName: string): Promise<string> {
  const auth = getAdminAuth();
  try {
    const user = await auth.createUser({ email, password: PASSWORD, displayName });
    return user.uid;
  } catch (err: any) {
    if (err.code === 'auth/email-already-exists') {
      const user = await auth.getUserByEmail(email);
      return user.uid;
    }
    throw err;
  }
}

export interface SeedData {
  admin: { uid: string; email: string };
  parent1: { uid: string; email: string; familyId: string };
  parent2: { uid: string; email: string; familyId: string };
  parent3: { uid: string; email: string; familyId: string };
  babysitter1: { uid: string; email: string };
  babysitter2: { uid: string; email: string };
  babysitter3: { uid: string; email: string };
  babysitter4: { uid: string; email: string }; // inactive
  family1Id: string;
  family2Id: string;
  password: string;
}

export async function seedTestData(): Promise<SeedData> {
  const db = getDb();
  const now = new Date();

  // Admin
  const adminUid = await createUser('admin@syncsit.test', 'Admin User');
  await db.collection('users').doc(adminUid).set({
    uid: adminUid, role: 'admin', email: 'admin@syncsit.test', status: 'active',
    firstName: 'Admin', lastName: 'User', language: 'en',
    notifPrefs: { newRequest: { push: true, email: true }, confirmed: { push: true, email: true }, cancelled: { push: true, email: true }, reminders: { push: true, email: false } },
    fcmTokens: [], createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  });

  // Family 1: Dupont (2 parents)
  const parent1Uid = await createUser('marie.dupont@test.com', 'Marie Dupont');
  const parent2Uid = await createUser('pierre.dupont@test.com', 'Pierre Dupont');
  const family1Id = 'family-dupont';

  await db.collection('users').doc(parent1Uid).set({
    uid: parent1Uid, role: 'parent', email: 'marie.dupont@test.com', status: 'active',
    firstName: 'Marie', lastName: 'Dupont', familyId: family1Id, language: 'fr',
    phone: '+33 612345678',
    notifPrefs: { newRequest: { push: true, email: true }, confirmed: { push: true, email: true }, cancelled: { push: true, email: true }, reminders: { push: true, email: true } },
    fcmTokens: [], createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  });

  await db.collection('users').doc(parent2Uid).set({
    uid: parent2Uid, role: 'parent', email: 'pierre.dupont@test.com', status: 'active',
    firstName: 'Pierre', lastName: 'Dupont', familyId: family1Id, language: 'fr',
    notifPrefs: { newRequest: { push: true, email: true }, confirmed: { push: true, email: true }, cancelled: { push: true, email: true }, reminders: { push: true, email: true } },
    fcmTokens: [], createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  });

  await db.collection('families').doc(family1Id).set({
    familyId: family1Id, familyName: 'Dupont',
    address: '15 Rue de Passy, 75016 Paris',
    latLng: { lat: 48.8566, lng: 2.2769 },
    parentIds: [parent1Uid, parent2Uid],
    preferredBabysitters: [],
    status: 'active',
    verification: { identityStatus: 'approved', enrollmentStatus: 'approved', isFullyVerified: true, isEjmFamily: true },
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  });

  await db.collection('families').doc(family1Id).collection('kids').doc('kid1').set({
    kidId: 'kid1', firstName: 'Lucas', age: 6, languages: ['French', 'English'],
  });
  await db.collection('families').doc(family1Id).collection('kids').doc('kid2').set({
    kidId: 'kid2', firstName: 'Emma', age: 4, languages: ['French'],
  });

  // Family 2: Martin (1 parent, not verified)
  const parent3Uid = await createUser('sophie.martin@test.com', 'Sophie Martin');
  const family2Id = 'family-martin';

  await db.collection('users').doc(parent3Uid).set({
    uid: parent3Uid, role: 'parent', email: 'sophie.martin@test.com', status: 'active',
    firstName: 'Sophie', lastName: 'Martin', familyId: family2Id, language: 'en',
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
    verification: { identityStatus: 'not_submitted', enrollmentStatus: 'not_submitted', isFullyVerified: false, isEjmFamily: false },
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  });

  await db.collection('families').doc(family2Id).collection('kids').doc('kid4').set({
    kidId: 'kid4', firstName: 'Chloe', age: 7, languages: ['English', 'French'],
  });

  // Babysitter 1: Lea — active, weekday evenings, 16e area
  const bs1Uid = await createUser('lea.bernard@ejm.org', 'Lea Bernard');
  await db.collection('users').doc(bs1Uid).set({
    uid: bs1Uid, role: 'babysitter', email: 'lea.bernard@ejm.org', ejemEmail: 'lea.bernard@ejm.org',
    status: 'active', searchable: true,
    firstName: 'Lea', lastName: 'Bernard',
    dateOfBirth: new Date('2008-03-15'), gender: 'female', classLevel: '1ère',
    languages: ['French', 'English'],
    kidAgeRange: { min: 3, max: 10 }, maxKids: 3, hourlyRate: 12,
    contactEmail: 'lea.bernard@ejm.org', contactPhone: '+33 611223344',
    areaMode: 'arrondissement', arrondissements: ['15e', '16e', '7e'],
    areaLatLng: { lat: 48.8530, lng: 2.2750 },
    notifPrefs: { newRequest: { push: true, email: true }, confirmed: { push: true, email: true }, cancelled: { push: true, email: true }, reminders: { push: true, email: true } },
    fcmTokens: [], language: 'fr',
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  });
  await db.collection('schedules').doc(bs1Uid).set({
    weekly: {
      mon: makeSlots([[17, 22]]), tue: makeSlots([[17, 22]]), wed: makeSlots([[14, 22]]),
      thu: makeSlots([[17, 22]]), fri: makeSlots([[17, 23]]),
      sat: makeSlots([[10, 23]]), sun: makeSlots([[10, 20]]),
    },
  });

  // Babysitter 2: Hugo — active, weekends, expensive
  const bs2Uid = await createUser('hugo.leroy@ejm.org', 'Hugo Leroy');
  await db.collection('users').doc(bs2Uid).set({
    uid: bs2Uid, role: 'babysitter', email: 'hugo.leroy@ejm.org', ejemEmail: 'hugo.leroy@ejm.org',
    status: 'active', searchable: true,
    firstName: 'Hugo', lastName: 'Leroy',
    dateOfBirth: new Date('2007-09-22'), gender: 'male', classLevel: 'Terminale',
    languages: ['French', 'English'],
    kidAgeRange: { min: 5, max: 14 }, maxKids: 4, hourlyRate: 15,
    contactEmail: 'hugo.leroy@ejm.org',
    areaMode: 'distance', areaAddress: '8 Rue Lecourbe, 75015 Paris',
    areaLatLng: { lat: 48.8450, lng: 2.3050 }, areaRadiusKm: 5,
    notifPrefs: { newRequest: { push: true, email: true }, confirmed: { push: true, email: true }, cancelled: { push: true, email: true }, reminders: { push: true, email: true } },
    fcmTokens: [], language: 'en',
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  });
  await db.collection('schedules').doc(bs2Uid).set({
    weekly: {
      mon: makeSlots([]), tue: makeSlots([]), wed: makeSlots([[14, 18]]),
      thu: makeSlots([]), fri: makeSlots([[19, 23]]),
      sat: makeSlots([[9, 23]]), sun: makeSlots([[9, 21]]),
    },
  });

  // Babysitter 3: Camille — active, very available
  const bs3Uid = await createUser('camille.moreau@ejm.org', 'Camille Moreau');
  await db.collection('users').doc(bs3Uid).set({
    uid: bs3Uid, role: 'babysitter', email: 'camille.moreau@ejm.org', ejemEmail: 'camille.moreau@ejm.org',
    status: 'active', searchable: true,
    firstName: 'Camille', lastName: 'Moreau',
    dateOfBirth: new Date('2008-06-10'), gender: 'female', classLevel: '1ère',
    languages: ['French', 'English', 'Hebrew'],
    kidAgeRange: { min: 1, max: 12 }, maxKids: 3, hourlyRate: 13,
    contactEmail: 'camille.moreau@ejm.org',
    areaMode: 'arrondissement', arrondissements: ['14e', '15e', '16e', '6e', '7e'],
    areaLatLng: { lat: 48.8480, lng: 2.2800 },
    notifPrefs: { newRequest: { push: true, email: true }, confirmed: { push: true, email: true }, cancelled: { push: true, email: true }, reminders: { push: true, email: true } },
    fcmTokens: [], language: 'fr',
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  });
  await db.collection('schedules').doc(bs3Uid).set({
    weekly: {
      mon: makeSlots([[16, 21]]), tue: makeSlots([[16, 21]]), wed: makeSlots([[10, 21]]),
      thu: makeSlots([[16, 21]]), fri: makeSlots([[16, 23]]),
      sat: makeSlots([[10, 23]]), sun: makeSlots([[10, 20]]),
    },
  });

  // Babysitter 4: Tom — NOT searchable
  const bs4Uid = await createUser('tom.petit@ejm.org', 'Tom Petit');
  await db.collection('users').doc(bs4Uid).set({
    uid: bs4Uid, role: 'babysitter', email: 'tom.petit@ejm.org', ejemEmail: 'tom.petit@ejm.org',
    status: 'active', searchable: false,
    firstName: 'Tom', lastName: 'Petit',
    dateOfBirth: new Date('2009-01-28'), gender: 'male', classLevel: '2nde',
    languages: ['French'],
    kidAgeRange: { min: 6, max: 14 }, maxKids: 2, hourlyRate: 10,
    contactEmail: 'tom.petit@ejm.org',
    areaMode: 'arrondissement', arrondissements: ['16e'],
    areaLatLng: { lat: 48.8600, lng: 2.2700 },
    notifPrefs: { newRequest: { push: true, email: true }, confirmed: { push: true, email: true }, cancelled: { push: true, email: true }, reminders: { push: true, email: true } },
    fcmTokens: [], language: 'fr',
    createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  });

  // References for Lea
  await db.collection('references').add({
    babysitterUserId: bs1Uid, type: 'manual', status: 'approved',
    fullName: 'Claire Dubois', phone: '+33 644556677',
    isEjmFamily: true, numberOfKids: 2, kidAges: [5, 8],
    notes: 'Lea was wonderful with our kids.',
    createdAt: FieldValue.serverTimestamp(),
  });

  return {
    admin: { uid: adminUid, email: 'admin@syncsit.test' },
    parent1: { uid: parent1Uid, email: 'marie.dupont@test.com', familyId: family1Id },
    parent2: { uid: parent2Uid, email: 'pierre.dupont@test.com', familyId: family1Id },
    parent3: { uid: parent3Uid, email: 'sophie.martin@test.com', familyId: family2Id },
    babysitter1: { uid: bs1Uid, email: 'lea.bernard@ejm.org' },
    babysitter2: { uid: bs2Uid, email: 'hugo.leroy@ejm.org' },
    babysitter3: { uid: bs3Uid, email: 'camille.moreau@ejm.org' },
    babysitter4: { uid: bs4Uid, email: 'tom.petit@ejm.org' },
    family1Id,
    family2Id,
    password: PASSWORD,
  };
}
