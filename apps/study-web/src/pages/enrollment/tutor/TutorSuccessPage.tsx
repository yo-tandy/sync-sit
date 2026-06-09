import { Link, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';

export function TutorSuccessPage() {
  const { t } = useTranslation();
  const { state } = useLocation();
  const firstName = (state as { firstName?: string } | null)?.firstName ?? '';

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center px-6 text-center">
      <div className="mb-6 text-6xl">🎉</div>
      <h1 className="mb-3 text-2xl font-bold text-gray-950">
        {t('enrollment.tutor.success')}{firstName ? `, ${firstName}` : ''}!
      </h1>
      <p className="mb-8 max-w-[300px] text-sm leading-relaxed text-gray-500">
        {t('enrollment.tutor.successSubtitle')}
      </p>
      <Link
        to="/"
        className="flex h-12 w-full max-w-xs items-center justify-center rounded-xl bg-red-600 text-base font-semibold text-white transition-colors hover:bg-red-600/90"
      >
        {t('enrollment.tutor.goHome')}
      </Link>
    </div>
  );
}
