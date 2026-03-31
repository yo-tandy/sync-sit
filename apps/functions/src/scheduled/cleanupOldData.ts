import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db } from '../config/firebase.js';

/**
 * GDPR data retention cleanup. Runs daily at 3:00 AM Paris time.
 *
 * Retention periods:
 * - Notifications: 30 days
 * - Audit logs: 30 days
 * - Expired invite links: immediate (past expiry)
 * - Expired verification codes: immediate (past expiry)
 * - Cancelled/rejected appointments: 30 days
 */
export const cleanupOldData = onSchedule(
  {
    schedule: 'every day 03:00',
    region: 'europe-west1',
    timeZone: 'Europe/Paris',
  },
  async () => {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    let totalDeleted = 0;

    // 1. Delete old notifications (> 30 days)
    const oldNotifications = await db
      .collection('notifications')
      .where('createdAt', '<', thirtyDaysAgo)
      .limit(500)
      .get();

    if (!oldNotifications.empty) {
      const batch = db.batch();
      for (const doc of oldNotifications.docs) {
        batch.delete(doc.ref);
      }
      await batch.commit();
      totalDeleted += oldNotifications.size;
      console.log(`Deleted ${oldNotifications.size} old notifications`);
    }

    // 2. Delete old audit logs (> 30 days)
    const oldAuditLogs = await db
      .collection('auditLogs')
      .where('timestamp', '<', thirtyDaysAgo)
      .limit(500)
      .get();

    if (!oldAuditLogs.empty) {
      const batch = db.batch();
      for (const doc of oldAuditLogs.docs) {
        batch.delete(doc.ref);
      }
      await batch.commit();
      totalDeleted += oldAuditLogs.size;
      console.log(`Deleted ${oldAuditLogs.size} old audit logs`);
    }

    // 3. Delete expired invite links
    const expiredInvites = await db
      .collection('inviteLinks')
      .where('expiresAt', '<', now)
      .limit(500)
      .get();

    if (!expiredInvites.empty) {
      const batch = db.batch();
      for (const doc of expiredInvites.docs) {
        batch.delete(doc.ref);
      }
      await batch.commit();
      totalDeleted += expiredInvites.size;
      console.log(`Deleted ${expiredInvites.size} expired invite links`);
    }

    // 4. Delete expired verification codes
    const expiredCodes = await db
      .collection('verificationCodes')
      .where('expiresAt', '<', now)
      .limit(500)
      .get();

    if (!expiredCodes.empty) {
      const batch = db.batch();
      for (const doc of expiredCodes.docs) {
        batch.delete(doc.ref);
      }
      await batch.commit();
      totalDeleted += expiredCodes.size;
      console.log(`Deleted ${expiredCodes.size} expired verification codes`);
    }

    // 5. Delete old cancelled/rejected appointments (> 30 days)
    const oldAppointments = await db
      .collection('appointments')
      .where('status', 'in', ['cancelled', 'rejected'])
      .where('createdAt', '<', thirtyDaysAgo)
      .limit(500)
      .get();

    if (!oldAppointments.empty) {
      const batch = db.batch();
      for (const doc of oldAppointments.docs) {
        batch.delete(doc.ref);
      }
      await batch.commit();
      totalDeleted += oldAppointments.size;
      console.log(`Deleted ${oldAppointments.size} old cancelled/rejected appointments`);
    }

    console.log(`Data retention cleanup complete. Total deleted: ${totalDeleted}`);
  }
);
