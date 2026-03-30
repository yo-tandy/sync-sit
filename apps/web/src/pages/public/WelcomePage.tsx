import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { UserIcon, UsersIcon } from '@/components/ui/Icons';
import { LanguageSelector } from '@/components/ui';

export function WelcomePage() {
  const { i18n } = useTranslation();

  return (
    <div className="flex min-h-screen flex-col px-6 py-8">
      {/* Language toggle top-right */}
      <div className="flex justify-end">
        <LanguageSelector />
      </div>

      {/* Logo + Title */}
      <div className="flex flex-1 flex-col items-center justify-center">
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-black">
          <svg width="44" height="44" viewBox="0 0 48 48" fill="none">
            <circle cx="24" cy="18" r="7" stroke="white" strokeWidth="2.5" />
            <path
              d="M12 38c0-6.627 5.373-12 12-12s12 5.373 12 12"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
            <circle cx="35" cy="13" r="5" stroke="white" strokeWidth="2" opacity="0.6" />
            <path
              d="M28 38c0-4.5 3.134-8 7-8s7 3.5 7 8"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              opacity="0.6"
            />
          </svg>
        </div>
        <h1 className="mb-2 text-center text-3xl font-bold text-gray-950">
          EJM Babysitting
        </h1>
        <p className="max-w-[260px] text-center text-base leading-relaxed text-gray-500">
          Connecting EJM families with trusted student babysitters
        </p>
      </div>

      {/* Actions */}
      <div className="pb-8">
        <p className="mb-4 text-center text-sm font-medium text-gray-500">
          I am a...
        </p>

        <Link
          to="/enroll/babysitter"
          className="mb-3 flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-red-600 text-base font-semibold text-white transition-colors hover:bg-red-600/90"
        >
          <UserIcon className="h-5 w-5" />
          Babysitter
        </Link>

        <Link
          to="/enroll/parent"
          className="mb-6 flex h-[52px] w-full items-center justify-center gap-2 rounded-xl border-[1.5px] border-gray-300 bg-white text-base font-semibold text-gray-950 transition-colors hover:border-gray-950"
        >
          <UsersIcon className="h-5 w-5" />
          Parent
        </Link>

        <div className="text-center">
          <span className="text-sm text-gray-500">
            Already have an account?{' '}
          </span>
          <Link
            to="/login"
            className="text-sm font-semibold text-red-600 hover:underline"
          >
            Log in
          </Link>
        </div>
      </div>

      {/* Footer links */}
      <div className="flex justify-center gap-4 pb-2">
        <Link to="/about" className="text-xs text-gray-400 hover:text-gray-600">
          About
        </Link>
        <Link to="/privacy" className="text-xs text-gray-400 hover:text-gray-600">
          Privacy
        </Link>
        <Link to="/terms" className="text-xs text-gray-400 hover:text-gray-600">
          Terms
        </Link>
        <Link to="/report" className="text-xs text-gray-400 hover:text-gray-600">
          Help
        </Link>
      </div>
    </div>
  );
}
