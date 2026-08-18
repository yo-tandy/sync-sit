import { onSchedule } from 'firebase-functions/v2/scheduler';
import type { Firestore } from 'firebase-admin/firestore';
import { db } from '@ejm/shared-functions/config/firebase.js';
import { notifyAllParents } from '@ejm/shared-functions/config/notifyParents.js';
import { sendNotificationEmail, STUDY_APP_URL } from '@ejm/shared-functions/config/email.js';
import { sendPushNotification } from '@ejm/shared-functions/config/push.js';
import {
  parisDateString,
  parisWallTimeToUtc,
} from '@ejm/shared-functions/scheduled/parisTime.js';

export interface StudyReminderStats {
  remindersSent: number;
}

/** The pre-session reminder window: [now+23h, now+25h]. */
const MIN_HOURS = 23;
const MAX_HOURS = 25;

/** The denormalized facts a reminder needs — sourced from the doc itself. */
interface ReminderTarget {
  tutorUserId: string;
  familyId: string;
  date: string;
  startTime: string;
  subject?: string;
  /** Present only for one_time (the parent carries a display tutorName). */
  tutorName?: string;
  sessionId: string;
  instanceId?: string;
}

function prettyDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Notify BOTH sides of an upcoming session: the tutor directly (email + push +
 * in-app) and every parent in the family via notifyAllParents. Both gate email/
 * push on the recipient's `reminders` prefs but ALWAYS write the in-app
 * notification doc (house pattern). Reads the tutor's user doc for email/prefs/
 * name; the session facts come entirely from the passed target (an instance
 * carries its own denormalized fields, so no parent-session read is needed).
 */
async function notifyBothSides(
  firestoreDb: Firestore,
  now: Date,
  t: ReminderTarget,
): Promise<void> {
  const subject = t.subject ?? 'tutoring';
  const when = `${prettyDate(t.date)} at ${t.startTime}`;
  const data: Record<string, string> = {
    sessionId: t.sessionId,
    type: 'study_session_reminder',
  };
  if (t.instanceId) data.instanceId = t.instanceId;

  // ── Tutor side (direct) ──
  const tutorDoc = await firestoreDb.collection('users').doc(t.tutorUserId).get();
  const tutorData = tutorDoc.data();
  const tutorEmail = tutorData?.email as string | undefined;
  const rp = tutorData?.notifPrefs?.reminders;
  const tutorName =
    t.tutorName ||
    `${tutorData?.firstName || ''} ${tutorData?.lastName || ''}`.trim() ||
    'your tutor';

  if (rp?.email !== false && tutorEmail) {
    await sendNotificationEmail(
      tutorEmail,
      'Tutoring session tomorrow',
      `<p>Reminder: you have a <strong>${subject}</strong> session on <strong>${when}</strong>.</p>
       <p style="margin-top: 16px;"><a href="${STUDY_APP_URL}/tutor" style="background: #2563EB; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View in app</a></p>`,
      'study',
    );
  }
  // Send push before the doc write so pushSent records the real outcome.
  let pushSent = false;
  if (rp?.push !== false) {
    pushSent = await sendPushNotification(
      t.tutorUserId,
      'Tutoring session tomorrow',
      `Reminder: your ${subject} session is on ${when}.`,
      data,
      'study',
    );
  }
  await firestoreDb.collection('notifications').add({
    recipientUserId: t.tutorUserId,
    type: 'study_session_reminder',
    title: 'Tutoring session tomorrow',
    body: `Reminder: your ${subject} session is on ${when}.`,
    data,
    read: false,
    channels: ['email', 'push'],
    emailSent: rp?.email !== false,
    pushSent,
    createdAt: now,
  });

  // ── Family side (all parents) ──
  await notifyAllParents({
    familyId: t.familyId,
    prefCategory: 'reminders',
    app: 'study',
    type: 'study_session_reminder',
    title: 'Tutoring session tomorrow',
    body: `Reminder: your ${subject} session with ${tutorName} is on ${when}.`,
    emailSubject: 'Tutoring session tomorrow',
    emailBody: `<p>Reminder: your <strong>${subject}</strong> session with <strong>${tutorName}</strong> is on <strong>${when}</strong>.</p>
       <p style="margin-top: 16px;"><a href="${STUDY_APP_URL}/family" style="background: #2563EB; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View in app</a></p>`,
    data: t.instanceId
      ? { sessionId: t.sessionId, instanceId: t.instanceId }
      : { sessionId: t.sessionId },
  });
}

/**
 * Hourly pre-session reminders for study sessions — the structural twin of sit's
 * runSendReminders. Covers BOTH concrete session shapes:
 *   • one_time parents  (status 'confirmed')
 *   • recurring instances via collection-group (status 'scheduled')
 * whose start is 23–25h out and that have not already been reminded
 * (reminderSent on the doc itself — the dedup guard, set on the instance for a
 * recurring occurrence). Cancelled sessions never match (the status filters
 * exclude them). Idempotent + self-healing: the reminderSent guard makes a
 * re-run silent and the 2h window over an hourly cadence guarantees every
 * session passes through exactly one reminding run.
 *
 * Extracted (injectable db + now) for testability.
 */
export async function runSendStudySessionReminders(
  firestoreDb: Firestore,
  now: Date,
): Promise<StudyReminderStats> {
  const today = parisDateString(now);
  const tomorrow = parisDateString(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  const dates = today === tomorrow ? [today] : [today, tomorrow];

  const inWindow = (date: string, startTime: string): boolean => {
    const start = parisWallTimeToUtc(date, startTime).getTime();
    const hours = (start - now.getTime()) / (60 * 60 * 1000);
    return hours >= MIN_HOURS && hours <= MAX_HOURS;
  };

  let remindersSent = 0;

  // ── one_time parents ── (status, date) composite serves status== + date in.
  const oneTimeSnap = await firestoreDb
    .collection('study-sessions')
    .where('status', '==', 'confirmed')
    .where('date', 'in', dates)
    .get();
  for (const doc of oneTimeSnap.docs) {
    const s = doc.data();
    if (s.type !== 'one_time') continue;
    if (!s.date || !s.startTime) continue;
    if (s.reminderSent === true) continue;
    if (!inWindow(s.date as string, s.startTime as string)) continue;
    await notifyBothSides(firestoreDb, now, {
      tutorUserId: s.tutorUserId as string,
      familyId: s.familyId as string,
      date: s.date as string,
      startTime: s.startTime as string,
      subject: s.subject as string | undefined,
      tutorName: s.tutorName as string | undefined,
      sessionId: doc.id,
    });
    await doc.ref.update({ reminderSent: true, updatedAt: now });
    remindersSent += 1;
  }

  // ── recurring instances (collection-group) ── (status, date) CG composite.
  const instancesSnap = await firestoreDb
    .collectionGroup('instances')
    .where('status', '==', 'scheduled')
    .where('date', 'in', dates)
    .get();
  for (const doc of instancesSnap.docs) {
    const inst = doc.data();
    if (!inst.date || !inst.startTime) continue;
    if (inst.reminderSent === true) continue;
    if (!inWindow(inst.date as string, inst.startTime as string)) continue;
    await notifyBothSides(firestoreDb, now, {
      tutorUserId: inst.tutorUserId as string,
      familyId: inst.familyId as string,
      date: inst.date as string,
      startTime: inst.startTime as string,
      subject: inst.subject as string | undefined,
      sessionId: inst.sessionId as string,
      instanceId: (inst.instanceId as string | undefined) ?? doc.id,
    });
    await doc.ref.update({ reminderSent: true, updatedAt: now });
    remindersSent += 1;
  }

  return { remindersSent };
}

export const sendStudySessionReminders = onSchedule(
  {
    schedule: 'every 1 hours',
    region: 'europe-west1',
    timeZone: 'Europe/Paris',
  },
  async () => {
    const stats = await runSendStudySessionReminders(db, new Date());
    console.log(`sendStudySessionReminders: ${stats.remindersSent} reminders sent`);
  },
);
