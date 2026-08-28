import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAdminStore, type SupervisedAccountRow, type GovernanceAlert } from '@/stores/adminStore';
import { Card, Button, Badge, TopNav, Spinner, Dialog, Textarea } from '@/components/ui';

const LINK_STATUS_VARIANT: Record<SupervisedAccountRow['link']['status'], 'amber' | 'green' | 'gray'> = {
  pending: 'amber',
  active: 'green',
  revoked: 'gray',
};

/**
 * Admin governance panel: the supervised-accounts GDPR view (every guardian
 * link with its consent record), the governance alert queue, and per-link
 * force-revocation. All data through the admin callables; every mutation is
 * NON-OPTIMISTIC (refetch after resolve).
 */
export function AdminGovernancePage() {
  const { t, i18n } = useTranslation();
  const {
    supervisedAccounts,
    supervisedLoading,
    fetchSupervisedAccounts,
    governanceAlerts,
    governanceAlertsLoading,
    fetchGovernanceAlerts,
    reviewGovernanceAlert,
    forceRevokeSupervision,
  } = useAdminStore();

  const [onlyUnreviewed, setOnlyUnreviewed] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<SupervisedAccountRow | null>(null);
  const [revokeReason, setRevokeReason] = useState('');

  const loadAlerts = useCallback(
    (unreviewedOnly: boolean) => {
      fetchGovernanceAlerts(unreviewedOnly).catch(() => setError(t('admin.governance.error')));
    },
    [fetchGovernanceAlerts, t],
  );

  useEffect(() => {
    fetchSupervisedAccounts().catch(() => setError(t('admin.governance.error')));
    loadAlerts(true);
    // Mount-only: the toggle and the mutations refetch explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const formatIso = (iso: string | null): string => {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString(i18n.language === 'fr' ? 'fr-FR' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const toggleUnreviewed = () => {
    const next = !onlyUnreviewed;
    setOnlyUnreviewed(next);
    loadAlerts(next);
  };

  const markReviewed = async (alertId: string) => {
    setError(null);
    setActing(true);
    try {
      await reviewGovernanceAlert(alertId);
      await fetchGovernanceAlerts(onlyUnreviewed);
    } catch {
      setError(t('admin.governance.error'));
    } finally {
      setActing(false);
    }
  };

  const submitRevoke = async () => {
    const target = revokeTarget;
    const reason = revokeReason.trim();
    if (!target || !reason) return;
    setError(null);
    setActing(true);
    try {
      await forceRevokeSupervision(target.childUid, reason);
      setRevokeTarget(null);
      setRevokeReason('');
      await fetchSupervisedAccounts();
    } catch {
      setError(t('admin.governance.error'));
    } finally {
      setActing(false);
    }
  };

  // Mirrors the backend's minor test: a missing DOB cannot prove 15+.
  const isMinor = (row: SupervisedAccountRow) => row.child.age == null || row.child.age < 15;

  const alertSummary = (alert: GovernanceAlert) =>
    Object.entries(alert.data)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join(' · ');

  const kidName = (row: SupervisedAccountRow) =>
    [row.child.firstName, row.child.lastName].filter(Boolean).join(' ');

  return (
    <div>
      <TopNav title={t('admin.governance.title')} backTo="/admin" />

      <div className="px-5 pt-4 pb-8">
        {error && <p className="mb-4 text-sm text-brand-600">{error}</p>}

        {/* ── 1. Supervised accounts (the GDPR view) ── */}
        <h2 className="mb-1 text-sm font-semibold text-gray-700">
          {t('admin.governance.accountsTitle')}
        </h2>
        <p className="mb-3 text-xs text-gray-500">{t('admin.governance.accountsDesc')}</p>
        {supervisedLoading && supervisedAccounts.length === 0 ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : supervisedAccounts.length === 0 ? (
          <Card className="mb-6">
            <p className="py-3 text-center text-sm text-gray-500">
              {t('admin.governance.accountsEmpty')}
            </p>
          </Card>
        ) : (
          <div className="mb-6 space-y-3">
            {supervisedAccounts.map((row) => (
              <Card key={row.childUid}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{kidName(row)}</p>
                    <p className="text-xs text-gray-500">
                      {row.child.email}
                      {row.child.age != null &&
                        ` · ${t('admin.governance.age', { age: row.child.age })}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge variant={LINK_STATUS_VARIANT[row.link.status]}>
                      {t(`admin.governance.linkStatus.${row.link.status}`)}
                    </Badge>
                    <span className="text-xs text-gray-500">
                      {t(`admin.governance.origin.${row.link.origin}`)}
                    </span>
                  </div>
                </div>
                <p className="mt-1 text-xs text-gray-700">{row.familyName}</p>

                {/* The consent record — versions + approval date. */}
                <p className="mt-2 text-xs text-gray-600">
                  {t('admin.governance.consentLine', {
                    tos: row.consent.tosVersion ?? '—',
                    privacy: row.consent.privacyVersion ?? '—',
                    agreement: row.consent.supervisionAgreementVersion ?? '—',
                  })}
                </p>
                <p className="text-xs text-gray-500">
                  {row.consent.approvedAt &&
                    t('admin.governance.consentApproved', {
                      date: formatIso(row.consent.approvedAt),
                    })}
                  {row.link.revokedAt &&
                    ` · ${t('admin.governance.revokedAt', { date: formatIso(row.link.revokedAt) })}`}
                </p>
                {row.child.identityLocked && (
                  <p className="mt-1 text-xs text-gray-500">
                    {t('admin.governance.identityLocked')}
                  </p>
                )}

                {row.link.status === 'active' && (
                  <div className="mt-3">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={acting}
                      onClick={() => {
                        setRevokeReason('');
                        setRevokeTarget(row);
                      }}
                    >
                      {t('admin.governance.forceRevoke')}
                    </Button>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}

        {/* ── 2. Alerts ── */}
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">
            {t('admin.governance.alertsTitle')}
          </h2>
          <label className="flex items-center gap-2 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={onlyUnreviewed}
              onChange={toggleUnreviewed}
              className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
            />
            {t('admin.governance.onlyUnreviewed')}
          </label>
        </div>
        {governanceAlertsLoading && governanceAlerts.length === 0 ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : governanceAlerts.length === 0 ? (
          <Card>
            <p className="py-3 text-center text-sm text-gray-500">
              {t('admin.governance.alertsEmpty')}
            </p>
          </Card>
        ) : (
          <div className="space-y-3">
            {governanceAlerts.map((alert) => (
              <Card key={alert.alertId}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900">
                      {t(`admin.governance.alertType.${alert.type}`, alert.type)}
                    </p>
                    <p className="text-xs text-gray-500">{formatIso(alert.createdAt)}</p>
                  </div>
                  {alert.reviewedAt && (
                    <Badge variant="gray">
                      {t('admin.governance.reviewedAt', { date: formatIso(alert.reviewedAt) })}
                    </Badge>
                  )}
                </div>
                <p className="mt-2 break-all rounded-lg bg-gray-50 p-2 text-xs text-gray-600">
                  {alertSummary(alert)}
                </p>
                {!alert.reviewedAt && (
                  <div className="mt-3">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={acting}
                      onClick={() => markReviewed(alert.alertId)}
                    >
                      {t('admin.governance.markReviewed')}
                    </Button>
                  </div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* ── Force-revoke confirmation (reason required) ── */}
      <Dialog
        open={revokeTarget !== null}
        onClose={() => {
          setRevokeTarget(null);
          setRevokeReason('');
        }}
        ariaLabel={t('admin.governance.forceRevokeTitle')}
      >
        <h3 className="mb-2 text-lg font-bold">{t('admin.governance.forceRevokeTitle')}</h3>
        <p className="mb-3 text-sm text-gray-600">
          {t('admin.governance.forceRevokeDesc', {
            name: revokeTarget ? kidName(revokeTarget) : '',
            family: revokeTarget?.familyName ?? '',
          })}
        </p>
        {revokeTarget && isMinor(revokeTarget) && (
          <p className="mb-3 rounded-lg border border-brand-200 bg-brand-50 p-3 text-xs text-brand-700">
            {t('admin.governance.forceRevokeMinorWarning')}
          </p>
        )}
        <Textarea
          value={revokeReason}
          onChange={(e) => setRevokeReason(e.target.value)}
          placeholder={t('admin.governance.forceRevokeReasonPlaceholder')}
          required
        />
        <div className="mt-4 flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            disabled={acting || !revokeReason.trim()}
            onClick={submitRevoke}
          >
            {t('admin.governance.forceRevokeConfirm')}
          </Button>
          <Button
            variant="ghost"
            className="flex-1"
            onClick={() => {
              setRevokeTarget(null);
              setRevokeReason('');
            }}
          >
            {t('admin.governance.forceRevokeKeep')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
