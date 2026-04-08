import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';
import { TopNav } from '@/components/ui/TopNav';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { Dialog } from '@/components/ui/Dialog';
import { useVerificationStore } from '@/stores/verificationStore';

function statusBadgeVariant(status: string): 'green' | 'amber' | 'red' | 'gray' {
  switch (status) {
    case 'approved': return 'green';
    case 'pending': return 'amber';
    case 'rejected': return 'red';
    default: return 'gray';
  }
}

function typeBadgeVariant(type: string): 'blue' | 'green' {
  return type === 'identity' ? 'blue' : 'green';
}

export function AdminVerificationsPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US';

  const {
    pendingVerifications,
    pendingLoading,
    fetchPendingVerifications,
    reviewVerification,
  } = useVerificationStore();

  const [statusFilter, setStatusFilter] = useState('pending');
  const [typeFilter, setTypeFilter] = useState('all');

  // Rejection dialog state
  const [rejectDialog, setRejectDialog] = useState<{
    open: boolean;
    verificationId: string;
  }>({ open: false, verificationId: '' });
  const [rejectionReason, setRejectionReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  // Confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    message: string;
    action: () => Promise<void>;
  }>({ open: false, title: '', message: '', action: async () => {} });

  const loadVerifications = useCallback(() => {
    fetchPendingVerifications({
      status: statusFilter !== 'all' ? statusFilter : undefined,
      type: typeFilter !== 'all' ? typeFilter : undefined,
    });
  }, [fetchPendingVerifications, statusFilter, typeFilter]);

  useEffect(() => {
    loadVerifications();
  }, [loadVerifications]);

  const handleApprove = (verificationId: string) => {
    setConfirmDialog({
      open: true,
      title: t('verification.approveTitle'),
      message: t('verification.approveConfirm'),
      action: async () => {
        setActionLoading(true);
        try {
          await reviewVerification(verificationId, 'approved');
          loadVerifications();
        } finally {
          setActionLoading(false);
        }
      },
    });
  };

  const handleReject = (verificationId: string) => {
    setRejectDialog({ open: true, verificationId });
    setRejectionReason('');
  };

  const handleConfirmReject = async () => {
    setActionLoading(true);
    try {
      await reviewVerification(rejectDialog.verificationId, 'rejected', rejectionReason);
      setRejectDialog({ open: false, verificationId: '' });
      loadVerifications();
    } finally {
      setActionLoading(false);
    }
  };

  const handleConfirm = async () => {
    await confirmDialog.action();
    setConfirmDialog({ open: false, title: '', message: '', action: async () => {} });
  };

  return (
    <div>
      <TopNav title={t('admin.verifications')} backTo="/admin" />

      <div className="px-5 pb-8">
        {/* Filters */}
        <div className="mb-4 flex gap-3">
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            options={[
              { value: 'all', label: t('admin.allStatuses') },
              { value: 'pending', label: t('verification.status_pending') },
              { value: 'approved', label: t('verification.status_approved') },
              { value: 'rejected', label: t('verification.status_rejected') },
            ]}
          />
          <Select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            options={[
              { value: 'all', label: t('verification.allTypes') },
              { value: 'identity', label: t('verification.typeIdentity') },
              { value: 'ejm_enrollment', label: t('verification.typeEnrollment') },
            ]}
          />
        </div>

        {/* List */}
        {pendingLoading ? (
          <div className="flex justify-center py-12">
            <Spinner className="h-8 w-8 text-red-600" />
          </div>
        ) : pendingVerifications.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-gray-500">{t('verification.noVerifications')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {pendingVerifications.map((v) => (
              <Card key={v.id}>
                <div className="mb-2 flex items-start justify-between">
                  <div>
                    <p className="text-sm font-bold text-gray-900">{v.familyName || t('verification.unknownFamily')}</p>
                    <p className="text-xs text-gray-500">{v.parentName}</p>
                    <p className="text-xs text-gray-400">
                      {new Date(v.createdAt).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })}
                    </p>
                  </div>
                  <div className="flex gap-1.5">
                    <Badge variant={typeBadgeVariant(v.type)}>
                      {v.type === 'identity' ? t('verification.typeIdentity') : t('verification.typeEnrollment')}
                    </Badge>
                    <Badge variant={statusBadgeVariant(v.status)}>
                      {t(`verification.status_${v.status}`)}
                    </Badge>
                  </div>
                </div>

                {/* Registered family data for comparison */}
                {v.type === 'ejm_enrollment' && ((v as any).familyParentNames?.length > 0 || (v as any).familyKids?.length > 0) && (
                  <div className="mb-2 rounded-lg border border-blue-100 bg-blue-50 p-3">
                    <p className="mb-1 text-xs font-semibold text-blue-800">{t('verification.registeredFamily')}</p>
                    {(v as any).familyParentNames?.length > 0 && (
                      <p className="text-xs text-blue-700">{t('verification.parents')}: {(v as any).familyParentNames.join(', ')}</p>
                    )}
                    {(v as any).familyKids?.length > 0 && (
                      <p className="text-xs text-blue-700">{t('verification.kids')}: {(v as any).familyKids.map((k: any) => `${k.firstName} (${k.age})`).join(', ')}</p>
                    )}
                  </div>
                )}

                {/* Rejection reason if already rejected */}
                {v.status === 'rejected' && v.rejectionReason && (
                  <div className="mb-2 rounded-lg border border-red-200 bg-red-50 p-2">
                    <p className="text-xs text-red-600">{v.rejectionReason}</p>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        // Extract the storage path from the fileUrl
                        // fileUrl format: https://storage.googleapis.com/.../o/verification-documents%2F...?alt=media&token=...
                        const url = new URL(v.fileUrl);
                        const encodedPath = url.pathname.split('/o/')[1];
                        const filePath = encodedPath ? decodeURIComponent(encodedPath) : '';
                        if (!filePath) { window.open(v.fileUrl, '_blank'); return; }
                        const fn = httpsCallable(functions, 'getVerificationDocument');
                        const result = await fn({ filePath });
                        window.open((result.data as any).url, '_blank');
                      } catch {
                        // Fallback to direct URL if cloud function fails
                        window.open(v.fileUrl, '_blank');
                      }
                    }}
                    className="text-xs font-medium text-red-600 hover:underline"
                  >
                    {t('verification.viewDocument')}
                  </button>

                  {v.status === 'pending' && (
                    <div className="ml-auto flex gap-2">
                      <Button size="sm" onClick={() => handleApprove(v.id)}>
                        {t('verification.approve')}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => handleReject(v.id)}>
                        {t('verification.reject')}
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Approve confirmation dialog */}
      <Dialog open={confirmDialog.open} onClose={() => setConfirmDialog({ ...confirmDialog, open: false })}>
        <h3 className="mb-2 text-lg font-semibold">{confirmDialog.title}</h3>
        <p className="mb-4 text-sm text-gray-600">{confirmDialog.message}</p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setConfirmDialog({ ...confirmDialog, open: false })}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleConfirm} disabled={actionLoading}>
            {actionLoading ? t('common.saving') : t('common.confirm')}
          </Button>
        </div>
      </Dialog>

      {/* Rejection dialog */}
      <Dialog open={rejectDialog.open} onClose={() => setRejectDialog({ ...rejectDialog, open: false })}>
        <h3 className="mb-2 text-lg font-semibold">{t('verification.rejectTitle')}</h3>
        <p className="mb-3 text-sm text-gray-600">{t('verification.rejectDesc')}</p>
        <textarea
          className="mb-4 w-full rounded-lg border border-gray-300 p-3 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
          rows={3}
          placeholder={t('verification.rejectionReasonPlaceholder')}
          value={rejectionReason}
          onChange={(e) => setRejectionReason(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setRejectDialog({ ...rejectDialog, open: false })}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleConfirmReject} disabled={actionLoading}>
            {actionLoading ? t('common.saving') : t('verification.reject')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
