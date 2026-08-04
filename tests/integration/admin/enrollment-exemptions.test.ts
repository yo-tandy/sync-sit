import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, callFunction, getIdToken, getDb } from '../../setup/emulator.js';
import { seedTestData, type SeedData } from '../../setup/seed.js';

interface ExemptionEntry {
  email: string;
  note: string | null;
  createdByUid: string;
  createdAt: unknown;
}

describe('enrollment exemption admin callables', () => {
  let seed: SeedData;
  let adminToken: string;
  let parentToken: string;

  beforeAll(async () => {
    await clearAll();
    seed = await seedTestData();
    adminToken = await getIdToken(seed.admin.uid);
    parentToken = await getIdToken(seed.parent1.uid);
  });

  afterAll(async () => {
    await clearAll();
  });

  it('set → list shows it → remove → gone', async () => {
    await callFunction(
      'setEnrollmentExemption',
      { email: 'repeater29@ejm.org', note: 'repeated seconde, DOB checks out' },
      adminToken,
    );

    // Doc id is the lowercased email; shape per the governance design.
    const docSnap = await getDb()
      .collection('enrollmentExemptions')
      .doc('repeater29@ejm.org')
      .get();
    expect(docSnap.exists).toBe(true);
    expect(docSnap.data()!.createdByUid).toBe(seed.admin.uid);
    expect(docSnap.data()!.note).toBe('repeated seconde, DOB checks out');
    expect(docSnap.data()!.createdAt).toBeTruthy();

    const listed = await callFunction<{ exemptions: ExemptionEntry[] }>(
      'listEnrollmentExemptions',
      {},
      adminToken,
    );
    const entry = listed.exemptions.find((e) => e.email === 'repeater29@ejm.org');
    expect(entry).toBeTruthy();
    expect(entry!.note).toBe('repeated seconde, DOB checks out');
    expect(entry!.createdByUid).toBe(seed.admin.uid);

    await callFunction('removeEnrollmentExemption', { email: 'repeater29@ejm.org' }, adminToken);

    const afterRemove = await getDb()
      .collection('enrollmentExemptions')
      .doc('repeater29@ejm.org')
      .get();
    expect(afterRemove.exists).toBe(false);

    const listedAfter = await callFunction<{ exemptions: ExemptionEntry[] }>(
      'listEnrollmentExemptions',
      {},
      adminToken,
    );
    expect(listedAfter.exemptions.find((e) => e.email === 'repeater29@ejm.org')).toBeUndefined();
  });

  it('normalizes the email (trim + lowercase) into the doc id', async () => {
    await callFunction(
      'setEnrollmentExemption',
      { email: '  Mixed.Case29@EJM.org ' },
      adminToken,
    );
    const docSnap = await getDb()
      .collection('enrollmentExemptions')
      .doc('mixed.case29@ejm.org')
      .get();
    expect(docSnap.exists).toBe(true);
    // note omitted → stored as null (uniform wire shape for the admin panel)
    expect(docSnap.data()!.note).toBeNull();
    await callFunction('removeEnrollmentExemption', { email: 'MIXED.CASE29@ejm.org' }, adminToken);
    expect(
      (await getDb().collection('enrollmentExemptions').doc('mixed.case29@ejm.org').get()).exists,
    ).toBe(false);
  });

  it('writes an audit log entry on set and remove', async () => {
    await callFunction('setEnrollmentExemption', { email: 'audited29@ejm.org' }, adminToken);
    await callFunction('removeEnrollmentExemption', { email: 'audited29@ejm.org' }, adminToken);

    const logs = await getDb()
      .collection('auditLogs')
      .where('adminUserId', '==', seed.admin.uid)
      .get();
    const actions = logs.docs.map((d) => d.data().action);
    expect(actions).toContain('set_enrollment_exemption');
    expect(actions).toContain('remove_enrollment_exemption');
  });

  it('rejects an invalid email with invalid-argument', async () => {
    await expect(
      callFunction('setEnrollmentExemption', { email: 'not-an-email' }, adminToken),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects a note longer than 500 chars', async () => {
    await expect(
      callFunction(
        'setEnrollmentExemption',
        { email: 'longnote29@ejm.org', note: 'x'.repeat(501) },
        adminToken,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('non-admin caller gets permission-denied on all three', async () => {
    await expect(
      callFunction('setEnrollmentExemption', { email: 'kid29@ejm.org' }, parentToken),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(
      callFunction('removeEnrollmentExemption', { email: 'kid29@ejm.org' }, parentToken),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(
      callFunction('listEnrollmentExemptions', {}, parentToken),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('unauthenticated caller is rejected', async () => {
    await expect(callFunction('listEnrollmentExemptions', {})).rejects.toThrow();
  });
});
