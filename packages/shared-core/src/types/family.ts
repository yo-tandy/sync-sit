import type { FirestoreTimestamp, LatLng } from './common.js';
import type { FamilyVerificationStatus } from './verification.js';

export interface FamilyDoc {
  familyId: string;
  familyName: string;
  address: string;
  latLng: LatLng;
  /**
   * Geocoder components of the saved address (issue #167). Null/absent on
   * pre-#167 docs and when the address was typed without an autocomplete
   * pick; study search resolves the family's coverage-area label from them.
   */
  postcode?: string | null;
  city?: string | null;
  photoUrl?: string;
  pets?: string;
  note?: string;
  parentIds: string[];
  preferredBabysitters?: string[];
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
