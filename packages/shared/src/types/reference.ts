import type { FirestoreTimestamp } from './common.js';
import type { ReferenceType, ReferenceStatus } from '../constants/index.js';

export interface ReferenceDoc {
  referenceId: string;
  babysitterUserId: string;
  type: ReferenceType;
  status: ReferenceStatus;

  // Manual reference fields
  refName?: string;
  refPhone?: string;
  refWhatsapp?: string;
  refEmail?: string;
  isEjmFamily?: boolean;
  numberOfKids?: number;
  kidAges?: number[];
  note?: string;

  // Family-submitted fields
  submittedByUserId?: string;
  submittedByFamilyId?: string;
  submittedByName?: string;
  appointmentId?: string;
  referenceText?: string;

  createdAt: FirestoreTimestamp;
  approvedAt?: FirestoreTimestamp;
}
