import type { ReactNode } from 'react';

interface ChipProps {
  selected?: boolean;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}

export function Chip({ selected = false, onClick, children, className = '' }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex cursor-pointer items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-all ${
        selected
          ? 'bg-red-100 text-red-600'
          : 'border border-gray-200 bg-white text-gray-500 hover:border-gray-400'
      } ${className}`}
    >
      {selected && '✓ '}
      {children}
    </button>
  );
}
