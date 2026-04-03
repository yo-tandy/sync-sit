import type { FirestoreTimestamp, LatLng } from './common.js';
import type { FamilyVerificationStatus } from './verification.js';

export interface FamilyDoc {
  familyId: string;
  familyName: string;
  address: string;
  latLng: LatLng;
  photoUrl?: string;
  pets?: string;
  note?: string;
  parentIds: string[];
  searchDefaults?: SearchDefaults;
  createdAt: FirestoreTimestamp;
  updatedAt: FirestoreTimestamp;
  status: 'active' | 'deleted';
  verification?: FamilyVerificationStatus;
}

export interface SearchDefaults {
  minBabysitterAge?: number;
  preferredGender?: string;
  requireReferences?: boolean;
  maxRate?: number;
}

export interface KidDoc {
  kidId: string;
  firstName: string;
  age: number;
  languages: string[];
  note?: string;
}
