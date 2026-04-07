import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { UserIcon, UsersIcon, ArrowLeftIcon } from '@/components/ui/Icons';

export function SignUpRolePage() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-[100dvh] flex-col px-6 py-4">
      {/* Top nav */}
      <div className="flex h-[52px] items-center justify-between">
        <Link
          to="/"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 transition-colors hover:bg-gray-200"
        >
          <ArrowLeftIcon className="h-[18px] w-[18px]" />
        </Link>
        <span className="text-base font-semibold">{t('welcome.signUp')}</span>
        <div className="w-9" />
      </div>

      <div className="flex flex-1 flex-col justify-center pb-8">
        <div className="mb-6 flex justify-center">
          <img src="/logo.png" alt="Sync/Sit" className="h-20 w-20 rounded-2xl" />
        </div>

        <h2 className="mb-2 text-center text-2xl font-bold text-gray-950">
          {t('welcome.signUpRole')}
        </h2>
        <p className="mb-8 text-center text-sm text-gray-500">
          {t('welcome.subtitle')}
        </p>

        {/* Babysitter option */}
        <Link
          to="/enroll/babysitter"
          className="mb-4 rounded-xl border-[1.5px] border-gray-200 bg-white p-5 transition-colors hover:border-red-300 hover:bg-red-50 active:bg-red-50"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100">
              <UserIcon className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <p className="text-base font-semibold text-gray-950">{t('welcome.signUpBabysitter')}</p>
            </div>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-gray-500">
            {t('welcome.signUpBabysitterDesc')}
          </p>
        </Link>

        {/* Parent option */}
        <Link
          to="/enroll/parent"
          className="mb-6 rounded-xl border-[1.5px] border-gray-200 bg-white p-5 transition-colors hover:border-red-300 hover:bg-red-50 active:bg-red-50"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100">
              <UsersIcon className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <p className="text-base font-semibold text-gray-950">{t('welcome.signUpParent')}</p>
            </div>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-gray-500">
            {t('welcome.signUpParentDesc')}
          </p>
        </Link>

        <div className="text-center">
          <span className="text-sm text-gray-500">
            {t('welcome.alreadyHaveAccount')}{' '}
          </span>
          <Link
            to="/login"
            className="text-sm font-semibold text-red-600 hover:underline"
          >
            {t('welcome.logIn')}
          </Link>
        </div>
      </div>
    </div>
  );
}
