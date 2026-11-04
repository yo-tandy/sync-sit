import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unit pins for the signed-URL OPTIONS passed to getSignedUrl, and every
// validation branch that fires BEFORE the (mocked) Storage call — mirrors
// createFamilyPhotoUploadUrl.test.ts (issue #471). The integration suite
// (tests/integration/verification/create-verification-document-upload-url.test.ts)
// covers the same branches against the REAL emulator (Firestore membership
// lookup included) but stops short of asserting signer options, since
// offline emulator mode has no GCP credentials to actually sign with.

const h = vi.hoisted(() => ({
  callerData: undefined as Record<string, unknown> | undefined,
  signedUrlCalls: [] as Record<string, unknown>[],
  filePaths: [] as string[],
}));

vi.mock('../../config/firebase.js', () => ({
  db: {
    collection: () => ({
      doc: () => ({
        get: async () => ({ exists: h.callerData !== undefined, data: () => h.callerData }),
      }),
    }),
  },
}));

vi.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: () => ({
      file: (path: string) => {
        h.filePaths.push(path);
        return {
          getSignedUrl: async (options: Record<string, unknown>) => {
            h.signedUrlCalls.push(options);
            return ['https://storage.googleapis.com/signed?sig=abc'];
          },
        };
      },
    }),
  }),
}));

import { createVerificationDocumentUploadUrl } from '../createVerificationDocumentUploadUrl.js';

function call(data: Record<string, unknown>, uid = 'parent1') {
  return createVerificationDocumentUploadUrl.run({
    auth: uid ? { uid } : undefined,
    data,
    rawRequest: {},
  } as never);
}

const VALID = {
  familyId: 'fam1',
  kind: 'identity',
  contentType: 'application/pdf',
  fileName: 'passport.pdf',
  sizeBytes: 1024,
};

beforeEach(() => {
  h.callerData = { profiles: { parent: { familyId: 'fam1' } } };
  h.signedUrlCalls.length = 0;
  h.filePaths.length = 0;
});

describe('createVerificationDocumentUploadUrl', () => {
  it('rejects unauthenticated callers', async () => {
    await expect(
      createVerificationDocumentUploadUrl.run({ auth: undefined, data: VALID, rawRequest: {} } as never),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('rejects a missing/empty familyId', async () => {
    await expect(call({ ...VALID, familyId: '' })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(call({ ...VALID, familyId: undefined })).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it("rejects a kind that isn't 'identity' or 'enrollment'", async () => {
    await expect(call({ ...VALID, kind: 'ejm_enrollment' })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(call({ ...VALID, kind: undefined })).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('accepts kind: enrollment', async () => {
    const result = await call({ ...VALID, kind: 'enrollment' });
    expect(result).toMatchObject({ path: expect.stringMatching(/^verification-documents\/fam1\/enrollment-.+\.pdf$/) });
  });

  it('rejects a missing fileName', async () => {
    await expect(call({ ...VALID, fileName: undefined })).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects a non-string contentType', async () => {
    await expect(call({ ...VALID, contentType: undefined })).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects a missing/invalid sizeBytes', async () => {
    await expect(call({ ...VALID, sizeBytes: undefined })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(call({ ...VALID, sizeBytes: -1 })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(call({ ...VALID, sizeBytes: NaN })).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects a declared size over 10 MB', async () => {
    await expect(
      call({ ...VALID, sizeBytes: 10 * 1024 * 1024 + 1 }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects a renderable/scriptable contentType (image/svg+xml) behind a disallowed extension', async () => {
    await expect(
      call({ ...VALID, contentType: 'image/svg+xml', fileName: 'evil.svg' }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects text/html', async () => {
    await expect(
      call({ ...VALID, contentType: 'text/html', fileName: 'evil.html' }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  // Isolates the content-type DENYLIST from the extension ALLOWLIST: 'evil.svg'/
  // 'evil.html' above would already be rejected by the extension check alone
  // (svg/html aren't in ALLOWED_EXTENSIONS), so those two tests don't by
  // themselves prove the denylist does anything. A renderable contentType
  // behind an ALLOWED extension does.
  it('rejects a renderable contentType even behind an allowed extension (isolates the denylist)', async () => {
    await expect(
      call({ ...VALID, contentType: 'image/svg+xml', fileName: 'passport.pdf' }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('allows an empty contentType (browser File.type quirk)', async () => {
    const result = await call({ ...VALID, contentType: '' });
    expect(result).toMatchObject({ path: expect.stringMatching(/^verification-documents\/fam1\/identity-.+\.pdf$/) });
  });

  it('rejects a disallowed file extension even with an allowed contentType', async () => {
    await expect(
      call({ ...VALID, fileName: 'passport.exe' }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('accepts image extensions too (id photos, not just PDFs)', async () => {
    const result = await call({ ...VALID, contentType: 'image/jpeg', fileName: 'id.jpg' });
    expect(result).toMatchObject({ path: expect.stringMatching(/^verification-documents\/fam1\/identity-.+\.jpg$/) });
  });

  it('rejects a non-member (permission-denied)', async () => {
    h.callerData = { profiles: { parent: { familyId: 'other-fam' } } };
    await expect(call(VALID)).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('rejects a caller with no user doc', async () => {
    h.callerData = undefined;
    await expect(call(VALID)).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('rejects a babysitter (no parent profile, not admin)', async () => {
    h.callerData = { profiles: { babysitter: { firstName: 'B' } } };
    await expect(call(VALID)).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('allows an admin regardless of family membership', async () => {
    h.callerData = { isAdmin: true };
    const result = await call({ ...VALID, familyId: 'someone-elses-family' });
    expect(result).toMatchObject({
      path: expect.stringMatching(/^verification-documents\/someone-elses-family\/identity-.+\.pdf$/),
    });
  });

  it("signs a v4 WRITE url with the given contentType bound in, 5-minute TTL", async () => {
    const before = Date.now();
    const result = await call(VALID);
    expect(result).toEqual({
      url: 'https://storage.googleapis.com/signed?sig=abc',
      path: expect.stringMatching(/^verification-documents\/fam1\/identity-.+\.pdf$/),
    });
    expect(h.signedUrlCalls).toHaveLength(1);
    expect(h.signedUrlCalls[0]).toMatchObject({
      action: 'write',
      version: 'v4',
      contentType: 'application/pdf',
      // The REAL size enforcement (GCS rejects the PUT outside this range
      // at the bucket) — the sizeBytes request-body check above is only a
      // fast-fail on what the client CLAIMS, not what it actually sends.
      extensionHeaders: { 'x-goog-content-length-range': '0,10485760' },
    });
    const expires = h.signedUrlCalls[0].expires as number;
    expect(expires).toBeGreaterThanOrEqual(before + 5 * 60 * 1000 - 2000);
    expect(expires).toBeLessThanOrEqual(before + 5 * 60 * 1000 + 5000);
  });

  it('builds the object path under verification-documents/{familyId}/ with a {kind}-{uuid} basename and the requested extension', async () => {
    await call({ ...VALID, kind: 'enrollment', fileName: 'Certificat_2026.PDF', contentType: 'application/pdf' });
    expect(h.filePaths).toHaveLength(1);
    expect(h.filePaths[0]).toMatch(
      /^verification-documents\/fam1\/enrollment-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/,
    );
  });
});
