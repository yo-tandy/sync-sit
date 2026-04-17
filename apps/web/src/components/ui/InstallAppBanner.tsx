import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { isRunningAsPWA } from '@ejm/shared';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { Card } from './Card';
import { DownloadIcon } from './Icons';

/**
 * Banner shown on dashboards when the app runs in a regular browser tab
 * (not installed as a PWA). Encourages the user to add to home screen so
 * push notifications work. Dismissible; dismissal persists on the user doc.
 */
export function InstallAppBanner() {
  const { t } = useTranslation();
  const { userDoc, firebaseUser, refreshUserDoc } = useAuthStore();
  const [dismissing, setDismissing] = useState(false);
  const [hidden, setHidden] = useState(false);

  // Hide when: running as PWA, already dismissed, locally hidden, or no user loaded
  if (
    isRunningAsPWA() ||
    hidden ||
    !userDoc ||
    (userDoc as { dismissedPwaInstallBanner?: boolean }).dismissedPwaInstallBanner
  ) {
    return null;
  }

  const handleDismiss = async () => {
    const uid = firebaseUser?.uid;
    // Optimistic: hide immediately even if persistence fails
    setHidden(true);
    if (!uid) return;
    setDismissing(true);
    try {
      await updateDoc(doc(db, 'users', uid), {
        dismissedPwaInstallBanner: true,
        updatedAt: serverTimestamp(),
      });
      await refreshUserDoc();
    } catch {
      // silent — user already doesn't see it for this session
    } finally {
      setDismissing(false);
    }
  };

  return (
    <Card className="mb-4 border-blue-200 bg-blue-50">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100">
          <DownloadIcon className="h-5 w-5 text-blue-600" />
        </div>
        <div className="flex-1">
          <p className="mb-1 text-sm font-semibold text-blue-900">
            {t('pwaInstall.bannerTitle')}
          </p>
          <p className="mb-3 text-xs text-blue-700">{t('pwaInstall.bannerDesc')}</p>
          <Link
            to="/install"
            className="inline-block rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
          >
            {t('pwaInstall.bannerCta')}
          </Link>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          disabled={dismissing}
          aria-label={t('pwaInstall.bannerDismiss')}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-blue-400 hover:bg-blue-100 hover:text-blue-600 disabled:opacity-50"
        >
          ✕
        </button>
      </div>
    </Card>
  );
}
