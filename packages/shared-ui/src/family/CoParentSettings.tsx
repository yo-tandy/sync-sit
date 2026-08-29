import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/Button.js';
import { Card } from '../components/Card.js';
import { Dialog } from '../components/Dialog.js';
import { Spinner } from '../components/Spinner.js';

export interface CoParentMember {
  uid: string;
  name: string;
}

interface CoParentSettingsProps {
  members: CoParentMember[];
  /** null while the first load is in flight. */
  loading: boolean;
  currentUid?: string;
  inviteLink: string | null;
  generating: boolean;
  error: string | null;
  copied: boolean;
  onGenerate: () => void;
  onCopy: () => void;
  onRemove: (member: CoParentMember) => Promise<void>;
  /** Cross-app explainer (study renders one; sit does not). */
  note?: ReactNode;
}

/**
 * Co-parent management, rendered INSIDE family settings in both apps
 * (issue #340: sit moved it there from its own page; study never had it).
 * Presentational by design -- shared-ui carries no firebase dependency, so
 * each app keeps a thin container that supplies the data and the actions.
 * The remove-confirm dialog lives here so the destructive affordance
 * cannot drift between the two apps.
 */
export function CoParentSettings({
  members,
  loading,
  currentUid,
  inviteLink,
  generating,
  error,
  copied,
  onGenerate,
  onCopy,
  onRemove,
  note,
}: CoParentSettingsProps) {
  const { t } = useTranslation();
  const [removeTarget, setRemoveTarget] = useState<CoParentMember | null>(null);
  const [removing, setRemoving] = useState(false);

  const confirmRemove = async () => {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      await onRemove(removeTarget);
      setRemoveTarget(null);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <section className="mb-6">
      <h3 className="mb-2 text-sm font-semibold text-gray-700">{t('menu.coParent')}</h3>
      <p className="mb-3 text-sm text-gray-500">{t('invite.desc')}</p>
      {note}

      {!inviteLink ? (
        <Card className="mb-4">
          <p className="mb-3 text-sm text-gray-700">{t('invite.linkDesc')}</p>
          {error && <p className="mb-3 text-sm text-brand-600" role="alert">{error}</p>}
          <Button onClick={onGenerate} disabled={generating}>
            {generating ? t('invite.generating') : t('invite.generateLink')}
          </Button>
        </Card>
      ) : (
        <Card className="mb-4">
          <p className="mb-1 text-xs font-medium text-gray-500">{t('invite.inviteLink')}</p>
          <div className="mb-2 rounded-lg bg-gray-50 px-3 py-2">
            <p className="break-all font-mono text-sm text-gray-900">{inviteLink}</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={onCopy} className="flex-1">
              {copied ? t('invite.copied') : t('invite.copyLink')}
            </Button>
            <Button size="sm" variant="outline" onClick={onGenerate} disabled={generating} className="flex-1">
              {generating ? '...' : t('invite.newLink')}
            </Button>
          </div>
          <p className="mt-2 text-xs text-gray-500">{t('invite.linkDesc')}</p>
        </Card>
      )}

      <h4 className="mb-2 text-sm font-semibold text-gray-700">{t('invite.familyMembers')}</h4>
      {loading ? (
        <div className="flex justify-center py-4">
          <Spinner className="h-5 w-5 text-gray-400" />
        </div>
      ) : (
        members.map((member) => (
          <Card key={member.uid} className="mb-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-900">{member.name}</p>
              {member.uid === currentUid ? (
                <span className="text-xs text-gray-500">{t('invite.you')}</span>
              ) : (
                <button
                  type="button"
                  className="text-xs text-brand-600 hover:underline"
                  onClick={() => setRemoveTarget(member)}
                >
                  {t('coParent.remove')}
                </button>
              )}
            </div>
          </Card>
        ))
      )}

      <Dialog open={!!removeTarget} onClose={() => setRemoveTarget(null)} ariaLabel={t('coParent.removeTitle')}>
        <h3 className="mb-2 text-lg font-semibold">{t('coParent.removeTitle')}</h3>
        <p className="mb-6 text-sm text-gray-600">
          {t('coParent.removeConfirm', { name: removeTarget?.name })}
        </p>
        <div className="flex gap-3">
          <Button variant="outline" size="sm" onClick={() => setRemoveTarget(null)}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" onClick={confirmRemove} disabled={removing}>
            {removing ? '...' : t('coParent.confirmRemove')}
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
