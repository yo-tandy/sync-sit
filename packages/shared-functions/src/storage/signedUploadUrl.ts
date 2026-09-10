import { getStorage } from 'firebase-admin/storage';

/** Structural bucket type — mirrors apps/functions/src/do/taskAccess.ts's
 *  StorageBucket trick: avoids a direct @google-cloud/storage import (a
 *  transitive dep) by deriving the type from firebase-admin/storage's own
 *  return type. */
export type StorageBucket = ReturnType<ReturnType<typeof getStorage>['bucket']>;

export interface SignedUploadUrlOptions {
  bucket: StorageBucket;
  /** Full object path, e.g. `family-photos/{familyId}/{uuid}.jpg`. */
  path: string;
  /** Bound into the V4 signature — the PUT request's Content-Type header
   *  must match exactly or GCS rejects the upload with SignatureDoesNotMatch. */
  contentType: string;
  /** Defaults to 5 minutes — short-lived, matching the issue #471 ask. */
  ttlMs?: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;

/**
 * Mints a short-lived V4 signed PUT URL for a Cloud Storage object.
 *
 * Shared plumbing (issue #471, designed for #447's verification-document
 * upload to reuse too): every signed-URL-mediated upload in this codebase
 * needs the SAME shape — a v4 signature (the SDK's v2 default leaves some
 * query params unsigned, e.g. the responseDisposition gap `getVerificationDocument`
 * documents on the READ side) bound to an expiry and a content type, over
 * the DEFAULT bucket. Pulling it out here means #447's callable does not
 * re-derive this from scratch.
 *
 * Deliberately does NOT do authorization, content-type-denylist, or
 * extension validation — those are caller concerns (the family/verification
 * membership checks differ per path). This function's only job is signing.
 */
export async function createSignedUploadUrl(
  options: SignedUploadUrlOptions,
): Promise<string> {
  const { bucket, path, contentType, ttlMs = DEFAULT_TTL_MS } = options;
  const file = bucket.file(path);
  const [url] = await file.getSignedUrl({
    action: 'write',
    expires: Date.now() + ttlMs,
    version: 'v4',
    contentType,
  });
  return url;
}
