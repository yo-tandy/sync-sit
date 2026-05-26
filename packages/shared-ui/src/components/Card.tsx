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
  return (
    <div
      className={`rounded-lg border border-gray-200 bg-white p-4 ${
        elevated ? 'shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_2px_rgba(0,0,0,0.04)]' : ''
      } ${
        interactive ? 'cursor-pointer transition-all hover:shadow-md hover:-translate-y-px' : ''
      } ${className}`}
      style={borderColor ? { borderLeftWidth: 3, borderLeftColor: borderColor } : undefined}
      {...props}
    >
      {children}
    </div>
  );
}
