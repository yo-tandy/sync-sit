import type { ReactNode } from 'react';

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
  return (
    <div
      className={`flex gap-3 rounded-lg p-3 ${
        variant === 'warning'
          ? 'border-l-3 border-red-600 bg-red-50'
          : 'border-l-3 border-gray-300 bg-gray-50'
      } ${className}`}
    >
      <span className="flex-shrink-0 text-base">{icon}</span>
      <p className="text-sm leading-relaxed text-gray-600">{children}</p>
    </div>
  );
}
