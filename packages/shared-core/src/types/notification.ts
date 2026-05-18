import type { FirestoreTimestamp } from './common.js';

export type NotificationType =
  | 'new_request'
  | 'request_accepted'
  | 'request_declined'
  | 'request_cancelled'
  | 'revalidation'
  | 'account_deleted'
  | 'reference_submitted'
  | 'general';

export interface NotificationDoc {
  notificationId: string;
  recipientUserId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, string>;
  read: boolean;
  channels: ('email' | 'push')[];
  emailSent: boolean;
  pushSent: boolean;
  createdAt: FirestoreTimestamp;
}
