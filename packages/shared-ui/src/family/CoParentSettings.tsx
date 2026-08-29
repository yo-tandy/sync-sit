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
  /** True while the first member load is in flight. */
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
 * Translate a removeCoParent rejection. The callable's own messages are
 * English-only server strings ('You cannot remove yourself', and literally
 * `INTERNAL` on an unexpected fault), so echoing `err.message` put untranslated
 * English in front of French users (PR #343 round 4). Mapping the Firebase
 * error CODE keeps the information at the granularity the code carries and
 * leaves the wording to each app's catalogue.
 */
function removeErrorKey(err: unknown): string {
  const code = (err as { code?: string } | null)?.code;
  switch (code) {
    case 'functions/permission-denied':
    case 'permission-denied':
      return 'coParent.removeErrorNotAllowed';
    case 'functions/not-found':
    case 'not-found':
      return 'coParent.removeErrorNotFound';
    case 'functions/failed-precondition':
    case 'failed-precondition':
      return 'coParent.removeErrorState';
    default:
      return 'common.error';
  }
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
  const [removeError, setRemoveError] = useState<string | null>(null);

  const openRemove = (member: CoParentMember) => {
    setRemoveError(null);
    setRemoveTarget(member);
  };

  const closeRemove = () => {
    setRemoveError(null);
    setRemoveTarget(null);
  };

  // removeCoParent has reachable server-side rejections ('You cannot remove
  // yourself'; permission-denied for a caller whose family pointer is
  // stale), so the failure has to be visible: the dialog stays open and
  // says why. This lives here, not in the containers, for the same reason
  // the confirm does -- the destructive affordance must not drift.
  const confirmRemove = async () => {
    if (!removeTarget) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      await onRemove(removeTarget);
      setRemoveTarget(null);
    } catch (err: unknown) {
      setRemoveError(t(removeErrorKey(err)));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <section className="mb-6">
      <h3 className="mb-2 text-sm font-semibold text-gray-700">{t('menu.coParent')}</h3>
      <p className="mb-3 text-sm text-gray-500">{t('invite.desc')}</p>
      {note}

      {/* The generate error renders in BOTH branches: `onGenerate` is also the
          "New link" action once a link exists, and a failed regeneration was
          silent while this lived only in the no-link branch (PR #343 round 3
          -- the same failure class as the removal path in round 1). */}
      {error && (
        <p className="mb-3 text-sm text-brand-600" role="alert">
          {error}
        </p>
      )}

      {!inviteLink ? (
        <Card className="mb-4">
          <p className="mb-3 text-sm text-gray-700">{t('invite.linkDesc')}</p>
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
                  onClick={() => openRemove(member)}
                >
                  {t('coParent.remove')}
                </button>
              )}
            </div>
          </Card>
        ))
      )}

      <Dialog open={!!removeTarget} onClose={closeRemove} ariaLabel={t('coParent.removeTitle')}>
        <h3 className="mb-2 text-lg font-semibold">{t('coParent.removeTitle')}</h3>
        <p className="mb-6 text-sm text-gray-600">
          {t('coParent.removeConfirm', { name: removeTarget?.name })}
        </p>
        {removeError && (
          <p className="mb-4 text-sm text-brand-600" role="alert">
            {removeError}
          </p>
        )}
        <div className="flex gap-3">
          <Button variant="outline" size="sm" onClick={closeRemove}>
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
