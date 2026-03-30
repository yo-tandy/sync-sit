import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db } from '../config/firebase.js';

/**
 * Runs every hour. Finds confirmed appointments happening in the next 24-25 hours
 * and creates reminder notifications for both the babysitter and the family.
 * Skips appointments that already have a reminder sent.
 */
export const sendReminders = onSchedule(
  {
    schedule: 'every 1 hours',
    region: 'europe-west1',
    timeZone: 'Europe/Paris',
  },
  async () => {
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const in25h = new Date(now.getTime() + 25 * 60 * 60 * 1000);

    // Format dates for comparison
    const today = now.toISOString().split('T')[0];
    const tomorrow = in24h.toISOString().split('T')[0];
    const dayAfter = in25h.toISOString().split('T')[0];

    // Find confirmed appointments with dates in the 24-25h window
    const appointmentsSnap = await db.collection('appointments')
      .where('status', '==', 'confirmed')
      .where('date', 'in', [today, tomorrow, dayAfter])
      .get();

    if (appointmentsSnap.empty) {
      console.log('No upcoming confirmed appointments found');
      return;
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
        const babysitterDoc = await db.collection('users').doc(apt.babysitterUserId).get();
        const babysitterPrefs = babysitterDoc.data()?.notifPrefs?.reminders;

        if (babysitterPrefs?.push || babysitterPrefs?.email) {
          await db.collection('notifications').add({
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
        }
      }

      // Create reminder notification for family (all parents)
      if (apt.familyId) {
        const familyDoc = await db.collection('families').doc(apt.familyId).get();
        const parentIds: string[] = familyDoc.data()?.parentIds || [];

        for (const parentId of parentIds) {
          const parentDoc = await db.collection('users').doc(parentId).get();
          const parentPrefs = parentDoc.data()?.notifPrefs?.reminders;

          if (parentPrefs?.push || parentPrefs?.email) {
            await db.collection('notifications').add({
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
          }
        }
      }

      // Mark reminder as sent
      await aptDoc.ref.update({ reminderSent: true });
      remindersSent++;
    }

    console.log(`Sent ${remindersSent} appointment reminders`);
  }
);
