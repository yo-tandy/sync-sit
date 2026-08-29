import type { HTMLAttributes, ReactNode } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  elevated?: boolean;
  interactive?: boolean;
  borderColor?: string;
  children: ReactNode;
}

export function Card({
  elevated = false,
  interactive = false,
  borderColor,
  className = '',
  children,
  ...props
}: CardProps) {
  // `shadow-card`, not a hardcoded arbitrary value. The elevation used to be
  // inlined here, which meant --shadow-card existed as a token but nothing
  // read it — so the Recess pass (#366) would have changed the token and not
  // a single card. Cards stay white ON the tinted ground, so they read as
  // raised rather than flush.
  return (
    <div
      className={`rounded-lg border border-gray-200 bg-white p-4 ${
        elevated ? 'shadow-card' : ''
      } ${
        interactive ? 'cursor-pointer transition-all hover:shadow-card-brand hover:-translate-y-px' : ''
      } ${className}`}
      style={borderColor ? { borderLeftWidth: 3, borderLeftColor: borderColor } : undefined}
      {...props}
    >
      {children}
    </div>
  );
}
