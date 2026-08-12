import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { TopNav, Card, Badge, Button, Spinner } from '@ejm/shared-ui';
import { useVerificationStore } from '@/stores/verificationStore';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ACCEPTED_TYPES = ['image/', 'application/pdf'];

function statusBadgeVariant(status: string): 'green' | 'amber' | 'red' | 'gray' {
  switch (status) {
    case 'approved':
      return 'green';
    case 'pending':
      return 'amber';
    case 'rejected':
      return 'red';
    default:
      return 'gray';
  }
}

export function VerificationPage() {
  const { t } = useTranslation();
  const { verification, documents, loading, uploading, fetchStatus, submit } =
    useVerificationStore();

  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchStatus();
    // Fetch once on mount; the store action identity is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const identityStatus = verification?.identityStatus || 'not_submitted';
  const latestDoc = documents[0];
  // The upload form is shown only when the tutor can (re)submit — i.e. before a
  // decision or after a rejection. Pending/approved states are read-only.
  const canSubmit = identityStatus === 'not_submitted' || identityStatus === 'rejected';

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError('');
    setFile(e.target.files?.[0] || null);
  };

  const handleUpload = async () => {
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      setFileError(t('tutor.verification.fileTooLarge'));
      return;
    }
    if (!ACCEPTED_TYPES.some((prefix) => file.type.startsWith(prefix))) {
      setFileError(t('tutor.verification.invalidFileType'));
      return;
    }
    setFileError('');
    try {
      await submit(file);
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      await fetchStatus();
    } catch {
      setFileError(t('tutor.verification.uploadError'));
    }
  };

  return (
    <div>
      <TopNav title={t('tutor.verificationTitle')} backTo="/tutor" />

      <div className="px-5 pb-8">
        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner className="h-8 w-8 text-brand-600" />
          </div>
        ) : (
          <>
            <div className="mb-4 rounded-lg bg-gray-50 p-4">
              <p className="text-sm leading-relaxed text-gray-600">
                {t('tutor.verification.whyRequired')}
              </p>
            </div>

            {/* Current status */}
            <Card className="mb-6">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-900">
                  {t('tutor.verification.statusLabel')}
                </span>
                <Badge variant={statusBadgeVariant(identityStatus)}>
                  {t(`tutor.verification.status_${identityStatus}`)}
                </Badge>
              </div>

              {identityStatus === 'pending' && (
                <p className="mt-3 text-sm text-amber-700">
                  {t('tutor.verification.pendingReview')}
                </p>
              )}

              {identityStatus === 'approved' && (
                <p className="mt-3 text-sm text-green-700">
                  {t('tutor.verification.approvedMessage')}
                </p>
              )}
            </Card>

            {/* Upload / resubmit */}
            {canSubmit && (
              <Card>
                {identityStatus === 'rejected' && latestDoc?.rejectionReason && (
                  <div className="mb-3 rounded-lg border border-brand-200 bg-brand-50 p-3">
                    <p className="text-xs font-medium text-brand-800">
                      {t('tutor.verification.rejectedReason')}
                    </p>
                    <p className="text-xs text-brand-600">{latestDoc.rejectionReason}</p>
                  </div>
                )}
                <h3 className="mb-1 text-sm font-semibold text-gray-900">
                  {identityStatus === 'rejected'
                    ? t('tutor.verification.resubmitCta')
                    : t('tutor.verification.uploadCta')}
                </h3>
                <p className="mb-3 text-xs text-gray-500">
                  {t('tutor.verification.identityDesc')}
                </p>
                <input
                  ref={inputRef}
                  type="file"
                  accept="image/*,.pdf"
                  onChange={handleFileChange}
                  className="mb-3 block w-full text-sm text-gray-500 file:mr-4 file:rounded-lg file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-brand-600 hover:file:bg-brand-100"
                />
                {fileError && <p className="mb-2 text-xs text-brand-600">{fileError}</p>}
                <Button size="sm" onClick={handleUpload} disabled={!file || uploading}>
                  {uploading ? t('common.saving') : t('tutor.verification.upload')}
                </Button>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
