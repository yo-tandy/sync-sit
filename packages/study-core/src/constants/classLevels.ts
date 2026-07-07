/**
 * Supported class levels for sync-study.
 * Covers French maternelle (MS, GS), elementary, collège, and lycée.
 * IB programme tracks removed — no longer part of the taxonomy.
 */
export const CLASS_LEVELS = [
  'MS',
  'GS', // maternelle
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
] as const;

export type ClassLevel = (typeof CLASS_LEVELS)[number];
