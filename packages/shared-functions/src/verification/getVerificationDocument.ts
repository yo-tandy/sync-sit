import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { isAdmin, getParentProfile, type User } from '@ejm/shared-core';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { getStorage } from 'firebase-admin/storage';

/**
 * Proxy for reading verification documents.
 * Only allows access if the caller is a family member or an admin.
 * Returns a short-lived signed URL (15 minutes).
 */
export const getVerificationDocument = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const { filePath } = request.data as { filePath: string };

    if (!filePath || !filePath.startsWith('verification-documents/')) {
      throw new HttpsError('invalid-argument', 'Invalid file path');
    }

    // Extract the owning id from path: verification-documents/{ownerId}/{filename}
    // ownerId is a familyId for family docs and the uploader's uid for tutor docs.
    const parts = filePath.split('/');
    if (parts.length < 3) {
      throw new HttpsError('invalid-argument', 'Invalid file path');
    }
    const ownerId = parts[1];

    // Check authorization: must be the document owner, a family member, or admin
    const callerDoc = await db.collection('users').doc(request.auth.uid).get();
    const caller = callerDoc.data();

    if (!caller) {
      throw new HttpsError('permission-denied', 'User not found');
    }

    const isAdminCaller = isAdmin(caller as User | undefined);
    // Tutor docs are keyed by the uploader's uid: the owner reads their own.
    const isOwner = ownerId === request.auth.uid;
    let isFamilyMember = false;

    if (getParentProfile(caller as User | undefined)?.familyId === ownerId) {
      isFamilyMember = true;
    }

    if (!isAdminCaller && !isOwner && !isFamilyMember) {
      throw new HttpsError('permission-denied', 'You do not have access to this document');
    }

    // Generate a short-lived signed URL
    try {
      const bucket = getStorage().bucket();
      const file = bucket.file(filePath);

      const [exists] = await file.exists();
      if (!exists) {
        throw new HttpsError('not-found', 'Document not found');
      }

      const [signedUrl] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + 15 * 60 * 1000, // 15 minutes
      });

      return { url: signedUrl };
    } catch (err: any) {
      if (err instanceof HttpsError) throw err;
      console.error('Failed to generate signed URL:', err);
      throw new HttpsError('internal', 'Failed to access document');
    }
  }
);
