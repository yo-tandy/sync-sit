import type { ReactNode } from 'react';
import { twMerge } from 'tailwind-merge';

interface InfoBannerProps {
  icon?: string;
  variant?: 'default' | 'warning';
  children: ReactNode;
  className?: string;
}

export function InfoBanner({
  icon = 'ℹ️',
  variant = 'default',
  children,
  className = '',
}: InfoBannerProps) {
  // twMerge, not template interpolation (#429): same `bg-*` base/override
  // conflict as Card — see the note there.
  return (
    <div
      className={twMerge(
        'flex gap-3 rounded-lg p-3',
        variant === 'warning'
          ? 'border-l-3 border-brand-600 bg-brand-50'
          : 'border-l-3 border-gray-300 bg-gray-50',
        className
      )}
    >
      <span className="flex-shrink-0 text-base">{icon}</span>
      <p className="text-sm leading-relaxed text-gray-600">{children}</p>
    </div>
  );
}
