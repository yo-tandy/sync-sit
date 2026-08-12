import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { useRefetchOnFocus } from '@ejm/shared-ui';
import { functions } from '@/config/firebase';
import { Card, Button, Badge, TopNav, Spinner, Dialog } from '@/components/ui';
import { ChevronRightIcon } from '@/components/ui/Icons';
import type {
  GovernedChildrenResult,
  GovernedChildSummary,
  GuardianProfileSummary,
  KidInviteRow,
} from '@/types/guardian';

const LINK_STATUS_VARIANT: Record<GovernedChildSummary['link']['status'], 'amber' | 'green' | 'gray'> = {
  pending: 'amber',
  active: 'green',
  revoked: 'gray',
};

/**
 * Family governance dashboard: every guardian link of the family (any status)
 * plus its pending kid invites, all loaded through the getGovernedChildren
 * callable — the page performs NO client Firestore reads. Mutations
 * (resend/cancel invite) are NON-OPTIMISTIC: the row changes only after the
 * callable resolves, and the whole list is refetched so the UI always shows
 * backend truth. Copy-adapted from sync-study's GovernancePage.
 */
export function GovernancePage() {
  const { t, i18n } = useTranslation();

  const [data, setData] = useState<GovernedChildrenResult | null>(null);
  // Mirror of `data` readable inside load's catch without re-creating it.
  const dataRef = useRef<GovernedChildrenResult | null>(null);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // inviteId awaiting resend/cancel, or null (disables that row's actions).
  const [actingId, setActingId] = useState<string | null>(null);
  // The invite whose cancel-confirmation dialog is open, or null.
  const [cancelTarget, setCancelTarget] = useState<KidInviteRow | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const fn = httpsCallable<void, GovernedChildrenResult>(functions, 'getGovernedChildren');
      const res = await fn();
      if (!mountedRef.current) return;
      setData(res.data);
      setLoadError(false);
    } catch {
      // Last-known-good: a focus-refetch blip must not stamp an error banner
      // over data that is still rendered. Only a load with nothing to show
      // surfaces the error state.
      if (mountedRef.current) setLoadError((prev) => prev || dataRef.current === null);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Issue #117 tier (a): callable-sourced (no onSnapshot possible) — a
  // returning user re-runs the same load. Mirrors study's GovernancePage.
  useRefetchOnFocus(load);

  const formatDate = (iso: string | null): string => {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString(i18n.language === 'fr' ? 'fr-FR' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const runInviteAction = async (name: 'resendKidInvite' | 'cancelKidInvite', inviteId: string) => {
    setActionError(null);
    setActingId(inviteId);
    try {
      const fn = httpsCallable<{ inviteId: string }, { success: boolean }>(functions, name);
      await fn({ inviteId });
      await load();
    } catch {
      if (mountedRef.current) setActionError(t('governance.actionError'));
    } finally {
      if (mountedRef.current) setActingId(null);
    }
  };

  const children = data?.children ?? [];
  const invites = data?.invites ?? [];
  const now = Date.now();

  const profileChip = (labelKey: string, profile: GuardianProfileSummary | null) => {
    if (!profile) return null;
    return (
      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
        {t(labelKey)} ·{' '}
        {profile.searchable ? t('governance.searchableOn') : t('governance.searchableOff')}
      </span>
    );
  };

  const kidCard = (child: GovernedChildSummary) => (
    <Card interactive={child.link.status === 'active'}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">
            {[child.firstName, child.lastName].filter(Boolean).join(' ')}
          </p>
          {child.age != null && (
            <p className="text-xs text-gray-500">{t('governance.age', { age: child.age })}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant={LINK_STATUS_VARIANT[child.link.status]}>
            {t(`governance.linkStatus.${child.link.status}`)}
          </Badge>
          {child.link.status === 'active' && <ChevronRightIcon className="h-5 w-5 text-gray-400" />}
        </div>
      </div>
      {(child.profiles.babysitter || child.profiles.tutor) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {profileChip('governance.profileBabysitter', child.profiles.babysitter)}
          {profileChip('governance.profileTutor', child.profiles.tutor)}
        </div>
      )}
      <p className="mt-2 text-xs text-gray-500">
        {t('governance.upcoming30', {
          sit: child.upcoming.sitAppointments,
          study: child.upcoming.studySessions,
        })}
      </p>
    </Card>
  );

  return (
    <div>
      <TopNav title={t('governance.title')} backTo="/family" />

      <div className="px-5 pt-4 pb-8">
        {actionError && <p className="mb-4 text-sm text-brand-600">{actionError}</p>}

        {data === null && !loadError && (
          <div className="flex justify-center py-20">
            <Spinner />
          </div>
        )}

        {loadError && (
          <p className="py-10 text-center text-sm text-brand-600">{t('governance.loadError')}</p>
        )}

        {data !== null && children.length === 0 && invites.length === 0 && (
          <Card className="mb-4">
            <p className="py-4 text-center text-sm text-gray-500">{t('governance.empty')}</p>
          </Card>
        )}

        {/* ── Supervised kids ── */}
        {children.length > 0 && (
          <div className="mb-6">
            <h2 className="mb-2 text-sm font-semibold text-gray-700">
              {t('governance.kidsTitle')}
            </h2>
            <div className="space-y-3">
              {children.map((child) =>
                child.link.status === 'active' ? (
                  <Link
                    key={child.childUid}
                    to={`/family/governance/${child.childUid}`}
                    className="block"
                  >
                    {kidCard(child)}
                  </Link>
                ) : (
                  <div key={child.childUid}>{kidCard(child)}</div>
                ),
              )}
            </div>
          </div>
        )}

        {/* ── Pending invitations ── */}
        {invites.length > 0 && (
          <div className="mb-6">
            <h2 className="mb-2 text-sm font-semibold text-gray-700">
              {t('governance.invitesTitle')}
            </h2>
            <div className="space-y-3">
              {invites.map((inv) => {
                const expired = inv.expiresAt != null && new Date(inv.expiresAt).getTime() < now;
                return (
                  <Card key={inv.inviteId}>
                    <p className="text-sm font-semibold text-gray-900">
                      {[inv.firstName, inv.lastName].filter(Boolean).join(' ')}
                    </p>
                    <p className="text-xs text-gray-500">{inv.kidEmail}</p>
                    <p className={`mt-0.5 text-xs ${expired ? 'text-brand-600' : 'text-gray-500'}`}>
                      {expired
                        ? t('governance.inviteExpired', { date: formatDate(inv.expiresAt) })
                        : t('governance.inviteExpires', { date: formatDate(inv.expiresAt) })}
                    </p>
                    <div className="mt-3 flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={actingId === inv.inviteId}
                        onClick={() => runInviteAction('resendKidInvite', inv.inviteId)}
                      >
                        {t('governance.resend')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={actingId === inv.inviteId}
                        onClick={() => setCancelTarget(inv)}
                      >
                        {t('governance.cancelInvite')}
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Add a child (single always-present CTA once loaded) ── */}
        {data !== null && (
          <Link to="/family/governance/new" className="block">
            <Card interactive className="flex items-center gap-3 py-4">
              <div className="flex-1">
                <p className="text-sm font-semibold text-gray-900">{t('governance.addChild')}</p>
                <p className="text-xs text-gray-500">{t('governance.addChildDesc')}</p>
              </div>
              <ChevronRightIcon className="h-5 w-5 text-gray-400" />
            </Card>
          </Link>
        )}
      </div>

      {/* ── Cancel-invitation confirmation ── */}
      <Dialog open={cancelTarget !== null} onClose={() => setCancelTarget(null)}>
        <h3 className="mb-2 text-lg font-bold">{t('governance.confirmCancelInviteTitle')}</h3>
        <p className="mb-5 text-sm text-gray-600">
          {t('governance.confirmCancelInviteDesc', {
            name: cancelTarget ? [cancelTarget.firstName, cancelTarget.lastName].join(' ') : '',
          })}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            disabled={actingId !== null}
            onClick={() => {
              const target = cancelTarget;
              setCancelTarget(null);
              if (target) runInviteAction('cancelKidInvite', target.inviteId);
            }}
          >
            {t('governance.confirmCancelInviteCta')}
          </Button>
          <Button variant="ghost" className="flex-1" onClick={() => setCancelTarget(null)}>
            {t('governance.keepInvite')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
