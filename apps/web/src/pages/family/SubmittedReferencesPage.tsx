import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSubmittedReferences } from '@/hooks/useSubmittedReferences';
import { Button, Card, Badge, TopNav, Spinner } from '@/components/ui';
import { ReferenceDialog } from '@/components/references/ReferenceDialog';
import type { ReferenceDoc } from '@ejm/shared';

function ReferenceCard({ reference, onEdit }: { reference: ReferenceDoc; onEdit: () => void }) {
  const { t, i18n } = useTranslation();
  const statusVariant = reference.status === 'approved' ? 'green' : reference.status === 'pending' ? 'amber' : 'gray';
  const statusLabel = reference.status === 'approved'
    ? t('submittedReferences.statusApproved')
    : reference.status === 'pending'
      ? t('submittedReferences.statusPending')
      : t('submittedReferences.statusRemoved');

  return (
    <Card className="mb-3">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-gray-500">{t('submittedReferences.referenceForBabysitter')}</p>
          {reference.referenceText && (
            <p className="mt-1 text-sm text-gray-700">"{reference.referenceText}"</p>
          )}
          {reference.createdAt && (
            <p className="mt-1 text-xs text-gray-400">
              {reference.createdAt.toDate?.()
                ? reference.createdAt.toDate().toLocaleDateString(i18n.language === 'fr' ? 'fr-FR' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                : ''}
            </p>
          )}
        </div>
        <Badge variant={statusVariant}>{statusLabel}</Badge>
      </div>
      {reference.status !== 'removed' && (
        <Button size="sm" variant="outline" onClick={onEdit} className="mt-3">
          {t('references.editMyReference')}
        </Button>
      )}
    </Card>
  );
}

export function SubmittedReferencesPage() {
  const { t } = useTranslation();
  const { references, loading } = useSubmittedReferences();
  const [editTarget, setEditTarget] = useState<ReferenceDoc | null>(null);

  if (loading) {
    return (
      <div>
        <TopNav title={t('submittedReferences.title')} backTo="/family" />
        <div className="flex justify-center py-20">
          <Spinner className="h-8 w-8 text-red-600" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <TopNav title={t('submittedReferences.title')} backTo="/family" />
      <div className="px-5 pt-4 pb-8">
        <p className="mb-4 text-sm text-gray-500">
          {t('submittedReferences.desc')}
        </p>

        {references.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 text-3xl">⭐</div>
            <h3 className="mb-2 text-lg font-semibold">{t('submittedReferences.noReferences')}</h3>
            <p className="max-w-[240px] text-sm text-gray-500">
              {t('submittedReferences.noReferencesDesc')}
            </p>
          </div>
        ) : (
          references.map((ref) => (
            <ReferenceCard key={ref.referenceId} reference={ref} onEdit={() => setEditTarget(ref)} />
          ))
        )}
      </div>

      {editTarget && (
        <ReferenceDialog
          babysitterUserId={editTarget.babysitterUserId}
          babysitterName=""
          appointmentId={editTarget.appointmentId || ''}
          existingReference={editTarget}
          onClose={() => setEditTarget(null)}
        />
      )}
    </div>
  );
}
