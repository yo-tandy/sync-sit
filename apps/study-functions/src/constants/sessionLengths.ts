/**
 * Supported session lengths in minutes.
 * Tutors advertise a subset; families choose from that subset at booking.
 */
export const SESSION_LENGTHS = [30, 45, 60, 75] as const;

export type SessionLengthMin = (typeof SESSION_LENGTHS)[number];
