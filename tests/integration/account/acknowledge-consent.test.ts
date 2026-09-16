import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { CONSENT_VERSION } from '@ejm/shared-core';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

/**
 * `acknowledgeConsent` (issue #488 decision 1) against the emulator: the
 * write the re-consent gate makes, and the two refusals that keep it honest
 * (a stale client cannot stamp the live version; a current record is not
 * re-stamped).
 */
describe('acknowledgeConsent', () => {
  let seed: SeedData;

  beforeEach(async () => {
    await clearAll();
    seed = await seedTestData();
  });

  afterAll(async () => {
    await clearAll();
  });

  it('rejects unauthenticated callers', async () => {
    await expect(
      callFunction('acknowledgeConsent', { consentVersion: CONSENT_VERSION }, null as never),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('refuses a client presenting a version other than the live one', async () => {
    const token = await getIdToken(seed.parent1.uid);
    await expect(
      callFunction('acknowledgeConsent', { consentVersion: '0.9' }, token),
    ).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION',
      details: { code: 'consent/stale-client', current: CONSENT_VERSION },
    });
  });

  it('re-stamps a stale record to the live version, sets consentAt, and audits the previous value', async () => {
    const ref = getDb().collection('users').doc(seed.parent1.uid);
    await ref.update({ consentVersion: '0.9' });
    const token = await getIdToken(seed.parent1.uid);

    const result = await callFunction<{ success: boolean; consentVersion: string; alreadyCurrent: boolean }>(
      'acknowledgeConsent',
      { consentVersion: CONSENT_VERSION },
      token,
    );
    expect(result).toEqual({ success: true, consentVersion: CONSENT_VERSION, alreadyCurrent: false });

    const after = (await ref.get()).data()!;
    expect(after.consentVersion).toBe(CONSENT_VERSION);
    expect(after.consentAt).toBeTruthy();

    const logs = await getDb()
      .collection('auditLogs')
      .where('action', '==', 'acknowledge_consent')
      .where('adminUserId', '==', seed.parent1.uid)
      .get();
    expect(logs.docs).toHaveLength(1);
    expect(logs.docs[0].data().details).toMatchObject({
      previousConsentVersion: '0.9',
      consentVersion: CONSENT_VERSION,
    });
  });

  it('is a no-op on a record that is already current: no write, no audit entry', async () => {
    const ref = getDb().collection('users').doc(seed.parent1.uid);
    const before = (await ref.get()).data()!;
    const token = await getIdToken(seed.parent1.uid);

    const result = await callFunction<{ alreadyCurrent: boolean }>(
      'acknowledgeConsent',
      { consentVersion: CONSENT_VERSION },
      token,
    );
    expect(result.alreadyCurrent).toBe(true);
    expect((await ref.get()).data()!.updatedAt).toEqual(before.updatedAt);
    const logs = await getDb().collection('auditLogs').where('action', '==', 'acknowledge_consent').get();
    expect(logs.size).toBe(0);
  });
});
