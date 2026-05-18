import type { ReactNode } from 'react';

type BadgeVariant = 'red' | 'green' | 'amber' | 'gray' | 'blue';

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  red: 'bg-red-100 text-red-600',
  green: 'bg-green-100 text-green-600',
  amber: 'bg-amber-100 text-amber-600',
  gray: 'bg-gray-100 text-gray-500',
  blue: 'bg-blue-100 text-blue-600',
};

export function Badge({ variant = 'gray', children, className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${variantClasses[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
