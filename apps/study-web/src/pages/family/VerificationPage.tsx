import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ref, uploadBytes } from 'firebase/storage';
import { storage } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { useVerificationStore } from '@/stores/verificationStore';
import { Badge, Button, Card, Checkbox, Input, Spinner, TopNav } from '@ejm/shared-ui';
import { getParentProfile } from '@ejm/shared-core';

/**
 * Family verification, ported from sync-sit's VerificationPage
 * (apps/web/src/pages/family/VerificationPage.tsx) per issue #129: the flow is
 * one shared cross-app fact (same families/verifications data, same deployed
 * callables) but must OPEN in the current app. Behavior is sit's, verbatim:
 * document upload (identity + EJM enrollment tabs), per-type status, and the
 * community-verification path (ask for a code / approve a friend).
 *
 * Uploads write to verification-documents/{familyId}/ in the shared bucket —
 * storage.rules allows writes there only for members of the owning family
 * (profiles.parent.familyId match) or admins, capped at 10MB (issue #153).
 */

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

function statusBadgeVariant(status: string): 'green' | 'amber' | 'red' | 'gray' {
  switch (status) {
    case 'approved': return 'green';
    case 'pending': return 'amber';
    case 'rejected': return 'red';
    default: return 'gray';
  }
}

export function VerificationPage() {
  const { t, i18n } = useTranslation();
  const { userDoc } = useAuthStore();
  const familyId = getParentProfile(userDoc)?.familyId;

  const {
    familyVerification,
    documents,
    loading,
    uploading,
    fetchStatus,
    submitDocument,
    communityCode,
    communityCodeExpires,
    communityCodeLoading,
    lookupResult,
    lookupLoading,
    approving,
    generateCommunityCode,
    lookupCommunityCode,
    approveCommunityCode,
    clearLookup,
  } = useVerificationStore();

  const [activeTab, setActiveTab] = useState<'identity' | 'enrollment'>('identity');
  const [identityFile, setIdentityFile] = useState<File | null>(null);
  const [identityError, setIdentityError] = useState('');
  const identityInputRef = useRef<HTMLInputElement>(null);

  // Enrollment form state
  const [enrollmentFile, setEnrollmentFile] = useState<File | null>(null);
  const [enrollmentError, setEnrollmentError] = useState('');
  const enrollmentInputRef = useRef<HTMLInputElement>(null);

  // Community verification state
  const [approveCode, setApproveCode] = useState('');
  const [approveError, setApproveError] = useState('');
  const [approveSuccess, setApproveSuccess] = useState(false);
  const [knowPerson, setKnowPerson] = useState(false);
  const [confirmEjm, setConfirmEjm] = useState(false);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const handleUpload = async (file: File, type: 'identity' | 'ejm_enrollment', metadata?: Record<string, string>) => {
    if (!familyId) return;
    const path = `verification-documents/${familyId}/${Date.now()}-${file.name}`;
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, file);
    // Do NOT getDownloadURL here: storage.rules deny reads on
    // verification-documents (reads go through the getVerificationDocument
    // callable), so the metadata read behind getDownloadURL is rejected and
    // the upload flow always failed. The stored fileUrl only needs to be
    // parseable back to the storage path (the admin UI splits on '/o/'), so
    // build the canonical URL. Mirrors the sit fix (8f7802c).
    const bucket = storage.app.options.storageBucket;
    const fileUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}`;
    await submitDocument({ type, fileUrl, fileName: file.name, ...metadata });
    await fetchStatus();
  };

  const handleIdentityUpload = async () => {
    if (!identityFile) return;
    if (identityFile.size > MAX_FILE_SIZE) {
      setIdentityError(t('family.verification.fileTooLarge'));
      return;
    }
    setIdentityError('');
    try {
      await handleUpload(identityFile, 'identity');
      setIdentityFile(null);
      if (identityInputRef.current) identityInputRef.current.value = '';
    } catch {
      setIdentityError(t('family.verification.uploadError'));
    }
  };

  const handleEnrollmentUpload = async () => {
    if (!enrollmentFile) return;
    if (enrollmentFile.size > MAX_FILE_SIZE) {
      setEnrollmentError(t('family.verification.fileTooLarge'));
      return;
    }
    setEnrollmentError('');
    try {
      await handleUpload(enrollmentFile, 'ejm_enrollment');
      setEnrollmentFile(null);
      if (enrollmentInputRef.current) enrollmentInputRef.current.value = '';
    } catch {
      setEnrollmentError(t('family.verification.uploadError'));
    }
  };

  // The server discriminates actionable failures with details.reason; a stale
  // request gets its own copy rather than the raw server message (#218).
  const approveErrorMessage = (err: unknown, fallback: string) => {
    const reason = (err as { details?: { reason?: string } } | null)?.details?.reason;
    if (reason === 'already_verified') return t('family.verification.communityAlreadyVerified');
    return err instanceof Error ? err.message : fallback;
  };

  const handleLookup = async () => {
    setApproveError('');
    try {
      await lookupCommunityCode(approveCode.trim());
    } catch (err: unknown) {
      setApproveError(approveErrorMessage(err, 'Invalid code'));
    }
  };

  const handleCommunityApprove = async () => {
    setApproveError('');
    try {
      await approveCommunityCode(approveCode.trim());
      setApproveSuccess(true);
      setApproveCode('');
      setKnowPerson(false);
      setConfirmEjm(false);
    } catch (err: unknown) {
      setApproveError(approveErrorMessage(err, 'Approval failed'));
    }
  };

  const identityStatus = familyVerification?.identityStatus || 'not_submitted';
  const enrollmentStatus = familyVerification?.enrollmentStatus || 'not_submitted';
  const isFullyVerified = familyVerification?.isFullyVerified === true;

  const identityDocs = documents.filter((d) => d.type === 'identity');
  const enrollmentDocs = documents.filter((d) => d.type === 'ejm_enrollment');

  const borderColor = isFullyVerified
    ? 'border-green-300'
    : identityStatus === 'pending' || enrollmentStatus === 'pending'
      ? 'border-amber-300'
      : 'border-brand-300';

  const bgColor = isFullyVerified
    ? 'bg-green-50'
    : identityStatus === 'pending' || enrollmentStatus === 'pending'
      ? 'bg-amber-50'
      : 'bg-brand-50';

  return (
    <div>
      <TopNav title={t('family.verification.title')} backTo="/family" />

      <div className="mx-auto max-w-md px-5 pb-16">
        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner className="h-8 w-8 text-brand-600" />
          </div>
        ) : (
          <>
            {/* Explanation */}
            {!isFullyVerified && (
              <div className="mb-4 rounded-lg bg-gray-50 p-4">
                <p className="text-sm leading-relaxed text-gray-600">
                  {t('family.verification.whyRequired')}
                </p>
              </div>
            )}

            {/* Fully verified banner */}
            {isFullyVerified && (
              <div className="mb-4 rounded-lg border border-green-300 bg-green-50 p-4 text-center">
                <p className="text-sm font-semibold text-green-800">{t('family.verification.fullyVerified')}</p>
                <p className="mt-1 text-xs text-green-600">{t('family.verification.fullyVerifiedDesc')}</p>
              </div>
            )}

            {/* Status overview */}
            <Card className={`mb-6 border ${borderColor} ${bgColor}`}>
              <h3 className="mb-3 text-sm font-semibold text-gray-900">{t('family.verification.statusOverview')}</h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">{t('family.verification.identityVerification')}</span>
                  <Badge variant={statusBadgeVariant(identityStatus)}>
                    {t(`family.verification.status_${identityStatus}`)}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">{t('family.verification.enrollmentVerification')}</span>
                  <Badge variant={statusBadgeVariant(enrollmentStatus)}>
                    {t(`family.verification.status_${enrollmentStatus}`)}
                  </Badge>
                </div>
              </div>
            </Card>

            {/* ── Section: Verification with Documents ── */}
            <div className="mb-6">
              <h3 className="mb-3 text-base font-bold text-gray-900">{t('family.verification.documentSection')}</h3>

            {/* Tabs */}
            <div className="mb-4 flex rounded-lg border border-gray-200 bg-gray-100 p-1">
              <button
                type="button"
                onClick={() => setActiveTab('identity')}
                className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  activeTab === 'identity'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {t('family.verification.identity')}
                {identityStatus !== 'not_submitted' && (
                  <Badge variant={statusBadgeVariant(identityStatus)} className="ml-2">
                    {t(`family.verification.status_${identityStatus}`)}
                  </Badge>
                )}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('enrollment')}
                className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  activeTab === 'enrollment'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {t('family.verification.enrollment')}
                {enrollmentStatus !== 'not_submitted' && (
                  <Badge variant={statusBadgeVariant(enrollmentStatus)} className="ml-2">
                    {t(`family.verification.status_${enrollmentStatus}`)}
                  </Badge>
                )}
              </button>
            </div>

            {/* Identity section */}
            {activeTab === 'identity' && (
            <div className="mb-6">

              {identityStatus === 'approved' ? (
                <Card>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-700">{identityDocs[0]?.fileName}</span>
                    <Badge variant="green">{t('family.verification.status_approved')}</Badge>
                  </div>
                </Card>
              ) : identityStatus === 'pending' ? (
                <Card className="border-amber-200 bg-amber-50">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-amber-800">{t('family.verification.pendingReview')}</p>
                      <p className="text-xs text-amber-600">{identityDocs[0]?.fileName}</p>
                    </div>
                    <Badge variant="amber">{t('family.verification.status_pending')}</Badge>
                  </div>
                </Card>
              ) : (
                <Card>
                  {identityStatus === 'rejected' && identityDocs[0]?.rejectionReason && (
                    <div className="mb-3 rounded-lg border border-brand-200 bg-brand-50 p-3">
                      <p className="text-xs font-medium text-brand-800">{t('family.verification.rejectedReason')}</p>
                      <p className="text-xs text-brand-600">{identityDocs[0].rejectionReason}</p>
                    </div>
                  )}
                  <p className="mb-3 text-xs text-gray-500">{t('family.verification.identityDesc')}</p>
                  <input
                    ref={identityInputRef}
                    type="file"
                    accept="image/*,.pdf"
                    aria-label={t('family.verification.identity')}
                    onChange={(e) => setIdentityFile(e.target.files?.[0] || null)}
                    className="mb-3 block w-full text-sm text-gray-500 file:mr-4 file:rounded-lg file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-brand-600 hover:file:bg-brand-100"
                  />
                  {identityError && <p className="mb-2 text-xs text-brand-600">{identityError}</p>}
                  <Button
                    size="sm"
                    onClick={handleIdentityUpload}
                    disabled={!identityFile || uploading}
                  >
                    {uploading ? t('common.saving') : t('family.verification.upload')}
                  </Button>
                </Card>
              )}
            </div>
            )}

            {/* Enrollment section */}
            {activeTab === 'enrollment' && (
            <div className="mb-6">

              {/* List of submitted enrollment docs */}
              {enrollmentDocs.length > 0 && (
                <div className="mb-3 space-y-2">
                  {enrollmentDocs.map((doc) => (
                    <Card key={doc.id}>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{doc.childName}</p>
                          <p className="text-xs text-gray-500">
                            {doc.schoolYear && `${doc.schoolYear}`}
                            {doc.classLevel && ` - ${doc.classLevel}`}
                          </p>
                          {doc.status === 'rejected' && doc.rejectionReason && (
                            <p className="mt-1 text-xs text-brand-600">{doc.rejectionReason}</p>
                          )}
                        </div>
                        <Badge variant={statusBadgeVariant(doc.status)}>
                          {t(`family.verification.status_${doc.status}`)}
                        </Badge>
                      </div>
                    </Card>
                  ))}
                </div>
              )}

              {/* Upload enrollment document */}
              <Card>
                <p className="mb-3 text-xs text-gray-500">{t('family.verification.enrollmentDesc')}</p>
                <p className="mb-3 text-xs text-gray-500">{t('family.verification.enrollmentNote')}</p>
                <input
                  ref={enrollmentInputRef}
                  type="file"
                  accept="image/*,.pdf"
                  aria-label={t('family.verification.enrollment')}
                  onChange={(e) => setEnrollmentFile(e.target.files?.[0] || null)}
                  className="mb-3 block w-full text-sm text-gray-500 file:mr-4 file:rounded-lg file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-brand-600 hover:file:bg-brand-100"
                />
                {enrollmentError && <p className="mb-2 text-xs text-brand-600">{enrollmentError}</p>}
                <Button
                  size="sm"
                  onClick={handleEnrollmentUpload}
                  disabled={!enrollmentFile || uploading}
                >
                  {uploading ? t('common.saving') : t('family.verification.upload')}
                </Button>
              </Card>
            </div>
            )}
            </div>

            {/* ── Section: Community Verification ── */}
            <div>
              <h3 className="mb-3 text-base font-bold text-gray-900">{t('family.verification.communitySection')}</h3>

              {/* Ask for a verification */}
              {!isFullyVerified && (
                <Card className="mb-4">
                  <h4 className="mb-2 text-sm font-semibold text-gray-900">{t('family.verification.askForVerification')}</h4>
                  <p className="mb-3 text-xs text-gray-500">{t('family.verification.askForVerificationDesc')}</p>

                  {communityCode && communityCodeExpires && new Date(communityCodeExpires) > new Date() ? (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                      <p className="mb-3 text-xs leading-relaxed text-gray-600">
                        {t('family.verification.shareMessage')}
                      </p>
                      <div className="flex items-center justify-center rounded-lg bg-white p-3 border border-gray-200">
                        <span className="text-2xl font-mono font-bold tracking-widest text-brand-600">{communityCode}</span>
                      </div>
                      <p className="mt-2 text-center text-xs text-gray-500">
                        {t('family.verification.codeExpires', { time: new Date(communityCodeExpires).toLocaleString(i18n.language === 'fr' ? 'fr-FR' : 'en-US', { dateStyle: 'short', timeStyle: 'short' }) })}
                      </p>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => generateCommunityCode()}
                      disabled={communityCodeLoading}
                    >
                      {communityCodeLoading ? '...' : t('family.verification.generateCode')}
                    </Button>
                  )}
                </Card>
              )}

              {/* Approve a friend */}
              {familyVerification?.isFullyVerified && familyVerification?.isEjmFamily && (
                <Card>
                  <h4 className="mb-2 text-sm font-semibold text-gray-900">{t('family.verification.approveAFriend')}</h4>
                  <p className="mb-3 text-xs text-gray-500">{t('family.verification.approveAFriendDesc')}</p>

                  {approveSuccess ? (
                    <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-center">
                      <p className="text-sm font-medium text-green-800">{t('family.verification.approveSuccess')}</p>
                    </div>
                  ) : lookupResult ? (
                    <div>
                      <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
                        <p className="text-sm text-amber-900">
                          {t('family.verification.approveConfirmMessage', {
                            name: `${lookupResult.firstName} ${lookupResult.lastName.toUpperCase()}`,
                            family: lookupResult.familyName.toUpperCase(),
                          })}
                        </p>
                        <p className="mt-2 text-xs text-amber-700">
                          {t('family.verification.approveWarning')}
                        </p>
                      </div>

                      <div className="mb-4 space-y-3">
                        <Checkbox
                          checked={knowPerson}
                          onChange={(e) => setKnowPerson(e.target.checked)}
                          label={t('family.verification.checkboxKnowPerson')}
                        />
                        <Checkbox
                          checked={confirmEjm}
                          onChange={(e) => setConfirmEjm(e.target.checked)}
                          label={t('family.verification.checkboxConfirmEjm')}
                        />
                      </div>

                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          onClick={handleCommunityApprove}
                          disabled={!knowPerson || !confirmEjm || approving}
                        >
                          {approving ? '...' : t('family.verification.approve')}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => { clearLookup(); setApproveCode(''); setKnowPerson(false); setConfirmEjm(false); }}
                        >
                          {t('common.cancel')}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Input
                        placeholder={t('family.verification.enterCode')}
                        value={approveCode}
                        onChange={(e) => { setApproveCode(e.target.value.toUpperCase()); setApproveError(''); }}
                        className="flex-1 font-mono uppercase"
                      />
                      <Button
                        size="sm"
                        onClick={handleLookup}
                        disabled={!approveCode.trim() || lookupLoading}
                      >
                        {lookupLoading ? '...' : t('family.verification.lookUp')}
                      </Button>
                    </div>
                  )}
                  {approveError && <p className="mt-2 text-xs text-brand-600">{approveError}</p>}
                </Card>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
