import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskDoc } from '@ejm/do-core';
import { Button, Card, Checkbox, InfoBanner, Spinner } from '@ejm/shared-ui';
import { useConsiderations } from '@/lib/considerations';
import { useAssignedContact } from '@/lib/useAssignedContact';

export type { AssignedContact } from '@/lib/useAssignedContact';

interface AssignedTaskViewProps {
  task: TaskDoc;
  doerFirstName: string | null;
  onMarkDone: () => void;
  onCancel: () => void;
  busy: boolean;
  /** The task's description/photos card, slotted between the contact card
   * and the checklist: the details stay reachable past acceptance — the
   * coordination phase is when they matter most (PR #331 round 2). */
  details?: React.ReactNode;
  /**
   * Open the §9.1 endorsement form. Present only while endorsing is still
   * possible: the page passes null once the family has endorsed this
   * student (or once the callable has told us they already had).
   */
  onEndorse?: (() => void) | null;
}

/**
 * The family's assigned-task view (plan §9.1 last bullet):
 * - contact via `doGetAssignedContact`, fetched LIVE on each view with a
 *   loading state (decision 16 — nothing cached in Firestore) through the
 *   shared useAssignedContact hook. §6.4: the callable keeps serving for
 *   DO_CONTACT_GRACE_DAYS after a cancellation, so this view calls it for
 *   cancelled tasks too and maps `grace_elapsed` to its own copy rather
 *   than treating it as an error;
 * - a task cancelled while still OPEN never had a doer (`assignedOfferId`
 *   stays null — the hook's never-assigned gate, PR #331 round 1), so it
 *   gets the plain cancelled summary: banner only, no assignment/contact
 *   cards, no grace note;
 * - the §5 considerations as a checklist (surface 3 of 3) — local ticks
 *   only, a conversation aid, nothing persisted;
 * - mark-done and cancel (the confirm dialogs live in the page);
 * - once the task is COMPLETED, the standing endorsement CTA (§9.1, PR11).
 *   The prompt right after completion is the page's — this is the way back
 *   to it for a family that dismissed it, so the six-month completed-task
 *   retention (decision 19) is the real deadline rather than one dialog.
 */
export function AssignedTaskView({ task, doerFirstName, onMarkDone, onCancel, busy, details, onEndorse }: AssignedTaskViewProps) {
  const { t } = useTranslation();
  const considerations = useConsiderations(task.subCategory);
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const { contact, contactState, hasAssignment, retry } = useAssignedContact(task);

  const cancelled = task.status === 'cancelled';
  const completed = task.status === 'completed';

  return (
    <div>
      {completed && <InfoBanner className="mb-4">{t('family.assigned.completedBanner')}</InfoBanner>}
      {cancelled && <InfoBanner className="mb-4">{t('family.assigned.cancelledBanner')}</InfoBanner>}
      {!completed && !cancelled && task.doerMarkedDoneAt !== null && (
        <InfoBanner variant="warning" className="mb-4">
          {t('family.assigned.doneBanner')}
        </InfoBanner>
      )}

      {hasAssignment && (
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
      )}

      {hasAssignment && (
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
              onClick={retry}
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
      )}

      {details}

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

      {completed && hasAssignment && onEndorse && (
        <Card className="mb-4">
          <h3 className="mb-1 text-sm font-semibold text-gray-900">
            {t('family.assigned.endorseTitle', { name: doerFirstName ?? '' })}
          </h3>
          <p className="mb-3 text-xs text-gray-500">{t('family.assigned.endorseHint')}</p>
          <Button size="sm" variant="outline" fullWidth={false} onClick={onEndorse}>
            {t('family.assigned.endorseCta')}
          </Button>
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
