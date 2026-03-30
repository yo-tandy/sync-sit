import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/authStore';
import { ArrowLeftIcon } from '@/components/ui/Icons';

export function LoginPage() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { login, loading, error, clearError } = useAuthStore();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await login(email, password);
      // Wait for user doc to load, then redirect based on role
      const getPath = (role?: string) =>
        role === 'babysitter' ? '/babysitter' : role === 'parent' ? '/family' : role === 'admin' ? '/admin' : '/';

      const path = await new Promise<string>((resolve) => {
        // Timeout after 5s — redirect to home as fallback
        const timeout = setTimeout(() => { unsub(); resolve('/'); }, 5000);

        const unsub = useAuthStore.subscribe((state) => {
          if (!state.loading) {
            clearTimeout(timeout);
            unsub();
            resolve(state.userDoc ? getPath(state.userDoc.role) : '/');
          }
        });

        // Check current state immediately
        const current = useAuthStore.getState();
        if (!current.loading) {
          clearTimeout(timeout);
          unsub();
          resolve(current.userDoc ? getPath(current.userDoc.role) : '/');
        }
      });
      navigate(path);
    } catch {
      // Error is set in the store
    }
  };

  return (
    <div>
      {/* Top nav */}
      <div className="flex h-[52px] items-center justify-between px-5">
        <Link
          to="/"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-100 transition-colors hover:bg-gray-200"
        >
          <ArrowLeftIcon className="h-[18px] w-[18px]" />
        </Link>
        <span className="text-base font-semibold">{t('auth.login')}</span>
        <div className="w-9" />
      </div>

      <div className="px-6 pt-8">
        <div className="mb-6 flex justify-center">
          <img src="/logo.png" alt="Sync/Sit" className="h-20 w-20 rounded-2xl" />
        </div>
        <h2 className="mb-2 text-2xl font-bold">{t('auth.loginTitle')}</h2>
        <p className="mb-8 text-sm text-gray-500">{t('auth.loginSubtitle')}</p>

        <form onSubmit={handleSubmit}>
          <div className="mb-5">
            <label className="mb-2 block text-sm font-medium text-gray-700">
              {t('common.email')}
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                clearError();
              }}
              placeholder="your@email.com"
              className="h-12 w-full rounded-lg border-[1.5px] border-gray-300 bg-white px-4 text-base text-gray-950 outline-none transition-colors placeholder:text-gray-400 focus:border-red-600"
              required
            />
          </div>

          <div className="mb-5">
            <label className="mb-2 block text-sm font-medium text-gray-700">
              {t('common.password')}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                clearError();
              }}
              placeholder="Enter your password"
              className="h-12 w-full rounded-lg border-[1.5px] border-gray-300 bg-white px-4 text-base text-gray-950 outline-none transition-colors placeholder:text-gray-400 focus:border-red-600"
              required
            />
          </div>

          {error && (
            <p className="mb-4 text-sm text-red-600">{error}</p>
          )}

          <div className="mb-6 text-right">
            <Link
              to="/forgot-password"
              className="text-sm font-medium text-red-600 hover:underline"
            >
              {t('auth.forgotPassword')}
            </Link>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex h-[52px] w-full items-center justify-center rounded-xl bg-red-600 text-base font-semibold text-white transition-colors hover:bg-red-600/90 disabled:opacity-50"
          >
            {loading ? t('auth.signingIn') : t('auth.login')}
          </button>
        </form>

        <div className="mt-6 text-center">
          <span className="text-sm text-gray-500">
            {t('auth.noAccount')}{' '}
          </span>
          <Link
            to="/"
            className="text-sm font-semibold text-red-600 hover:underline"
          >
            {t('auth.signUp')}
          </Link>
        </div>
      </div>
    </div>
  );
}
