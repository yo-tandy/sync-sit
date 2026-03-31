import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { useVerificationStore } from '@/stores/verificationStore';
import { TopNav } from '@/components/ui/TopNav';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import type { ParentUser } from '@ejm/shared';

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
  const locale = i18n.language === 'fr' ? 'fr-FR' : 'en-US';
  const { userDoc } = useAuthStore();
  const familyId = (userDoc as ParentUser | null)?.familyId;

  const {
    familyVerification,
    documents,
    loading,
    uploading,
    fetchStatus,
    submitDocument,
  } = useVerificationStore();

  const [identityFile, setIdentityFile] = useState<File | null>(null);
  const [identityError, setIdentityError] = useState('');
  const identityInputRef = useRef<HTMLInputElement>(null);

  // Enrollment form state
  const [showEnrollmentForm, setShowEnrollmentForm] = useState(false);
  const [enrollmentFile, setEnrollmentFile] = useState<File | null>(null);
  const [childName, setChildName] = useState('');
  const [childDob, setChildDob] = useState('');
  const [schoolYear, setSchoolYear] = useState('');
  const [classLevel, setClassLevel] = useState('');
  const [signerName, setSignerName] = useState('');
  const [enrollmentError, setEnrollmentError] = useState('');
  const enrollmentInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchStatus();
  }, []);

  const handleUpload = async (file: File, type: 'identity' | 'ejm_enrollment', metadata?: Record<string, string>) => {
    if (!familyId) return;
    const path = `verification-documents/${familyId}/${Date.now()}-${file.name}`;
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, file);
    const fileUrl = await getDownloadURL(storageRef);
    await submitDocument({ type, fileUrl, fileName: file.name, ...metadata });
    await fetchStatus();
  };

  const handleIdentityUpload = async () => {
    if (!identityFile) return;
    if (identityFile.size > MAX_FILE_SIZE) {
      setIdentityError(t('verification.fileTooLarge'));
      return;
    }
    setIdentityError('');
    try {
      await handleUpload(identityFile, 'identity');
      setIdentityFile(null);
      if (identityInputRef.current) identityInputRef.current.value = '';
    } catch {
      setIdentityError(t('verification.uploadError'));
    }
  };

  const handleEnrollmentSubmit = async () => {
    if (!enrollmentFile || !childName.trim()) {
      setEnrollmentError(t('verification.fillRequired'));
      return;
    }
    if (enrollmentFile.size > MAX_FILE_SIZE) {
      setEnrollmentError(t('verification.fileTooLarge'));
      return;
    }
    setEnrollmentError('');
    try {
      await handleUpload(enrollmentFile, 'ejm_enrollment', {
        childName: childName.trim(),
        childDob,
        schoolYear: schoolYear.trim(),
        classLevel: classLevel.trim(),
        signerName: signerName.trim(),
      });
      // Reset form
      setEnrollmentFile(null);
      setChildName('');
      setChildDob('');
      setSchoolYear('');
      setClassLevel('');
      setSignerName('');
      setShowEnrollmentForm(false);
      if (enrollmentInputRef.current) enrollmentInputRef.current.value = '';
    } catch {
      setEnrollmentError(t('verification.uploadError'));
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
      : 'border-red-300';

  const bgColor = isFullyVerified
    ? 'bg-green-50'
    : identityStatus === 'pending' || enrollmentStatus === 'pending'
      ? 'bg-amber-50'
      : 'bg-red-50';

  return (
    <div>
      <TopNav title={t('verification.title')} backTo="/family" />

      <div className="px-5 pb-8">
        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner className="h-8 w-8 text-red-600" />
          </div>
        ) : (
          <>
            {/* Fully verified banner */}
            {isFullyVerified && (
              <div className="mb-4 rounded-lg border border-green-300 bg-green-50 p-4 text-center">
                <p className="text-sm font-semibold text-green-800">{t('verification.fullyVerified')}</p>
                <p className="mt-1 text-xs text-green-600">{t('verification.fullyVerifiedDesc')}</p>
              </div>
            )}

            {/* Status overview */}
            <Card className={`mb-6 border ${borderColor} ${bgColor}`}>
              <h3 className="mb-3 text-sm font-semibold text-gray-900">{t('verification.statusOverview')}</h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">{t('verification.identityVerification')}</span>
                  <Badge variant={statusBadgeVariant(identityStatus)}>
                    {t(`verification.status_${identityStatus}`)}
                  </Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">{t('verification.enrollmentVerification')}</span>
                  <Badge variant={statusBadgeVariant(enrollmentStatus)}>
                    {t(`verification.status_${enrollmentStatus}`)}
                  </Badge>
                </div>
              </div>
            </Card>

            {/* Identity section */}
            <div className="mb-6">
              <h3 className="mb-3 text-sm font-semibold text-gray-900">{t('verification.identityVerification')}</h3>

              {identityStatus === 'approved' ? (
                <Card>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-700">{identityDocs[0]?.fileName}</span>
                    <Badge variant="green">{t('verification.status_approved')}</Badge>
                  </div>
                </Card>
              ) : identityStatus === 'pending' ? (
                <Card className="border-amber-200 bg-amber-50">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-amber-800">{t('verification.pendingReview')}</p>
                      <p className="text-xs text-amber-600">{identityDocs[0]?.fileName}</p>
                    </div>
                    <Badge variant="amber">{t('verification.status_pending')}</Badge>
                  </div>
                </Card>
              ) : (
                <Card>
                  {identityStatus === 'rejected' && identityDocs[0]?.rejectionReason && (
                    <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3">
                      <p className="text-xs font-medium text-red-800">{t('verification.rejectedReason')}</p>
                      <p className="text-xs text-red-600">{identityDocs[0].rejectionReason}</p>
                    </div>
                  )}
                  <p className="mb-3 text-xs text-gray-500">{t('verification.identityDesc')}</p>
                  <input
                    ref={identityInputRef}
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) => setIdentityFile(e.target.files?.[0] || null)}
                    className="mb-3 block w-full text-sm text-gray-500 file:mr-4 file:rounded-lg file:border-0 file:bg-red-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-red-600 hover:file:bg-red-100"
                  />
                  {identityError && <p className="mb-2 text-xs text-red-600">{identityError}</p>}
                  <Button
                    size="sm"
                    onClick={handleIdentityUpload}
                    disabled={!identityFile || uploading}
                  >
                    {uploading ? t('common.saving') : t('verification.upload')}
                  </Button>
                </Card>
              )}
            </div>

            {/* Enrollment section */}
            <div className="mb-6">
              <h3 className="mb-3 text-sm font-semibold text-gray-900">{t('verification.enrollmentVerification')}</h3>

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
                            <p className="mt-1 text-xs text-red-600">{doc.rejectionReason}</p>
                          )}
                        </div>
                        <Badge variant={statusBadgeVariant(doc.status)}>
                          {t(`verification.status_${doc.status}`)}
                        </Badge>
                      </div>
                    </Card>
                  ))}
                </div>
              )}

              {/* Add enrollment document button/form */}
              {!showEnrollmentForm ? (
                <Button size="sm" variant="outline" onClick={() => setShowEnrollmentForm(true)}>
                  {t('verification.addEnrollmentDoc')}
                </Button>
              ) : (
                <Card>
                  <h4 className="mb-3 text-sm font-semibold text-gray-900">{t('verification.addEnrollmentDoc')}</h4>
                  <div className="space-y-3">
                    <input
                      ref={enrollmentInputRef}
                      type="file"
                      accept="image/*,.pdf"
                      onChange={(e) => setEnrollmentFile(e.target.files?.[0] || null)}
                      className="block w-full text-sm text-gray-500 file:mr-4 file:rounded-lg file:border-0 file:bg-red-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-red-600 hover:file:bg-red-100"
                    />
                    <Input
                      label={t('verification.childFullName')}
                      value={childName}
                      onChange={(e) => setChildName(e.target.value)}
                      required
                    />
                    <Input
                      label={t('verification.childDob')}
                      type="date"
                      value={childDob}
                      onChange={(e) => setChildDob(e.target.value)}
                    />
                    <Input
                      label={t('verification.schoolYear')}
                      placeholder="2025-2026"
                      value={schoolYear}
                      onChange={(e) => setSchoolYear(e.target.value)}
                    />
                    <Input
                      label={t('verification.classLevelLabel')}
                      value={classLevel}
                      onChange={(e) => setClassLevel(e.target.value)}
                    />
                    <Input
                      label={t('verification.signerName')}
                      value={signerName}
                      onChange={(e) => setSignerName(e.target.value)}
                    />
                    {enrollmentError && <p className="text-xs text-red-600">{enrollmentError}</p>}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={handleEnrollmentSubmit}
                        disabled={uploading}
                      >
                        {uploading ? t('common.saving') : t('verification.submit')}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setShowEnrollmentForm(false);
                          setEnrollmentError('');
                        }}
                      >
                        {t('common.cancel')}
                      </Button>
                    </div>
                  </div>
                </Card>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
