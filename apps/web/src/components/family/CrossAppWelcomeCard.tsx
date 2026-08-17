import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui';

// One-time key per app+browser (issue #144): profiles.parent is SHARED between
// the apps, so a switching parent is already registered — this card only
// explains that, once, with no doc writes.
const STORAGE_KEY = 'sync-welcome-seen-sit';

function alreadySeen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return true; // storage unavailable: never nag on every visit
  }
}

/** One-time dismissible welcome for parents arriving from Sync/Study. */
export function CrossAppWelcomeCard() {
  const { t } = useTranslation();
  const [hidden, setHidden] = useState(alreadySeen);

  if (hidden) return null;

  const handleDismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, 'true');
    } catch {
      // storage unavailable — hidden for this session anyway
    }
    setHidden(true);
  };

  return (
    <Card className="mb-4 border-brand-200 bg-brand-50">
      <div className="flex items-start gap-3">
        <p className="flex-1 text-sm text-gray-700">{t('welcomeCross.parentCard')}</p>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label={t('welcomeCross.dismiss')}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-brand-400 hover:bg-brand-100 hover:text-brand-600"
        >
          ✕
        </button>
      </div>
    </Card>
  );
}
