import { randomUUID } from 'node:crypto';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getStorage } from 'firebase-admin/storage';
import { isRenderableDocType, MAX_VERIFICATION_DOCUMENT_BYTES } from '@ejm/shared-core';
import { getCorsOrigin } from '../config/cors.js';
import { createSignedUploadUrl } from '../storage/signedUploadUrl.js';
import { assertFamilyMember } from '../family/familyMembership.js';

export { MAX_VERIFICATION_DOCUMENT_BYTES };

/** Explicit allowlist for the OBJECT NAME's extension — separate from, and
 *  narrower than, the isRenderableDocType CONTENT-TYPE denylist below, the
 *  same split createFamilyPhotoUploadUrl uses. Identity/enrollment
 *  documents are phone photos, scans, or PDFs — nothing legitimate produces
 *  any other extension. */
const ALLOWED_EXTENSIONS = new Set(['pdf', 'jpg', 'jpeg', 'png', 'heic', 'heif', 'webp']);

const SIGNED_URL_TTL_MS = 5 * 60 * 1000;

function extensionFromFileName(fileName: string): string {
  const parts = fileName.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase().trim() : '';
}

/**
 * `createVerificationDocumentUploadUrl` (issue #447): the only writer of
 * `verification-documents/**` left once `storage.rules` sets that path's
 * `create, update` to `if false`. Replaces the family-membership check that
 * issue #446 lifted from storage.rules — that check was a cross-service
 * `firestore.get()` which fails closed in production on a missing IAM grant
 * (the #446 outage), denying every parent's upload, not just non-members'.
 * Rather than restore that construct (which #449's guard now fails CI on
 * for any new occurrence), the check moves server-side, mirroring
 * `createFamilyPhotoUploadUrl` (issue #471) — including reusing its exact
 * membership helper (`assertFamilyMember`, `../family/familyMembership.js`) and signing helper
 * (`createSignedUploadUrl`), per that PR's design intent.
 *
 * Input: `{ familyId, kind: 'identity' | 'enrollment', contentType,
 * fileName, sizeBytes }`. Object path:
 * `verification-documents/{familyId}/{kind}-{uuid}.{ext}` — the `kind`
 * prefix keeps identity vs. enrollment documents distinguishable in the
 * bucket listing without a nested prefix (the admin review queue reads via
 * `getVerificationDocument`, keyed by the full path stored in Firestore, so
 * the shape here is free to differ from the old client-chosen
 * `{Date.now()}-{fileName}` naming).
 *
 * `getVerificationDocument` (the READ side) is unchanged — it already
 * enforces its own owner/family-member/admin check via the Admin SDK, no
 * rules involved either.
 */
export const createVerificationDocumentUploadUrl = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const { familyId, kind, contentType, fileName, sizeBytes } = (request.data ?? {}) as {
      familyId?: unknown;
      kind?: unknown;
      contentType?: unknown;
      fileName?: unknown;
      sizeBytes?: unknown;
    };

    if (typeof familyId !== 'string' || familyId.length === 0) {
      throw new HttpsError('invalid-argument', 'familyId is required');
    }
    if (kind !== 'identity' && kind !== 'enrollment') {
      throw new HttpsError('invalid-argument', "kind must be 'identity' or 'enrollment'");
    }
    if (typeof fileName !== 'string' || fileName.length === 0) {
      throw new HttpsError('invalid-argument', 'fileName is required');
    }
    // contentType may legitimately be '' (browser File.type quirk — see
    // isRenderableDocType); undefined/non-string means the client sent
    // nothing at all, which is a caller bug, not a quirky browser.
    if (typeof contentType !== 'string') {
      throw new HttpsError('invalid-argument', 'contentType is required');
    }
    if (typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes) || sizeBytes < 0) {
      throw new HttpsError('invalid-argument', 'sizeBytes is required');
    }
    // Fast-fail on the CLIENT-DECLARED size before doing any Firestore/
    // Storage work. The REAL enforcement is server-side, at the bucket:
    // createSignedUploadUrl below binds MAX_VERIFICATION_DOCUMENT_BYTES
    // into the V4 signature as the x-goog-content-length-range extension
    // header, and GCS rejects any PUT whose actual Content-Length falls
    // outside 0..MAX_VERIFICATION_DOCUMENT_BYTES — see that function's doc
    // comment.
    if (sizeBytes > MAX_VERIFICATION_DOCUMENT_BYTES) {
      throw new HttpsError('invalid-argument', 'Document must be under 10 MB');
    }

    // Content-type denylist — same semantics as the isRenderableDocType
    // rules helper (issue #281/#287), re-implemented in TS because this
    // path never reaches storage.rules at all (the signed URL
    // authenticates as the service account, which bypasses rules
    // entirely).
    if (isRenderableDocType(contentType)) {
      throw new HttpsError('invalid-argument', 'Unsupported document type');
    }

    const ext = extensionFromFileName(fileName);
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw new HttpsError('invalid-argument', 'Unsupported file extension');
    }

    // Membership check — the #446/#153 check, moved server-side. Shared
    // with createFamilyPhotoUploadUrl (issue #471) so the two paths can't
    // drift apart.
    await assertFamilyMember(request.auth.uid, familyId);

    const path = `verification-documents/${familyId}/${kind}-${randomUUID()}.${ext}`;

    try {
      const bucket = getStorage().bucket();
      const url = await createSignedUploadUrl({
        bucket,
        path,
        contentType,
        ttlMs: SIGNED_URL_TTL_MS,
        maxBytes: MAX_VERIFICATION_DOCUMENT_BYTES,
      });
      return { url, path };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error('createVerificationDocumentUploadUrl: failed to sign URL:', err);
      throw new HttpsError('internal', 'Failed to prepare upload');
    }
  },
);
