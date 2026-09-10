import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unit pins for the signed-URL OPTIONS passed to getSignedUrl, and every
// validation branch that fires BEFORE the (mocked) Storage call — mirrors
// getVerificationDocument.test.ts. The integration suite
// (tests/integration/family/create-family-photo-upload-url.test.ts) covers
// the same branches against the REAL emulator (Firestore membership lookup
// included) but stops short of asserting signer options, since offline
// emulator mode has no GCP credentials to actually sign with.

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

import { createFamilyPhotoUploadUrl } from '../createFamilyPhotoUploadUrl.js';

function call(data: Record<string, unknown>, uid = 'parent1') {
  return createFamilyPhotoUploadUrl.run({
    auth: uid ? { uid } : undefined,
    data,
    rawRequest: {},
  } as never);
}

const VALID = { familyId: 'fam1', contentType: 'image/jpeg', fileName: 'photo.jpg', sizeBytes: 1024 };

beforeEach(() => {
  h.callerData = { profiles: { parent: { familyId: 'fam1' } } };
  h.signedUrlCalls.length = 0;
  h.filePaths.length = 0;
});

describe('createFamilyPhotoUploadUrl', () => {
  it('rejects unauthenticated callers', async () => {
    await expect(
      createFamilyPhotoUploadUrl.run({ auth: undefined, data: VALID, rawRequest: {} } as never),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('rejects a missing/empty familyId', async () => {
    await expect(call({ ...VALID, familyId: '' })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(call({ ...VALID, familyId: undefined })).rejects.toMatchObject({ code: 'invalid-argument' });
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

  it('rejects a renderable/scriptable contentType (image/svg+xml)', async () => {
    await expect(
      call({ ...VALID, contentType: 'image/svg+xml', fileName: 'evil.svg' }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects text/html', async () => {
    await expect(
      call({ ...VALID, contentType: 'text/html', fileName: 'evil.html' }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  // Isolates the content-type DENYLIST from the extension ALLOWLIST: both
  // 'evil.svg'/'evil.html' above would already be rejected by the
  // extension check alone (svg/html aren't in ALLOWED_EXTENSIONS), so
  // those two tests don't by themselves prove the denylist does anything.
  // A renderable contentType behind an ALLOWED extension does.
  it('rejects a renderable contentType even behind an allowed extension (isolates the denylist)', async () => {
    await expect(
      call({ ...VALID, contentType: 'image/svg+xml', fileName: 'photo.jpg' }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('allows an empty contentType (browser File.type quirk)', async () => {
    const result = await call({ ...VALID, contentType: '' });
    expect(result).toMatchObject({ path: expect.stringMatching(/^family-photos\/fam1\/.+\.jpg$/) });
  });

  it('rejects a disallowed file extension even with an allowed contentType', async () => {
    await expect(
      call({ ...VALID, fileName: 'photo.exe' }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects a non-member (permission-denied)', async () => {
    h.callerData = { profiles: { parent: { familyId: 'other-fam' } } };
    await expect(call(VALID)).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('rejects a caller with no user doc', async () => {
    h.callerData = undefined;
    await expect(call(VALID)).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('allows an admin regardless of family membership', async () => {
    h.callerData = { isAdmin: true };
    const result = await call({ ...VALID, familyId: 'someone-elses-family' });
    expect(result).toMatchObject({
      path: expect.stringMatching(/^family-photos\/someone-elses-family\/.+\.jpg$/),
    });
  });

  it("signs a v4 WRITE url with the given contentType bound in, 5-minute TTL", async () => {
    const before = Date.now();
    const result = await call(VALID);
    expect(result).toEqual({
      url: 'https://storage.googleapis.com/signed?sig=abc',
      path: expect.stringMatching(/^family-photos\/fam1\/.+\.jpg$/),
    });
    expect(h.signedUrlCalls).toHaveLength(1);
    expect(h.signedUrlCalls[0]).toMatchObject({
      action: 'write',
      version: 'v4',
      contentType: 'image/jpeg',
    });
    const expires = h.signedUrlCalls[0].expires as number;
    expect(expires).toBeGreaterThanOrEqual(before + 5 * 60 * 1000 - 2000);
    expect(expires).toBeLessThanOrEqual(before + 5 * 60 * 1000 + 5000);
  });

  it('builds the object path under family-photos/{familyId}/ with a uuid basename and the requested extension', async () => {
    await call({ ...VALID, fileName: 'IMG_1234.HEIC', contentType: 'image/heic' });
    expect(h.filePaths).toHaveLength(1);
    expect(h.filePaths[0]).toMatch(
      /^family-photos\/fam1\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.heic$/,
    );
  });
});
