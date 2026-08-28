import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { DO_PHOTO_ID_RE } from '@ejm/do-core';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { getDefaultBucket, photoObjectPath } from './taskAccess.js';

const SIGNED_URL_TTL_MS = 15 * 60 * 1000;

/**
 * `doGetOwnPhotoUrl` (plan §8, §7.4's return leg): signs a short-lived URL
 * for a photo under the CALLER'S OWN `do-photos/{uid}/` prefix — the
 * wizard's pre-task thumbnail path. The final prefix is `allow read: if
 * false`, so this callable is the only way the uploader sees their own
 * stripped photo before a task exists; `not-found` doubles as the "not yet
 * stripped" retry signal (the trigger republishes within seconds).
 *
 * Audience: the caller themselves, and only while ACTIVE — the path is
 * built from the caller's uid, so the callable structurally exposes only
 * the caller's own post-strip uploads, but a blocked account must not keep
 * a working signing endpoint (its five sibling callables all gate on
 * `status === 'active'`).
 */
export const doGetOwnPhotoUrl = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const callerDoc = await db.collection('users').doc(request.auth.uid).get();
    if ((callerDoc.data()?.status as string | undefined) !== 'active') {
      throw new HttpsError('permission-denied', 'Account is not active');
    }
    const { photoId } = (request.data ?? {}) as { photoId?: unknown };
    if (typeof photoId !== 'string' || !DO_PHOTO_ID_RE.test(photoId)) {
      throw new HttpsError('invalid-argument', 'photoId is not a valid id');
    }

    const file = getDefaultBucket().file(
      photoObjectPath(request.auth.uid, photoId),
    );
    try {
      const [exists] = await file.exists();
      if (!exists) {
        throw new HttpsError('not-found', 'Photo not found (still processing?)', {
          reason: 'photo_not_ready',
        });
      }
      // v4, like getVerificationDocument: the signature must cover the full
      // query string. No attachment disposition — the stripper re-encoded
      // the bytes and server-set an image/* contentType, so inline render
      // is the point (these are <img> thumbnails).
      const [signedUrl] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + SIGNED_URL_TTL_MS,
        version: 'v4',
      });
      return { url: signedUrl };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error('doGetOwnPhotoUrl: failed to sign URL:', err);
      throw new HttpsError('internal', 'Failed to access photo');
    }
  },
);
