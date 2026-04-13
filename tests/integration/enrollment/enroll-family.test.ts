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
        kids: [{ firstName: 'Alice', age: 5, languages: ['English'] }],
      }
    );

    expect(result.success).toBe(true);
    expect(result.uid).toBeTruthy();
    expect(result.familyId).toBeTruthy();

    // Verify Firestore docs
    const db = getDb();
    const userDoc = await db.collection('users').doc(result.uid).get();
    expect(userDoc.data()!.role).toBe('parent');
    expect(userDoc.data()!.familyId).toBe(result.familyId);

    const familyDoc = await db.collection('families').doc(result.familyId).get();
    expect(familyDoc.data()!.familyName).toBe('TestFamily');
    expect(familyDoc.data()!.parentIds).toContain(result.uid);
  });
});
