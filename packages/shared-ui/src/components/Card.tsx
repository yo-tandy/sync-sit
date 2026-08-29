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
  // raised rather than flush — but via `bg-ground-raised`, not a literal
  // `bg-white` (review round 1): that token was defined in all three brand
  // files and read nowhere, which is the same bug one level down. It resolves
  // to #ffffff in every app today, so this is a no-op visually and a real one
  // structurally — raised surfaces are now themeable from one place.
  return (
    <div
      className={`rounded-lg border border-gray-200 bg-ground-raised p-4 ${
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
