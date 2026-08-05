import type { FirestoreTimestamp } from './common.js';

// ---------------------------------------------------------------------------
// Parental governance (guardian foundation)
// ---------------------------------------------------------------------------
//
// guardianLinks/{childUid} — doc id IS the child uid, which structurally
// enforces the one-supervising-family-per-child invariant. The link doc is
// the GDPR consent record for the supervision relationship.
// kidInvites/{inviteId} — parent-created invitations for kids without an
// account; redeemed via a hashed token, never by doc read.

export type GuardianLinkStatus = 'pending' | 'active' | 'revoked';
export type GuardianLinkOrigin = 'parent_created' | 'claim';
export type KidInviteStatus = 'pending' | 'accepted' | 'cancelled' | 'expired';

/** Consent versions approved by the parent on behalf of the supervised kid. */
export interface GuardianConsent {
  tosVersion: string;
  privacyVersion: string;
  supervisionAgreementVersion: string;
  approvedAt: FirestoreTimestamp;
  approvedByUid: string;
}

export interface GuardianLink {
  childUid: string;
  familyId: string;
  createdByParentUid: string;
  status: GuardianLinkStatus;
  origin: GuardianLinkOrigin;
  requestedAt: FirestoreTimestamp;
  confirmedAt?: FirestoreTimestamp;
  revokedAt?: FirestoreTimestamp;
  revokedByUid?: string;
  consent: GuardianConsent;
}

export interface KidInvite {
  /** Validated EJM email, lowercased. */
  kidEmailLower: string;
  firstName: string;
  lastName: string;
  /** Parent-entered, "YYYY-MM-DD". */
  dateOfBirth: string;
  familyId: string;
  createdByParentUid: string;
  /** sha256 hex of the raw emailed token; the raw token is NEVER stored. */
  tokenHash: string;
  status: KidInviteStatus;
  createdAt: FirestoreTimestamp;
  expiresAt: FirestoreTimestamp;
  resentAt?: FirestoreTimestamp;
  consent: GuardianConsent;
}
