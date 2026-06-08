/**
 * Supported class levels for sync-study.
 * Matches plan §6 "Subject Taxonomy" — covers French elementary, collège,
 * lycée, and EJM IB programme tracks.
 */
export const CLASS_LEVELS = [
  'CP',
  'CE1',
  'CE2',
  'CM1',
  'CM2', // elementary
  '6e',
  '5e',
  '4e',
  '3e', // college
  '2nde',
  '1ere',
  'Terminale', // lycee
  'IB_MYP4',
  'IB_MYP5',
  'IB_DP1',
  'IB_DP2', // IB programme
] as const;

export type ClassLevel = (typeof CLASS_LEVELS)[number];
