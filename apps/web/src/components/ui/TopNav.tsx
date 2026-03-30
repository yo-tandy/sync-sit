import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeftIcon } from './Icons';

interface TopNavProps {
  title: string;
  backTo?: string;
  onBack?: () => void;
  rightAction?: ReactNode;
}

export function TopNav({ title, backTo, onBack, rightAction }: TopNavProps) {
  const navigate = useNavigate();

  const showBack = backTo || onBack;

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else if (backTo === 'back') {
      navigate(-1);
    } else if (backTo) {
      navigate(backTo);
    }
  };

  return (
    <div className="flex h-[52px] items-center justify-between px-5">
      {showBack ? (
        <button
          onClick={handleBack}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 transition-colors hover:bg-gray-200"
        >
          <ArrowLeftIcon className="h-[18px] w-[18px]" />
        </button>
      ) : (
        <div className="w-9" />
      )}
      <span className="text-base font-semibold">{title}</span>
      {rightAction || <div className="w-9" />}
    </div>
  );
}
