import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getDb } from '../../setup/emulator.js';

describe('enrollFamily', () => {
  const email = 'newparent@test.com';
  let verificationCode: string;

  beforeAll(async () => {
    await clearAll();

    // Send verification code via the function
    await callFunction('verifyParentEmail', { email });

    // Read it back from Firestore (function stores by lowercased email)
    const db = getDb();
    const normalizedEmail = email.trim().toLowerCase();
    const codeDoc = await db.collection('verificationCodes').doc(normalizedEmail).get();
    if (!codeDoc.exists) {
      throw new Error(`Verification code doc not found for ${normalizedEmail}`);
    }
    verificationCode = codeDoc.data()!.code;
  });

  afterAll(async () => {
    await clearAll();
  });

  it('creates family and parent with valid data', async () => {
    const result = await callFunction<{ success: boolean; uid: string; familyId: string }>(
      'enrollFamily',
      {
        email,
        verificationCode,
        password: 'Test1234',
        familyName: 'TestFamily',
        firstName: 'Jane',
        address: '10 Rue de Rivoli, 75001 Paris',
        latLng: { lat: 48.8606, lng: 2.3376 },
        postcode: '75001',
        city: 'Paris',
        kids: [{ firstName: 'Alice', age: 5, languages: ['English'] }],
      }
    );

    expect(result.success).toBe(true);
    expect(result.uid).toBeTruthy();
    expect(result.familyId).toBeTruthy();

    // Verify Firestore docs
    const db = getDb();
    const userDoc = await db.collection('users').doc(result.uid).get();
    expect(userDoc.data()!.profiles.parent.familyId).toBe(result.familyId);
    expect(userDoc.data()!.profiles.parent.enrollmentComplete).toBe(true);
    expect(userDoc.data()!.role).toBeUndefined();
    // No consentVersion in the payload (legacy sit client) — the server
    // default keeps the pre-#178 record byte-identical.
    expect(userDoc.data()!.consentVersion).toBe('1.0');

    const familyDoc = await db.collection('families').doc(result.familyId).get();
    expect(familyDoc.data()!.familyName).toBe('TestFamily');
    expect(familyDoc.data()!.parentIds).toContain(result.uid);
    // Geocoder components persisted (issue #167): search resolves the
    // family's coverage-area label from these without an address re-pick.
    expect(familyDoc.data()!.postcode).toBe('75001');
    expect(familyDoc.data()!.city).toBe('Paris');
  });

  it('stores null postcode/city when the client sends none (legacy payload shape)', async () => {
    const email2 = 'newparent2@test.com';
    await callFunction('verifyParentEmail', { email: email2 });
    const db = getDb();
    const codeDoc = await db.collection('verificationCodes').doc(email2).get();
    const code2 = codeDoc.data()!.code;

    const result = await callFunction<{ success: boolean; familyId: string }>('enrollFamily', {
      email: email2,
      verificationCode: code2,
      password: 'Test1234',
      familyName: 'LegacyFamily',
      firstName: 'Joan',
      address: '5 Rue Sans Geocode, Paris',
      latLng: { lat: 48.86, lng: 2.33 },
      kids: [],
    });

    expect(result.success).toBe(true);
    const familyDoc = await db.collection('families').doc(result.familyId).get();
    expect(familyDoc.data()!.postcode).toBeNull();
    expect(familyDoc.data()!.city).toBeNull();
  });

  it('persists the consentVersion the client presented (study wizard, issue #178)', async () => {
    const email3 = 'newparent3@test.com';
    await callFunction('verifyParentEmail', { email: email3, app: 'study' });
    const db = getDb();
    const codeDoc = await db.collection('verificationCodes').doc(email3).get();
    const code3 = codeDoc.data()!.code;

    const result = await callFunction<{ success: boolean; uid: string }>('enrollFamily', {
      email: email3,
      verificationCode: code3,
      password: 'Test1234',
      familyName: 'StudyFamily',
      firstName: 'Joy',
      address: '10 Rue Cler, 75007 Paris',
      latLng: { lat: 48.857, lng: 2.305 },
      postcode: '75007',
      city: 'Paris',
      kids: [],
      consentVersion: '2025-12-01',
    });

    expect(result.success).toBe(true);
    const userDoc = await db.collection('users').doc(result.uid).get();
    // The version the consent step actually showed — not sit's '1.0'.
    expect(userDoc.data()!.consentVersion).toBe('2025-12-01');
  });
});
