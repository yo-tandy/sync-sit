/**
 * Location preference for a tutoring session.
 * Values from plan §6: family_home | tutor_home | online | library.
 */
export type LocationPref = 'family_home' | 'tutor_home' | 'online' | 'library';

/**
 * A subject offering from a tutor: which subject they teach, which class
 * levels they cover, and their hourly rate for that subject.
 */
export interface SubjectOffering {
  /** Subject key, e.g. 'math', 'french', 'physics' — must be in SUBJECTS. */
  subject: string;
  /** Class levels covered for this subject, e.g. ['6e', '5e', '4e']. */
  levels: string[];
  /** Tutor's hourly rate in EUR for this subject. */
  rate: number;
}
