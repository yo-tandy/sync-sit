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
  /**
   * Upper bound on the ACTUAL uploaded byte count, enforced by GCS itself —
   * unlike a caller-declared sizeBytes check (which only bounds what the
   * client SAYS it's about to send), this is bound into the V4 signature as
   * the `x-goog-content-length-range` extension header, so the signed PUT
   * request must carry that same header and GCS rejects any request whose
   * real Content-Length falls outside `0,maxBytes` at the bucket — before a
   * single oversized byte lands. Omit to sign without a range (no caller
   * currently does; every known use of this helper sets it).
   */
  maxBytes?: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;

/**
 * Mints a short-lived V4 signed PUT URL for a Cloud Storage object.
 *
 * Shared plumbing (issue #471, designed for #447's verification-document
 * upload to reuse too): every signed-URL-mediated upload in this codebase
 * needs the SAME shape — a v4 signature (the SDK's v2 default leaves some
 * query params unsigned, e.g. the responseDisposition gap `getVerificationDocument`
 * documents on the READ side) bound to an expiry, a content type, and (when
 * maxBytes is given) a content-length range — over the DEFAULT bucket.
 * Pulling it out here means #447's callable does not re-derive this from
 * scratch.
 *
 * Deliberately does NOT do authorization, content-type-denylist, or
 * extension validation — those are caller concerns (the family/verification
 * membership checks differ per path). This function's only job is signing.
 */
export async function createSignedUploadUrl(
  options: SignedUploadUrlOptions,
): Promise<string> {
  const { bucket, path, contentType, ttlMs = DEFAULT_TTL_MS, maxBytes } = options;
  const file = bucket.file(path);
  const [url] = await file.getSignedUrl({
    action: 'write',
    expires: Date.now() + ttlMs,
    version: 'v4',
    contentType,
    ...(maxBytes != null
      ? { extensionHeaders: { 'x-goog-content-length-range': `0,${maxBytes}` } }
      : {}),
  });
  return url;
}
