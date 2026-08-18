import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { BellIcon } from './Icons';
import { useNotifications } from '@/stores/notificationsStore';

/**
 * App-bar bell (issue #127, UX F13): links to the role's /notifications page
 * and badges the unread count among THIS app's visible types (the shared
 * store filters; see notificationsStore). Renders as a Link — same 44px hit
 * target as the bar's other controls (WCAG 2.5.8) — with the shared-ui Badge
 * amber tokens on the count pill.
 */
export function NotificationBell({ to }: { to: string }) {
  const { t } = useTranslation();
  const { unreadCount } = useNotifications();

  return (
    <Link
      to={to}
      aria-label={
        unreadCount > 0
          ? t('notifications.bellAriaUnread', { count: unreadCount })
          : t('notifications.bellAria')
      }
      className="relative -m-1.5 flex h-11 w-11 items-center justify-center text-white"
    >
      <BellIcon className="h-5 w-5" />
      {unreadCount > 0 && (
        <span
          aria-hidden="true"
          className="absolute right-0.5 top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-amber-100 px-1 text-[10px] font-medium text-amber-600"
        >
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </Link>
  );
}
