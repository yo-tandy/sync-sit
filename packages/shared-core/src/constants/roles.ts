export const UserRole = {
  BABYSITTER: 'babysitter',
  PARENT: 'parent',
  ADMIN: 'admin',
  TUTOR: 'tutor',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];
