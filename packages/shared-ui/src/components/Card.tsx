import type { HTMLAttributes, ReactNode } from 'react';
import { twMerge } from 'tailwind-merge';

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
  // `shadow-card`, not a hardcoded arbitrary value — see #366. Cards stay
  // white ON the tinted ground via `bg-ground-raised`, not a literal
  // `bg-white` — see #366 review round 1.
  //
  // twMerge, not template interpolation (#429): conflicting Tailwind
  // utilities resolve by generated-stylesheet order, not class-attribute
  // order — the shape of issue #226 — so a caller's `className="bg-amber-50"`
  // could lose to this base's `bg-ground-raised` even though it comes last in
  // the string (34 call sites had this happen silently). twMerge strips the
  // earlier conflicting utility so the last class in the attribute always
  // wins, which is what every call site already assumes.
  return (
    <div
      className={twMerge(
        'rounded-lg border border-gray-200 bg-ground-raised p-4',
        elevated ? 'shadow-card' : '',
        interactive ? 'cursor-pointer transition-all hover:shadow-card-brand hover:-translate-y-px' : '',
        className
      )}
      style={borderColor ? { borderLeftWidth: 3, borderLeftColor: borderColor } : undefined}
      {...props}
    >
      {children}
    </div>
  );
}
