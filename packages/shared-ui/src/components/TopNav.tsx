import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ArrowLeftIcon } from './Icons';

interface TopNavProps {
  title: string;
  backTo?: string;
  onBack?: () => void;
  rightAction?: ReactNode;
}

export function TopNav({ title, backTo, onBack, rightAction }: TopNavProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();

  const showBack = backTo || onBack;

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else if (backTo === 'back') {
      if (window.history.state?.idx > 0) {
        navigate(-1);
      } else {
        navigate('/');
      }
    } else if (backTo) {
      navigate(backTo);
    }
  };

  return (
    <div className="flex h-[52px] items-center justify-between px-5">
      {showBack ? (
        <button
          onClick={handleBack}
          aria-label={t('common.back')}
          className="group -m-1 flex h-11 w-11 items-center justify-center"
        >
          {/* 44px hit target; the visible 36px circle is unchanged */}
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 transition-colors group-hover:bg-gray-200">
            <ArrowLeftIcon className="h-[18px] w-[18px]" />
          </span>
        </button>
      ) : (
        <div className="w-9" />
      )}
      <span className="text-base font-semibold">{title}</span>
      {rightAction || <div className="w-9" />}
    </div>
  );
}
