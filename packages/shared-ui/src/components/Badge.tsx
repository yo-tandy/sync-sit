import type { ReactNode } from 'react';

// NOTE: variant 'red' is a legacy API name that now emits brand-* classes —
// it renders EJM red in sit and brand blue in study. The semantic split of
// true-danger sites onto error-* tokens is a planned follow-up (see
// docs/shared-modules-roadmap.md).
type BadgeVariant = 'red' | 'green' | 'amber' | 'gray' | 'blue';

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  red: 'bg-brand-100 text-brand-600',
  green: 'bg-green-100 text-green-600',
  amber: 'bg-amber-100 text-amber-600',
  gray: 'bg-gray-100 text-gray-500',
  blue: 'bg-blue-100 text-blue-600',
};

export function Badge({ variant = 'gray', children, className = '' }: BadgeProps) {
  // `rounded-pill`, not `rounded-full` (#366, review round 1): --radius-pill
  // was added for exactly this and then read by nothing. rounded-full stays
  // correct for actual circles (avatars, spinners); a badge is a pill, and
  // routing pills through the token makes it the one place to change them.
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-pill px-3 py-1 text-xs font-medium ${variantClasses[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
