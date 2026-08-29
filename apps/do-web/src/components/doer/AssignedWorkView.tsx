import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskDoc } from '@ejm/do-core';
import { Button, Card, Checkbox, InfoBanner, Spinner } from '@ejm/shared-ui';
import { useConsiderations } from '@/lib/considerations';
import { useAssignedContact } from '@/lib/useAssignedContact';

interface AssignedWorkViewProps {
  task: TaskDoc;
  onMarkDone: () => void;
  onCancel: () => void;
  busy: boolean;
}

/**
 * The doer's side of an assignment (plan §9.2 "My tasks") — the mirror of
 * the family's AssignedTaskView, same treatment (§9.1 last bullet applies
 * "the same" to this side):
 * - the FAMILY half of `doGetAssignedContact` (name, address, each
 *   parent's channels), fetched LIVE via the shared useAssignedContact
 *   hook — decision 16, nothing cached; §6.4's aftermath grace means the
 *   callable keeps serving for a few days after a cancellation, so the
 *   cancelled state still shows contact with the grace note, and
 *   `grace_elapsed` gets its own copy rather than an error;
 * - the §5 considerations as the pre-start checklist (surface 3 of 3),
 *   local ticks only;
 * - mark-done — the DOER half of §6.5: sets `doerMarkedDoneAt`, the task
 *   stays `assigned` and this view shows the awaiting-family state until
 *   the family confirms (or the 7-day sweep auto-completes);
 * - cancel (doer side), with the aftermath-grace note in the dialog copy.
 */
export function AssignedWorkView({ task, onMarkDone, onCancel, busy }: AssignedWorkViewProps) {
  const { t } = useTranslation();
  const considerations = useConsiderations(task.subCategory);
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const { contact, contactState, retry } = useAssignedContact(task.taskId);

  const cancelled = task.status === 'cancelled';
  const completed = task.status === 'completed';
  const markedDone = task.doerMarkedDoneAt !== null;

  return (
    <div>
      {completed && <InfoBanner className="mb-4">{t('doer.assigned.completedBanner')}</InfoBanner>}
      {cancelled && <InfoBanner className="mb-4">{t('doer.assigned.cancelledBanner')}</InfoBanner>}
      {!completed && !cancelled && markedDone && (
        <InfoBanner variant="warning" className="mb-4">
          {t('doer.assigned.awaitingFamilyBanner')}
        </InfoBanner>
      )}

      {task.agreedPrice !== null && (
        <Card className="mb-4">
          <p className="text-xs text-gray-500">
            {t('doer.assigned.agreedPrice')}:{' '}
            <span className="font-semibold text-gray-900">{task.agreedPrice} €</span>
          </p>
        </Card>
      )}

      <Card className="mb-4">
        <h3 className="mb-2 text-sm font-semibold text-gray-900">{t('doer.assigned.contactTitle')}</h3>
        {cancelled && contactState !== 'grace_elapsed' && (
          <p className="mb-2 text-xs text-gray-500">{t('doer.assigned.contactGraceNote')}</p>
        )}
        {contactState === 'loading' && (
          <div className="flex items-center gap-2 py-2 text-sm text-gray-500">
            <Spinner className="h-4 w-4" />
            {t('doer.assigned.contactLoading')}
          </div>
        )}
        {contactState === 'grace_elapsed' && (
          <p className="text-sm text-gray-500">{t('doer.assigned.contactGraceElapsed')}</p>
        )}
        {contactState === 'error' && (
          <div>
            <p className="mb-2 text-sm text-error-600">{t('doer.assigned.contactError')}</p>
            <Button size="sm" variant="outline" fullWidth={false} onClick={retry}>
              {t('doer.assigned.contactRetry')}
            </Button>
          </div>
        )}
        {contactState === 'ready' && contact && (
          <div className="space-y-2 text-sm text-gray-700">
            <p className="font-medium">{contact.family.familyName}</p>
            {contact.family.address && (
              <p>
                {t('doer.assigned.contactAddress')}: <span>{contact.family.address}</span>
              </p>
            )}
            {contact.family.parents.map((parent) => (
              <div key={`${parent.firstName}-${parent.email}`} className="space-y-1">
                <p className="font-medium">
                  {parent.firstName} {parent.lastName}
                </p>
                {parent.phone && (
                  <p>
                    {t('doer.assigned.contactPhone')}:{' '}
                    <a href={`tel:${parent.phone}`} className="text-brand-600">
                      {parent.phone}
                    </a>
                  </p>
                )}
                {parent.whatsapp && (
                  <p>
                    {t('doer.assigned.contactWhatsapp')}: <span>{parent.whatsapp}</span>
                  </p>
                )}
                {parent.email && (
                  <p>
                    {t('doer.assigned.contactEmail')}:{' '}
                    <a href={`mailto:${parent.email}`} className="text-brand-600">
                      {parent.email}
                    </a>
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {considerations.length > 0 && !completed && !cancelled && (
        <Card className="mb-4">
          <h3 className="mb-1 text-sm font-semibold text-gray-900">{t('doer.assigned.checklistTitle')}</h3>
          <p className="mb-3 text-xs text-gray-500">{t('doer.assigned.checklistHint')}</p>
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
          {!markedDone && (
            <Button onClick={onMarkDone} disabled={busy}>
              {t('doer.assigned.markDoneCta')}
            </Button>
          )}
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {t('doer.assigned.cancelCta')}
          </Button>
        </div>
      )}
    </div>
  );
}
