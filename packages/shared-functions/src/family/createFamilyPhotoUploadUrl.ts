import { randomUUID } from 'node:crypto';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getStorage } from 'firebase-admin/storage';
import {
  isAdmin,
  getParentProfile,
  isRenderableDocType,
  MAX_FAMILY_PHOTO_BYTES,
  type User,
} from '@ejm/shared-core';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { createSignedUploadUrl } from '../storage/signedUploadUrl.js';

export { MAX_FAMILY_PHOTO_BYTES };

/** Explicit allowlist for the OBJECT NAME's extension — separate from, and
 *  narrower than, the isRenderableDocType CONTENT-TYPE denylist below. The
 *  denylist stays permissive on contentType (empty/application/octet-stream
 *  must keep working — browser File.type quirks), but nothing requires the
 *  stored object's file extension to be equally permissive: bounding it to
 *  real photo extensions costs no legitimate upload (phones/scanners/camera
 *  rolls only ever produce these) and keeps the object name predictable. */
const ALLOWED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'gif']);

const SIGNED_URL_TTL_MS = 5 * 60 * 1000;

function extensionFromFileName(fileName: string): string {
  const parts = fileName.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase().trim() : '';
}

/**
 * `createFamilyPhotoUploadUrl` (issue #471): the only writer of
 * `family-photos/**` left once `storage.rules` sets that path's
 * `create, update` to `if false` (see the storage.rules comment). Storage
 * rules cannot check family membership without either a custom claim (none
 * exists — `setCustomUserClaims` has zero hits repo-wide) or a
 * cross-service `firestore.get()` (the construct that caused the #446
 * production outage and that #449's guard, PR #462, now fails CI on for
 * any new occurrence). Moving the check into a callable sidesteps both:
 * the Admin SDK reads Firestore directly, no rules involved, and the
 * resulting upload authenticates to Storage as the service account, which
 * bypasses rules entirely.
 *
 * Mirrors `getVerificationDocument`'s shape (auth → Admin-SDK authorization
 * → short-lived V4 signed URL) in the write direction, and its own
 * predecessor `canWriteFamilyDocs(callerData(), familyId)` in storage.rules
 * EXACTLY: `isAdmin(caller) || getParentProfile(caller)?.familyId ===
 * familyId` — same admin break-glass disjunct, same single field compared.
 *
 * Deliberately generic on the family model rather than sit-specific: the
 * membership fields it reads (`profiles.parent.familyId`, `isAdmin`) live
 * in `@ejm/shared-core`, not `@ejm/sit-core` — study-web's FamilySettingsPage
 * has no photo plumbing yet, but nothing here assumes sit. The signing
 * helper (`createSignedUploadUrl`) is factored out of this file for the
 * same reason issue #471 calls out: #447's verification-document upload
 * needs the identical v4-signed-PUT shape and should not re-derive it.
 */
export const createFamilyPhotoUploadUrl = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const { familyId, contentType, fileName, sizeBytes } = (request.data ?? {}) as {
      familyId?: unknown;
      contentType?: unknown;
      fileName?: unknown;
      sizeBytes?: unknown;
    };

    if (typeof familyId !== 'string' || familyId.length === 0) {
      throw new HttpsError('invalid-argument', 'familyId is required');
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
    // createSignedUploadUrl below binds MAX_FAMILY_PHOTO_BYTES into the V4
    // signature as the x-goog-content-length-range extension header, and
    // GCS rejects any PUT whose actual Content-Length falls outside
    // 0..MAX_FAMILY_PHOTO_BYTES — see that function's doc comment.
    if (sizeBytes > MAX_FAMILY_PHOTO_BYTES) {
      throw new HttpsError('invalid-argument', 'Photo must be under 10 MB');
    }

    // Content-type denylist — same semantics as storage.rules'
    // isRenderableDocType, re-implemented in TS because this path never
    // reaches storage.rules at all (the signed URL authenticates as the
    // service account, which bypasses rules entirely).
    if (isRenderableDocType(contentType)) {
      throw new HttpsError('invalid-argument', 'Unsupported photo type');
    }

    const ext = extensionFromFileName(fileName);
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw new HttpsError('invalid-argument', 'Unsupported file extension');
    }

    // Membership check — mirrors storage.rules' (currently-unreachable,
    // pending this callable) canWriteFamilyDocs(callerData(), familyId)
    // exactly: admin, or the caller's OWN profiles.parent.familyId.
    const callerDoc = await db.collection('users').doc(request.auth.uid).get();
    const caller = callerDoc.data() as User | undefined;
    if (!caller) {
      throw new HttpsError('permission-denied', 'User not found');
    }
    const isMember = isAdmin(caller) || getParentProfile(caller)?.familyId === familyId;
    if (!isMember) {
      throw new HttpsError('permission-denied', 'You are not a member of this family');
    }

    const path = `family-photos/${familyId}/${randomUUID()}.${ext}`;

    try {
      const bucket = getStorage().bucket();
      const url = await createSignedUploadUrl({
        bucket,
        path,
        contentType,
        ttlMs: SIGNED_URL_TTL_MS,
        maxBytes: MAX_FAMILY_PHOTO_BYTES,
      });
      return { url, path };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error('createFamilyPhotoUploadUrl: failed to sign URL:', err);
      throw new HttpsError('internal', 'Failed to prepare upload');
    }
  },
);
