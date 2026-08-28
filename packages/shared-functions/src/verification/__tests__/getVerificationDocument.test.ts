import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unit pins for the signed-URL OPTIONS passed to getSignedUrl (issue #281).
// The integration suite (tests/integration/verification/
// get-verification-document.test.ts) deliberately stops at the authz gate:
// signed-URL generation needs GCP credentials the offline emulator lacks, so
// the disposition can only be pinned here, at the options-passed seam.
// Storage and Firestore are mocked; authz branches are covered end to end by
// the emulator suite.

const h = vi.hoisted(() => ({
  callerData: undefined as Record<string, unknown> | undefined,
  fileExists: true,
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
          exists: async () => [h.fileExists],
          getSignedUrl: async (options: Record<string, unknown>) => {
            h.signedUrlCalls.push(options);
            return ['https://storage.googleapis.com/signed?sig=abc'];
          },
        };
      },
    }),
  }),
}));

import { getVerificationDocument } from '../getVerificationDocument.js';

function call(filePath: string, uid = 'admin1') {
  // v2 callables expose the raw handler via .run() for unit tests.
  return getVerificationDocument.run({
    auth: { uid },
    data: { filePath },
    rawRequest: {},
  } as never);
}

beforeEach(() => {
  h.callerData = { isAdmin: true };
  h.fileExists = true;
  h.signedUrlCalls.length = 0;
  h.filePaths.length = 0;
});

describe('getVerificationDocument signed-URL options', () => {
  it("passes responseDisposition: 'attachment' so documents download instead of rendering", async () => {
    // Uploads carry an attacker-controllable contentType (client passes
    // browser File.type through); without the attachment disposition a
    // text/html upload renders as a live page on storage.googleapis.com
    // when an admin opens it from the review queue.
    const result = await call('verification-documents/family1/id.pdf');
    expect(result).toEqual({ url: 'https://storage.googleapis.com/signed?sig=abc' });
    expect(h.signedUrlCalls).toHaveLength(1);
    expect(h.signedUrlCalls[0]).toMatchObject({
      action: 'read',
      responseDisposition: 'attachment',
    });
  });

  it('keeps the 15-minute expiry window', async () => {
    const before = Date.now();
    await call('verification-documents/family1/id.pdf');
    const after = Date.now();
    const expires = h.signedUrlCalls[0].expires as number;
    expect(expires).toBeGreaterThanOrEqual(before + 15 * 60 * 1000);
    expect(expires).toBeLessThanOrEqual(after + 15 * 60 * 1000);
  });

  it('requests the URL for the exact path the caller asked for', async () => {
    await call('verification-documents/family1/1724700000000-scan.pdf');
    expect(h.filePaths).toEqual(['verification-documents/family1/1724700000000-scan.pdf']);
  });

  it('does not reach getSignedUrl when the file does not exist', async () => {
    h.fileExists = false;
    // Server-side HttpsError carries the bare FunctionsErrorCode (the
    // 'functions/' prefix is added by the client SDK).
    await expect(call('verification-documents/family1/missing.pdf')).rejects.toMatchObject({
      code: 'not-found',
    });
    expect(h.signedUrlCalls).toHaveLength(0);
  });
});
