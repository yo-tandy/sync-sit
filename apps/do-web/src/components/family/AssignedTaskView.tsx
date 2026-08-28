import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import type { TaskDoc } from '@ejm/do-core';
import { Button, Card, Checkbox, InfoBanner, Spinner } from '@ejm/shared-ui';
import { functions } from '@/config/firebase';
import { useConsiderations } from '@/lib/considerations';

export interface AssignedContact {
  taskId: string;
  family: {
    familyName: string;
    address: string;
    parents: { firstName: string; lastName: string; email: string; phone?: string; whatsapp?: string }[];
  };
  doer: {
    firstName: string;
    lastName: string;
    contactEmail?: string | null;
    contactPhone?: string | null;
    whatsapp?: string | null;
  };
}

interface AssignedTaskViewProps {
  task: TaskDoc;
  doerFirstName: string | null;
  onMarkDone: () => void;
  onCancel: () => void;
  busy: boolean;
}

/**
 * The family's assigned-task view (plan §9.1 last bullet):
 * - contact via `doGetAssignedContact`, fetched LIVE on each view with a
 *   loading state (decision 16 — nothing cached in Firestore). §6.4: the
 *   callable keeps serving for DO_CONTACT_GRACE_DAYS after a cancellation,
 *   so this view calls it for cancelled tasks too and maps `grace_elapsed`
 *   to its own copy rather than treating it as an error;
 * - the §5 considerations as a checklist (surface 3 of 3) — local ticks
 *   only, a conversation aid, nothing persisted;
 * - mark-done and cancel (the confirm dialogs live in the page).
 */
export function AssignedTaskView({ task, doerFirstName, onMarkDone, onCancel, busy }: AssignedTaskViewProps) {
  const { t } = useTranslation();
  const considerations = useConsiderations(task.subCategory);
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [contact, setContact] = useState<AssignedContact | null>(null);
  const [contactState, setContactState] = useState<'loading' | 'ready' | 'grace_elapsed' | 'error'>('loading');
  const [retryTick, setRetryTick] = useState(0);

  const cancelled = task.status === 'cancelled';
  const completed = task.status === 'completed';

  useEffect(() => {
    let stale = false;
    // NOTE: contactState is set back to 'loading' by whoever schedules a
    // refetch (initial state, or the Retry handler) — not synchronously
    // here (react-hooks/set-state-in-effect).
    const getContact = httpsCallable<{ taskId: string }, AssignedContact>(
      functions,
      'doGetAssignedContact',
    );
    getContact({ taskId: task.taskId })
      .then((res) => {
        if (stale) return;
        setContact(res.data);
        setContactState('ready');
      })
      .catch((err: unknown) => {
        if (stale) return;
        const reason = (err as { details?: { reason?: string } } | null)?.details?.reason;
        setContactState(reason === 'grace_elapsed' ? 'grace_elapsed' : 'error');
      });
    return () => {
      stale = true;
    };
  }, [task.taskId, retryTick]);

  return (
    <div>
      {completed && <InfoBanner className="mb-4">{t('family.assigned.completedBanner')}</InfoBanner>}
      {cancelled && <InfoBanner className="mb-4">{t('family.assigned.cancelledBanner')}</InfoBanner>}
      {!completed && !cancelled && task.doerMarkedDoneAt !== null && (
        <InfoBanner variant="warning" className="mb-4">
          {t('family.assigned.doneBanner')}
        </InfoBanner>
      )}

      <Card className="mb-4">
        {doerFirstName && (
          <p className="mb-1 text-sm font-semibold text-gray-900">
            {t('family.assigned.assignedTo', { name: doerFirstName })}
          </p>
        )}
        {task.agreedPrice !== null && (
          <p className="text-xs text-gray-500">
            {t('family.assigned.agreedPrice')}: <span className="font-semibold text-gray-900">{task.agreedPrice} €</span>
          </p>
        )}
      </Card>

      <Card className="mb-4">
        <h3 className="mb-2 text-sm font-semibold text-gray-900">{t('family.assigned.contactTitle')}</h3>
        {cancelled && contactState !== 'grace_elapsed' && (
          <p className="mb-2 text-xs text-gray-500">{t('family.assigned.contactGraceNote')}</p>
        )}
        {contactState === 'loading' && (
          <div className="flex items-center gap-2 py-2 text-sm text-gray-500">
            <Spinner className="h-4 w-4" />
            {t('family.assigned.contactLoading')}
          </div>
        )}
        {contactState === 'grace_elapsed' && (
          <p className="text-sm text-gray-500">{t('family.assigned.contactGraceElapsed')}</p>
        )}
        {contactState === 'error' && (
          <div>
            <p className="mb-2 text-sm text-error-600">{t('family.assigned.contactError')}</p>
            <Button
              size="sm"
              variant="outline"
              fullWidth={false}
              onClick={() => {
                setContactState('loading');
                setRetryTick((n) => n + 1);
              }}
            >
              {t('family.assigned.contactRetry')}
            </Button>
          </div>
        )}
        {contactState === 'ready' && contact && (
          <div className="space-y-1 text-sm text-gray-700">
            <p className="font-medium">
              {contact.doer.firstName} {contact.doer.lastName}
            </p>
            {contact.doer.contactPhone && (
              <p>
                {t('family.assigned.contactPhone')}:{' '}
                <a href={`tel:${contact.doer.contactPhone}`} className="text-brand-600">
                  {contact.doer.contactPhone}
                </a>
              </p>
            )}
            {contact.doer.whatsapp && (
              <p>
                {t('family.assigned.contactWhatsapp')}: <span>{contact.doer.whatsapp}</span>
              </p>
            )}
            {contact.doer.contactEmail && (
              <p>
                {t('family.assigned.contactEmail')}:{' '}
                <a href={`mailto:${contact.doer.contactEmail}`} className="text-brand-600">
                  {contact.doer.contactEmail}
                </a>
              </p>
            )}
          </div>
        )}
      </Card>

      {considerations.length > 0 && !completed && !cancelled && (
        <Card className="mb-4">
          <h3 className="mb-1 text-sm font-semibold text-gray-900">{t('family.assigned.checklistTitle')}</h3>
          <p className="mb-3 text-xs text-gray-500">{t('family.assigned.checklistHint')}</p>
          <div className="space-y-2.5">
            {considerations.map((line, i) => (
              <Checkbox
                key={line}
                checked={checked[i] ?? false}
                onChange={(e) => setChecked((c) => ({ ...c, [i]: e.target.checked }))}
                label={line}
              />
            ))}
          </div>
        </Card>
      )}

      {task.status === 'assigned' && (
        <div className="flex flex-col gap-2">
          <Button onClick={onMarkDone} disabled={busy}>
            {t('family.assigned.markDoneCta')}
          </Button>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {t('family.assigned.cancelCta')}
          </Button>
        </div>
      )}
    </div>
  );
}
