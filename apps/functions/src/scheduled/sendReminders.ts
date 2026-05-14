import { onSchedule } from 'firebase-functions/v2/scheduler';
import type { Firestore } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';
import { sendNotificationEmail } from '../config/email.js';
import { sendPushNotification } from '../config/push.js';

export interface SendRemindersStats {
  remindersSent: number;
}

/**
 * Finds confirmed appointments in the 23–25h window and sends reminders.
 * Extracted for testability — the cron wrapper calls this with the real db + now.
 */
export async function runSendReminders(
  firestoreDb: Firestore,
  now: Date,
): Promise<SendRemindersStats> {
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const in25h = new Date(now.getTime() + 25 * 60 * 60 * 1000);

  // Format dates for comparison
  const today = now.toISOString().split('T')[0];
  const tomorrow = in24h.toISOString().split('T')[0];
  const dayAfter = in25h.toISOString().split('T')[0];

  // Find confirmed appointments with dates in the 24-25h window
  const appointmentsSnap = await firestoreDb.collection('appointments')
    .where('status', '==', 'confirmed')
    .where('date', 'in', [today, tomorrow, dayAfter])
    .get();

  if (appointmentsSnap.empty) {
    console.log('No upcoming confirmed appointments found');
    return { remindersSent: 0 };
  }

  let remindersSent = 0;

  for (const aptDoc of appointmentsSnap.docs) {
    const apt = aptDoc.data();

    // Check if appointment is within the 24-25h window
    if (!apt.date || !apt.startTime) continue;

    const aptDateTime = new Date(`${apt.date}T${apt.startTime}:00`);
    const hoursUntil = (aptDateTime.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (hoursUntil < 23 || hoursUntil > 25) continue;

    // Check if reminder already sent
    if (apt.reminderSent) continue;

    const familyName = apt.familyName || 'Family';
    const appointmentDate = new Date(apt.date + 'T00:00:00').toLocaleDateString('en-GB', {
      weekday: 'short', month: 'short', day: 'numeric',
    });

    // Create reminder notification for babysitter
    if (apt.babysitterUserId) {
      // Check babysitter's notification preferences
      const babysitterDoc = await firestoreDb.collection('users').doc(apt.babysitterUserId).get();
      const babysitterPrefs = babysitterDoc.data()?.notifPrefs?.reminders;

      if (babysitterPrefs?.push || babysitterPrefs?.email) {
        await firestoreDb.collection('notifications').add({
          recipientUserId: apt.babysitterUserId,
          type: 'reminder',
          title: 'Appointment tomorrow',
          body: `Reminder: You have a babysitting appointment with ${familyName} on ${appointmentDate} at ${apt.startTime}.`,
          read: false,
          channels: {
            push: babysitterPrefs?.push ?? true,
            email: babysitterPrefs?.email ?? false,
          },
          pushSent: false,
          emailSent: false,
          appointmentId: aptDoc.id,
          createdAt: now,
        });

        if (babysitterPrefs?.email) {
          const babysitterEmail = babysitterDoc.data()?.email;
          if (babysitterEmail) {
            await sendNotificationEmail(
              babysitterEmail,
              'Babysitting appointment tomorrow',
              `<p>Reminder: You have a babysitting appointment with <strong>${familyName}</strong> on <strong>${appointmentDate}</strong> at <strong>${apt.startTime}</strong>.</p>
               <p style="margin-top: 16px;"><a href="https://sync-sit.com/babysitter" style="background: #DC2626; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View Appointment</a></p>`
            );
          }
        }

        if (babysitterPrefs?.push) {
          await sendPushNotification(
            apt.babysitterUserId,
            'Babysitting appointment tomorrow',
            `Reminder: You have a babysitting appointment with ${familyName} on ${appointmentDate} at ${apt.startTime}.`,
            { appointmentId: aptDoc.id, type: 'reminder' }
          );
        }
      }
    }

    // Create reminder notification for family (all parents)
    if (apt.familyId) {
      const familyDoc = await firestoreDb.collection('families').doc(apt.familyId).get();
      const parentIds: string[] = familyDoc.data()?.parentIds || [];

      for (const parentId of parentIds) {
        const parentDoc = await firestoreDb.collection('users').doc(parentId).get();
        const parentPrefs = parentDoc.data()?.notifPrefs?.reminders;

        if (parentPrefs?.push || parentPrefs?.email) {
          await firestoreDb.collection('notifications').add({
            recipientUserId: parentId,
            type: 'reminder',
            title: 'Babysitting tomorrow',
            body: `Reminder: Your babysitting appointment is on ${appointmentDate} at ${apt.startTime}.`,
            read: false,
            channels: {
              push: parentPrefs?.push ?? true,
              email: parentPrefs?.email ?? false,
            },
            pushSent: false,
            emailSent: false,
            appointmentId: aptDoc.id,
            createdAt: now,
          });

          if (parentPrefs?.email) {
            const parentEmail = parentDoc.data()?.email;
            if (parentEmail) {
              await sendNotificationEmail(
                parentEmail,
                'Babysitting appointment tomorrow',
                `<p>Reminder: Your babysitting appointment is on <strong>${appointmentDate}</strong> at <strong>${apt.startTime}</strong>.</p>
                 <p style="margin-top: 16px;"><a href="https://sync-sit.com/family" style="background: #DC2626; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: 600;">View Appointment</a></p>`
              );
            }
          }

          if (parentPrefs?.push) {
            await sendPushNotification(
              parentId,
              'Babysitting appointment tomorrow',
              `Reminder: Your babysitting appointment is on ${appointmentDate} at ${apt.startTime}.`,
              { appointmentId: aptDoc.id, type: 'reminder' }
            );
          }
        }
      }
    }

    // Mark reminder as sent
    await aptDoc.ref.update({ reminderSent: true });
    remindersSent++;
  }

  console.log(`Sent ${remindersSent} appointment reminders`);
  return { remindersSent };
}

export const sendReminders = onSchedule(
  {
    schedule: 'every 1 hours',
    region: 'europe-west1',
    timeZone: 'Europe/Paris',
  },
  async () => {
    await runSendReminders(db, new Date());
  },
);
