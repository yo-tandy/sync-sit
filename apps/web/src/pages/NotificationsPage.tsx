import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { TopNav, Spinner } from '@/components/ui';
import { useAuthStore } from '@/stores/authStore';
import { useNotifications, type AppNotification } from '@/stores/notificationsStore';
import { notificationRoute } from '@/lib/notificationRouting';
import { getSitRole } from '@ejm/sit-core';

/**
 * /notifications for every signed-in role (issue #127, UX F13). ONE component
 * mounted under all three role layouts (the layouts guard; the role only picks
 * the back target and the tap route). Newest-first — the shared store's query
 * orders by createdAt desc. A tap marks the row read (ONLY the read key —
 * rules-pinned) and navigates via the type→route map; unrouted types just
 * mark read.
 */
export function NotificationsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { userDoc } = useAuthStore();
  const role = getSitRole(userDoc);
  const { notifications, unreadCount, loadError, markRead, markAllRead } = useNotifications();

  const backTo = role === 'babysitter' ? '/babysitter' : role === 'admin' ? '/admin' : '/family';

  const formatDate = (ts: AppNotification['createdAt']): string => {
    const raw: unknown = ts;
    // Emulator-written rows can arrive as a plain Date; production Firestore
    // returns a Timestamp with .toDate(). Handle both, then fall back to ''
    // (mirrors study's RequestsPage).
    const date =
      raw instanceof Date
        ? raw
        : raw && typeof (raw as { toDate?: unknown }).toDate === 'function'
          ? (raw as { toDate: () => Date }).toDate()
          : null;
    if (!date) return '';
    return date.toLocaleDateString(i18n.language === 'fr' ? 'fr-FR' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const onTap = (n: AppNotification) => {
    if (!n.read) void markRead(n.id);
    const to = notificationRoute(n.type, n.data, role);
    if (to) navigate(to);
  };

  return (
    <div>
      <TopNav title={t('notifications.pageTitle')} backTo={backTo} />

      <div className="px-5 pt-4 pb-8">
        {loadError && (
          <p className="py-10 text-center text-sm text-red-600">{t('notifications.loadError')}</p>
        )}

        {!loadError && notifications === null && (
          <div className="flex justify-center py-20">
            <Spinner />
          </div>
        )}

        {!loadError && notifications !== null && notifications.length === 0 && (
          <p className="py-10 text-center text-sm text-gray-500">{t('notifications.empty')}</p>
        )}

        {!loadError && notifications !== null && notifications.length > 0 && (
          <>
            {unreadCount > 0 && (
              <div className="mb-3 flex justify-end">
                <button
                  type="button"
                  onClick={() => void markAllRead()}
                  className="text-sm font-medium text-brand-600"
                >
                  {t('notifications.markAllRead')}
                </button>
              </div>
            )}
            <ul className="space-y-2">
              {notifications.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => onTap(n)}
                    className={`w-full rounded-lg border p-3 text-left ${
                      n.read ? 'border-gray-100 bg-white' : 'border-amber-200 bg-amber-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p
                        className={`text-sm ${
                          n.read ? 'font-medium text-gray-700' : 'font-semibold text-gray-900'
                        }`}
                      >
                        {n.title}
                        {!n.read && <span className="sr-only"> ({t('notifications.unread')})</span>}
                      </p>
                      <span className="shrink-0 text-xs text-gray-400">
                        {formatDate(n.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-gray-500">{n.body}</p>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
