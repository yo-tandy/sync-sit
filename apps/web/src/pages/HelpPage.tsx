import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { DeleteAccountRow } from '@ejm/shared-ui';
import { TopNav } from '@/components/ui';
import { functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { SUPPORT_EMAIL } from '@/constants/brand';
import { HUB_PATHS } from '@/lib/hubRoutes';

/**
 * The account hub's Help page (`HUB_PATHS.help`): the support and legal
 * entries that used to sit at the bottom of every app's burger menu, plus
 * account deletion. The account is shared across the suite, so these live
 * once, here, rather than once per app.
 */
export function HelpPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);

  const rows: Array<{ label: string; onClick: () => void }> = [
    { label: t('menu.about'), onClick: () => void navigate(HUB_PATHS.about) },
    { label: t('menu.privacyPolicy'), onClick: () => void navigate(HUB_PATHS.privacy) },
    { label: t('menu.terms'), onClick: () => void navigate(HUB_PATHS.terms) },
    {
      label: t('menu.sendFeedback'),
      // Suite-wide, not "— Sync/Sit": the hub belongs to no single app.
      onClick: () => {
        window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Feedback — Sync')}`;
      },
    },
    { label: t('menu.reportProblem'), onClick: () => void navigate(HUB_PATHS.report) },
  ];

  // Fixed, matching `deleteMyAccount`'s own non-localised confirmation token
  // (`packages/shared-functions/src/account/deleteMyAccount.ts`). Only ever
  // sent once `DeleteAccountRow`'s own gate has matched the typed literal.
  const deleteMyAccount = () =>
    httpsCallable<{ confirm: string }, void>(functions, 'deleteMyAccount')({
      confirm: 'DELETE',
    }).then(() => undefined);

  return (
    <div>
      <TopNav title={t('accountHub.help')} backTo="/account" />
      <div className="px-5 pt-4 pb-8">
        {/* focus-ring-inset: full-bleed rows inside a clipped, rounded list
            (same opt-in as AccountHome's lists, issue #325). */}
        <ul className="focus-ring-inset overflow-hidden rounded-lg border border-gray-200 bg-white">
          {rows.map((row, i) => (
            <li key={row.label} className={i > 0 ? 'border-t border-gray-100' : ''}>
              <button
                type="button"
                onClick={row.onClick}
                className="flex w-full items-center px-4 py-3 text-left active:bg-gray-50"
              >
                <span className="text-sm font-semibold text-gray-900">{row.label}</span>
              </button>
            </li>
          ))}
          <li className="border-t border-gray-100">
            <DeleteAccountRow
              onSignOut={logout}
              onDeleteAccount={deleteMyAccount}
              onDeleted={() => navigate('/account-deleted')}
            />
          </li>
        </ul>
      </div>
    </div>
  );
}
