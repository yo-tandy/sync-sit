import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';

interface AuditLogEntry {
  /** The user who performed the action (admin or regular user) */
  adminUserId: string;
  action: string;
  targetUserId?: string;
  details?: Record<string, unknown>;
}

/**
 * Write an audit log entry to the auditLogs collection.
 * Used for both admin actions and user activity tracking.
 */
export async function writeAuditLog(entry: AuditLogEntry): Promise<void> {
  await db.collection('auditLogs').add({
    ...entry,
    timestamp: FieldValue.serverTimestamp(),
  });
}

/**
 * Convenience wrapper for logging user (non-admin) activity.
 */
export async function writeUserActivity(
  userId: string,
  action: string,
  details?: Record<string, unknown>,
): Promise<void> {
  await writeAuditLog({
    adminUserId: userId,
    action,
    details,
  });
}
