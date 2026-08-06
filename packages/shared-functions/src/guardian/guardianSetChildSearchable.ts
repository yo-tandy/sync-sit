import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeAuditLog } from '../admin/writeAuditLog.js';
import { sendPushNotification } from '../config/push.js';
import { GUARDIAN_SUCCESS } from './shared.js';
import { requireActiveLinkParent } from './oversight.js';

interface SetSearchableData {
  childUid: string;
  app: 'sit' | 'study';
  searchable: boolean;
}

const APP_TO_ROLE = { sit: 'babysitter', study: 'tutor' } as const;

/**
 * Protective control: a supervising parent hides the kid's provider profile
 * from search (or restores it). The kid is always told — supervision is
 * transparent, never silent.
 */
export const guardianSetChildSearchable = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const callerUid = request.auth.uid;
    const { childUid, app, searchable } = request.data as SetSearchableData;
    if (!childUid || typeof childUid !== 'string') {
      throw new HttpsError('invalid-argument', 'childUid is required');
    }
    if (app !== 'sit' && app !== 'study') {
      throw new HttpsError('invalid-argument', "app must be 'sit' or 'study'");
    }
    if (typeof searchable !== 'boolean') {
      throw new HttpsError('invalid-argument', 'searchable must be a boolean');
    }

    await requireActiveLinkParent(callerUid, childUid);

    const role = APP_TO_ROLE[app];
    const childRef = db.collection('users').doc(childUid);
    const child = (await childRef.get()).data();
    if (!child?.profiles?.[role]) {
      throw new HttpsError(
        'failed-precondition',
        `This account has no ${role} profile.`,
        { code: 'guardian/no-profile' },
      );
    }

    const now = new Date();
    await childRef.update({
      [`profiles.${role}.searchable`]: searchable,
      updatedAt: now,
    });

    const title = searchable ? 'Profile visible in search' : 'Profile hidden from search';
    const body = searchable
      ? `A parent of your family made your ${role} profile visible in search`
      : `A parent of your family hid your ${role} profile from search`;
    await db.collection('notifications').add({
      recipientUserId: childUid,
      type: 'guardian_searchable',
      title,
      body,
      data: { app, searchable: String(searchable) },
      read: false,
      channels: ['push'],
      emailSent: false,
      pushSent: false,
      createdAt: now,
    });
    await sendPushNotification(childUid, title, body, { type: 'guardian_searchable' });

    await writeAuditLog({
      adminUserId: callerUid,
      action: 'guardian.set_child_searchable',
      targetUserId: childUid,
      details: { actorRole: 'guardian', app, searchable },
    });
    return GUARDIAN_SUCCESS;
  },
);
