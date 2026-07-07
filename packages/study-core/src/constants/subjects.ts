/**
 * Supported subject keys for sync-study.
 * Matches plan §6 "Subject Taxonomy".
 */
export const SUBJECTS = [
  'math',
  'french',
  'english',
  'spanish',
  'german',
  'physics',
  'chemistry',
  'svt',
  'history_geo',
  'philosophy',
  'ses',
  'nsi',
  'art',
  'music',
] as const;

export type Subject = (typeof SUBJECTS)[number];
