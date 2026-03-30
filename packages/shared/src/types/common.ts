/** Firestore Timestamp-compatible type (works with both client and admin SDK) */
export interface FirestoreTimestamp {
  seconds: number;
  nanoseconds: number;
  toDate: () => Date;
}

/** Latitude/Longitude pair */
export interface LatLng {
  lat: number;
  lng: number;
}

/** Notification channel preferences */
export interface NotifChannels {
  push: boolean;
  email: boolean;
}

/** All notification preference categories */
export interface NotifPrefs {
  newRequest: NotifChannels;
  confirmed: NotifChannels;
  cancelled: NotifChannels;
  reminders: NotifChannels;
}

/** Default notification preferences (all on) */
export const DEFAULT_NOTIF_PREFS: NotifPrefs = {
  newRequest: { push: true, email: true },
  confirmed: { push: true, email: true },
  cancelled: { push: true, email: true },
  reminders: { push: true, email: false },
};
