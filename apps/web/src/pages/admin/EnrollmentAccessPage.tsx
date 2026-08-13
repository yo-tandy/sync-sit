import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TopNav } from '@/components/ui/TopNav';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
// Direct import: the ui barrel transitively pulls the auth store's
// module-scope onAuthStateChanged — admin pages don't need that.
import { useToast } from '@ejm/shared-ui';
import { useAdminStore } from '@/stores/adminStore';

export function AdminEnrollmentAccessPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const {
    preapprovedEmails,
    preapprovedLoading,
    fetchPreapprovedEmails,
    addPreapprovedEmail,
    removePreapprovedEmail,
    exemptions,
    exemptionsLoading,
    fetchExemptions,
    addExemption,
    removeExemption,
  } = useAdminStore();

  const [newPreapprovedEmail, setNewPreapprovedEmail] = useState('');
  const [newExemptionEmail, setNewExemptionEmail] = useState('');
  const [newExemptionNote, setNewExemptionNote] = useState('');

  // Load pre-approved emails on mount
  useEffect(() => {
    fetchPreapprovedEmails();
  }, [fetchPreapprovedEmails]);

  // Load enrollment exemptions on mount
  useEffect(() => {
    fetchExemptions();
  }, [fetchExemptions]);

  const handleAddPreapproved = async () => {
    if (!newPreapprovedEmail) return;
    try {
      await addPreapprovedEmail(newPreapprovedEmail);
      setNewPreapprovedEmail('');
      await fetchPreapprovedEmails();
      toast(t('admin.emailAdded'));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to add email';
      alert(message);
    }
  };

  const handleRemovePreapproved = async (email: string) => {
    try {
      await removePreapprovedEmail(email);
      await fetchPreapprovedEmails();
      toast(t('admin.emailRemoved'));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to remove email';
      alert(message);
    }
  };

  const handleAddExemption = async () => {
    if (!newExemptionEmail) return;
    try {
      await addExemption(newExemptionEmail, newExemptionNote || undefined);
      setNewExemptionEmail('');
      setNewExemptionNote('');
      await fetchExemptions();
      toast(t('admin.exemptions.added'));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to add exemption';
      alert(message);
    }
  };

  const handleRemoveExemption = async (email: string) => {
    try {
      await removeExemption(email);
      await fetchExemptions();
      toast(t('admin.exemptions.removed'));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to remove exemption';
      alert(message);
    }
  };

  return (
    <div>
      <TopNav title={t('admin.enrollmentAccess.title')} backTo="/admin" />

      <div className="px-5 pb-8">
        {/* Pre-approved Emails */}
        <Card className="mb-6">
          <h3 className="mb-1 text-sm font-semibold text-gray-900">{t('admin.preapprovedEmails')}</h3>
          <p className="mb-4 text-xs text-gray-500">{t('admin.preapprovedDesc')}</p>
          <div className="mb-3 flex gap-2">
            <Input
              placeholder={t('common.email')}
              type="email"
              value={newPreapprovedEmail}
              onChange={(e) => setNewPreapprovedEmail(e.target.value)}
              className="flex-1"
            />
            <Button variant="primary" size="sm" onClick={handleAddPreapproved} disabled={!newPreapprovedEmail}>
              {t('admin.addEmail')}
            </Button>
          </div>
          {preapprovedLoading ? (
            <div className="flex justify-center py-4">
              <Spinner className="h-5 w-5 text-brand-600" />
            </div>
          ) : preapprovedEmails.length === 0 ? (
            <p className="py-3 text-center text-xs text-gray-500">{t('admin.noPreapprovedEmails')}</p>
          ) : (
            <div className="space-y-2">
              {preapprovedEmails.map((item) => (
                <div key={item.email} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-700">{item.email}</span>
                    <Badge variant={item.used ? 'gray' : 'green'}>
                      {item.used ? t('admin.preapprovedUsed') : t('admin.preapprovedPending')}
                    </Badge>
                  </div>
                  {!item.used && (
                    <Button variant="outline" size="sm" onClick={() => handleRemovePreapproved(item.email)}>
                      {t('common.remove')}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Enrollment exemptions */}
        <Card className="mb-6">
          <h3 className="mb-1 text-sm font-semibold text-gray-900">{t('admin.exemptions.title')}</h3>
          <p className="mb-4 text-xs text-gray-500">{t('admin.exemptions.desc')}</p>
          <div className="mb-3 flex gap-2">
            <Input
              placeholder={t('admin.exemptions.email')}
              type="email"
              value={newExemptionEmail}
              onChange={(e) => setNewExemptionEmail(e.target.value)}
              className="flex-1"
            />
            <Input
              placeholder={t('admin.exemptions.note')}
              value={newExemptionNote}
              onChange={(e) => setNewExemptionNote(e.target.value)}
              className="flex-1"
            />
            <Button variant="primary" size="sm" onClick={handleAddExemption} disabled={!newExemptionEmail}>
              {t('admin.exemptions.add')}
            </Button>
          </div>
          {exemptionsLoading ? (
            <div className="flex justify-center py-4">
              <Spinner className="h-5 w-5 text-brand-600" />
            </div>
          ) : exemptions.length === 0 ? (
            <p className="py-3 text-center text-xs text-gray-500">{t('admin.exemptions.empty')}</p>
          ) : (
            <div className="space-y-2">
              {exemptions.map((item) => (
                <div key={item.email} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
                  <div className="min-w-0">
                    <span className="text-sm text-gray-700">{item.email}</span>
                    {item.note && <p className="truncate text-xs text-gray-500">{item.note}</p>}
                  </div>
                  <Button variant="outline" size="sm" onClick={() => handleRemoveExemption(item.email)}>
                    {t('admin.exemptions.remove')}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
