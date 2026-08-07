import type { DayOfWeek, ProposedBy, RecurringSlot } from '@ejm/shared-core';
import type { TutorProfile } from '@ejm/study-core';

/**
 * Client mirrors of the guardian callable payloads (PRs #102/#104/#105).
 * Typed from the backend sources in packages/shared-functions/src/guardian/ —
 * every field below is one the backend actually returns; none are invented.
 * Timestamps arrive as ISO strings (the backend's `iso()` helper) or null.
 */

export type GuardianLinkStatus = 'pending' | 'active' | 'revoked';
export type GuardianLinkOrigin = 'parent_created' | 'claim';

/** Dashboard-level presence summary of one provider profile (oversight.ts). */
export interface GuardianProfileSummary {
  searchable: boolean;
  enrollmentComplete: boolean;
}

/** One supervised-kid row of getGovernedChildren. */
export interface GovernedChildSummary {
  childUid: string;
  firstName: string | null;
  lastName: string | null;
  photoUrl: string | null;
  status: string | null;
  age: number | null;
  link: {
    status: GuardianLinkStatus;
    origin: GuardianLinkOrigin;
    requestedAt: string | null;
    confirmedAt: string | null;
    revokedAt: string | null;
  };
  profiles: {
    babysitter: GuardianProfileSummary | null;
    tutor: GuardianProfileSummary | null;
  };
  upcoming: { sitAppointments: number; studySessions: number };
}

/** One pending invite row of getGovernedChildren. */
export interface KidInviteRow {
  inviteId: string;
  kidEmail: string;
  firstName: string;
  lastName: string;
  status: 'pending';
  createdAt: string | null;
  expiresAt: string | null;
  resentAt: string | null;
}

export interface GovernedChildrenResult {
  children: GovernedChildSummary[];
  invites: KidInviteRow[];
}

/** A recurring occurrence inside a GovernedStudySession. */
export interface GovernedSessionInstance {
  instanceId: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  status: string;
  statusReason: string | null;
  cancellationReason: string | null;
  lateCancellation: boolean;
  preSessionNote: string | null;
  postSessionNote: string | null;
}

/** One study session (one_time or recurring parent) in the oversight detail. */
export interface GovernedStudySession {
  sessionId: string;
  type: 'one_time' | 'recurring';
  status: string;
  statusReason: string | null;
  familyName: string | null;
  subject: string | null;
  level: string | null;
  rate: number | null;
  location: string | null;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  message: string | null;
  preSessionNote: string | null;
  postSessionNote: string | null;
  lateCancellation: boolean;
  cancellationReason: string | null;
  createdAt: string | null;
  /** Absent on legacy docs server-side — the payload always defaults it to 'family'. */
  proposedBy: ProposedBy;
  recurringSlots: RecurringSlot[] | null;
  instances: GovernedSessionInstance[];
}

export interface GovernedStudyContactRequest {
  requestId: string;
  status: string;
  familyName: string | null;
  parentName: string | null;
  subject: string | null;
  level: string | null;
  message: string | null;
  createdAt: string | null;
}

export interface GovernedSitAppointment {
  appointmentId: string;
  type: string;
  status: string;
  statusReason: string | null;
  familyName: string | null;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  offeredRate: number | null;
  message: string | null;
  additionalInfo: string | null;
  cancellationReason: string | null;
  createdAt: string | null;
}

export interface GovernedSitContactRequest {
  requestId: string;
  status: string;
  familyName: string | null;
  parentName: string | null;
  createdAt: string | null;
}

/** The full oversight payload of getGovernedChildDetail (ruling 8). */
export interface GovernedChildDetail {
  child: {
    childUid: string;
    firstName: string | null;
    lastName: string | null;
    photoUrl: string | null;
    email: string | null;
    status: string | null;
    age: number | null;
    dateOfBirth: string | null;
    identityLocked: boolean;
  };
  link: {
    status: GuardianLinkStatus;
    origin: GuardianLinkOrigin;
    requestedAt: string | null;
    confirmedAt: string | null;
    consent: {
      tosVersion: string | null;
      privacyVersion: string | null;
      supervisionAgreementVersion: string | null;
      approvedAt: string | null;
    };
  };
  providerProfiles: {
    babysitter: Record<string, unknown> | null;
    tutor: TutorProfile | null;
  };
  schedule: {
    weekly: Record<DayOfWeek, boolean[]> | null;
    overrideCount: number;
  };
  study: {
    sessions: GovernedStudySession[];
    contactRequests: GovernedStudyContactRequest[];
  };
  sit: {
    appointments: GovernedSitAppointment[];
    contactSharingRequests: GovernedSitContactRequest[];
  };
  counts: { references: number; endorsements: number };
}

/**
 * The `guardianLinks/{ownUid}` doc as the CHILD reads it client-side (the only
 * guardian Firestore read the client performs — everything else is callables).
 * Timestamps here are raw Firestore values, not ISO strings.
 */
export interface GuardianLinkDoc {
  childUid: string;
  familyId: string;
  createdByParentUid: string;
  status: GuardianLinkStatus;
  origin: GuardianLinkOrigin;
  /** Denormalized at link creation; absent on links created before PR 5. */
  familyName?: string;
  requestedAt?: unknown;
  confirmedAt?: unknown;
  consent?: Record<string, unknown>;
}
