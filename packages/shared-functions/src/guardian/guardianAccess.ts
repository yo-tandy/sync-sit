import { db } from '../config/firebase.js';
import { sendPushNotification } from '../config/push.js';

/**
 * The guardian caller resolution for protective controls (auth EXTENSION of
 * the lifecycle callables): true iff `guardianLinks/{providerUid}` is ACTIVE
 * and `callerUid` is a parent of that link's family. Supervision is
 * family-level — every parent of the supervising family holds the power.
 * Non-throwing: the callables keep their own (pre-existing) denial when this
 * returns false.
 */
export async function isActiveGuardianOf(
  callerUid: string,
  providerUid: string,
): Promise<boolean> {
  if (callerUid === providerUid) return false;
  const link = (await db.collection('guardianLinks').doc(providerUid).get()).data();
  if (!link || link.status !== 'active') return false;
  const family = (await db.collection('families').doc(link.familyId as string).get()).data();
  return Array.isArray(family?.parentIds) && family.parentIds.includes(callerUid);
}

/**
 * Tell the kid a guardian acted on their behalf (in-app + push). Supervision
 * is transparent: every guardian protective action produces one of these.
 */
export async function notifyChildOfGuardianAction(
  childUid: string,
  body: string,
  data: Record<string, string>,
): Promise<void> {
  const title = 'A parent of your family acted on your account';
  await db.collection('notifications').add({
    recipientUserId: childUid,
    type: 'guardian_action',
    title,
    body,
    data,
    read: false,
    channels: ['push'],
    emailSent: false,
    pushSent: false,
    createdAt: new Date(),
  });
  await sendPushNotification(childUid, title, body, { ...data, type: 'guardian_action' }, 'auto');
}
