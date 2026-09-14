import { describe, it, expect } from 'vitest';
import { createSignedUploadUrl, type StorageBucket } from '../signedUploadUrl.js';

function fakeBucket(signedUrlCalls: Record<string, unknown>[]): StorageBucket {
  return {
    file: (path: string) => ({
      getSignedUrl: async (options: Record<string, unknown>) => {
        signedUrlCalls.push({ path, ...options });
        return ['https://storage.googleapis.com/signed?sig=abc'];
      },
    }),
  } as unknown as StorageBucket;
}

describe('createSignedUploadUrl', () => {
  it("signs a v4 write URL with the given contentType bound in", async () => {
    const calls: Record<string, unknown>[] = [];
    const url = await createSignedUploadUrl({
      bucket: fakeBucket(calls),
      path: 'family-photos/fam1/abc.jpg',
      contentType: 'image/jpeg',
    });
    expect(url).toBe('https://storage.googleapis.com/signed?sig=abc');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      path: 'family-photos/fam1/abc.jpg',
      action: 'write',
      version: 'v4',
      contentType: 'image/jpeg',
    });
  });

  it('defaults the TTL to 5 minutes', async () => {
    const calls: Record<string, unknown>[] = [];
    const before = Date.now();
    await createSignedUploadUrl({
      bucket: fakeBucket(calls),
      path: 'p',
      contentType: 'image/png',
    });
    const expires = calls[0].expires as number;
    expect(expires).toBeGreaterThanOrEqual(before + 5 * 60 * 1000 - 1000);
    expect(expires).toBeLessThanOrEqual(before + 5 * 60 * 1000 + 5000);
  });

  it('honors a custom ttlMs', async () => {
    const calls: Record<string, unknown>[] = [];
    const before = Date.now();
    await createSignedUploadUrl({
      bucket: fakeBucket(calls),
      path: 'p',
      contentType: 'image/png',
      ttlMs: 60_000,
    });
    const expires = calls[0].expires as number;
    expect(expires).toBeGreaterThanOrEqual(before + 60_000 - 1000);
    expect(expires).toBeLessThanOrEqual(before + 60_000 + 5000);
  });

  it('never passes action: "read" (it must always sign a write)', async () => {
    const calls: Record<string, unknown>[] = [];
    await createSignedUploadUrl({
      bucket: fakeBucket(calls),
      path: 'p',
      contentType: 'image/png',
    });
    expect(calls[0].action).not.toBe('read');
  });

  it('binds maxBytes into the signature as x-goog-content-length-range, "0,<maxBytes>" — the REAL server-side size enforcement (GCS rejects the PUT outside this range at the bucket, unlike a caller-declared size check)', async () => {
    const calls: Record<string, unknown>[] = [];
    await createSignedUploadUrl({
      bucket: fakeBucket(calls),
      path: 'p',
      contentType: 'image/jpeg',
      maxBytes: 10 * 1024 * 1024,
    });
    expect(calls[0].extensionHeaders).toEqual({
      'x-goog-content-length-range': '0,10485760',
    });
  });

  it('omits extensionHeaders entirely when maxBytes is not given', async () => {
    const calls: Record<string, unknown>[] = [];
    await createSignedUploadUrl({
      bucket: fakeBucket(calls),
      path: 'p',
      contentType: 'image/jpeg',
    });
    expect(calls[0].extensionHeaders).toBeUndefined();
  });
});
