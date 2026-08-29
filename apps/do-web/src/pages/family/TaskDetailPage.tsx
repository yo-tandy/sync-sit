import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { collection, doc, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getParentProfile } from '@ejm/shared-core';
import type { OfferDoc, TaskDoc } from '@ejm/do-core';
import { Badge, Button, Card, Dialog, EmptyState, Spinner, TopNav, UsersIcon, useToast } from '@ejm/shared-ui';
import { db, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { formatTimingSummary } from '@/lib/taskDisplay';
import { OfferCard } from '@/components/family/OfferCard';
import { AssignedTaskView } from '@/components/family/AssignedTaskView';
import { TaskPhotos } from '@/components/family/TaskPhotos';
import { EndorseDoerDialog } from '@/components/family/EndorseDoerDialog';

/**
 * The family's task detail (plan §9.1): for an OPEN task, the offer list —
 * the heart of the product — with accept/decline per offer; for an
 * assigned/completed/cancelled task, the AssignedTaskView (contact via
 * doGetAssignedContact, considerations checklist, mark-done, cancel).
 *
 * Offer list query shape: family-readable statuses only
 * (§7.2's ALLOW-LIST — pending/accepted/declined; pending_guardian and
 * withdrawn/expired are invisible by design), constrained on familyId AND
 * taskId, served by the four-field (familyId, taskId, status, createdAt)
 * composite from §7.3.
 *
 * The accept dialog carries the §11.3 helper disclosure (when a helper is
 * declared) and the decision-15 liability line — §11.5: the acceptance
 * dialog repeats it "at the moment money and access are actually being
 * committed".
 *
 * COMPLETION PROMPTS FOR AN ENDORSEMENT (§9.1, PR11). The family's mark-done
 * is what MAKES the task completed, so it is the one moment we know both
 * that the work is finished and that the family is right here — the prompt
 * opens on that callable's success. It is a prompt, not a gate: dismissing
 * it costs nothing, and AssignedTaskView keeps a standing CTA on the
 * completed task so the six-month retention window (decision 19), not one
 * dialog, is the deadline.
 */
export function TaskDetailPage() {
  const { t } = useTranslation();
  const { taskId } = useParams<{ taskId: string }>();
  const toast = useToast();
  const { userDoc } = useAuthStore();
  const familyId = getParentProfile(userDoc)?.familyId ?? null;

  const [task, setTask] = useState<TaskDoc | null | 'missing'>(null);
  const [taskError, setTaskError] = useState(false);
  const [offers, setOffers] = useState<OfferDoc[] | null>(null);
  // A FAILED offers read must never render as the reassuring empty state
  // ("No offers yet" would be an affirmative false statement — PR #331
  // round 2); it gets its own error + retry. The tick re-subscribes.
  const [offersError, setOffersError] = useState(false);
  const [offersTick, setOffersTick] = useState(0);

  const [acceptTarget, setAcceptTarget] = useState<OfferDoc | null>(null);
  const [declineTarget, setDeclineTarget] = useState<OfferDoc | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [markDoneOpen, setMarkDoneOpen] = useState(false);
  const [endorseOpen, setEndorseOpen] = useState(false);
  // Set once this family has endorsed this student — on success, and also on
  // `already-exists`, which means an earlier submission (possibly the
  // co-parent's) already stands. Hides the CTA without spending a
  // `references` read on every completed task the family opens.
  const [endorsed, setEndorsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!taskId) return;
    const unsub = onSnapshot(
      doc(db, 'doTasks', taskId),
      (snap) => {
        setTask(snap.exists() ? ({ ...(snap.data() as TaskDoc), taskId: snap.id }) : 'missing');
        setTaskError(false);
      },
      () => setTaskError(true),
    );
    return unsub;
  }, [taskId]);

  useEffect(() => {
    if (!taskId || !familyId) return;
    const unsub = onSnapshot(
      query(
        collection(db, 'taskOffers'),
        where('familyId', '==', familyId),
        where('taskId', '==', taskId),
        where('status', 'in', ['pending', 'accepted', 'declined']),
        orderBy('createdAt'),
      ),
      (snap) => {
        setOffers(snap.docs.map((d) => ({ ...(d.data() as OfferDoc), offerId: d.id })));
        setOffersError(false);
      },
      () => setOffersError(true),
    );
    return unsub;
  }, [taskId, familyId, offersTick]);

  const runAction = async (
    callable: string,
    payload: Record<string, unknown>,
    errorKey: string,
    onDone?: () => void,
  ) => {
    setBusy(true);
    setActionError(null);
    try {
      await httpsCallable(functions, callable)(payload);
      onDone?.();
    } catch (err: unknown) {
      const reason = (err as { details?: { reason?: string } } | null)?.details?.reason;
      // doAcceptOffer's FULL machine-readable reason set (acceptOffer.ts):
      // task_not_open / task_expired / not_pending / doer_unavailable —
      // each terminal refusal gets its own copy so none reads as a
      // retryable transient (PR #331 round 2).
      if (callable === 'doAcceptOffer' && reason === 'task_not_open') {
        setActionError(t('family.taskDetail.acceptTaskNotOpen'));
      } else if (callable === 'doAcceptOffer' && reason === 'task_expired') {
        setActionError(t('family.taskDetail.acceptTaskExpired'));
      } else if (callable === 'doAcceptOffer' && reason === 'not_pending') {
        setActionError(t('family.taskDetail.acceptOfferGone'));
      } else if (callable === 'doAcceptOffer' && reason === 'doer_unavailable') {
        setActionError(t('family.taskDetail.acceptDoerUnavailable'));
      } else {
        setActionError(t(errorKey));
      }
    } finally {
      setBusy(false);
    }
  };

  if (taskError) {
    return (
      <div>
        <TopNav title={t('family.taskDetail.title')} backTo="/family" />
        <p className="px-6 py-10 text-center text-sm text-gray-500">{t('family.taskDetail.loadError')}</p>
      </div>
    );
  }
  if (task === 'missing') {
    return (
      <div>
        <TopNav title={t('family.taskDetail.title')} backTo="/family" />
        <p className="px-6 py-10 text-center text-sm text-gray-500">{t('family.taskDetail.notFound')}</p>
      </div>
    );
  }
  if (task === null) {
    return (
      <div>
        <TopNav title={t('family.taskDetail.title')} backTo="/family" />
        <div className="flex justify-center py-20">
          <Spinner />
        </div>
      </div>
    );
  }

  const statusKey = {
    open: 'family.taskDetail.statusOpen',
    assigned: 'family.taskDetail.statusAssigned',
    completed: 'family.taskDetail.statusCompleted',
    cancelled: 'family.taskDetail.statusCancelled',
  }[task.status];
  const acceptedOffer = offers?.find((o) => o.status === 'accepted') ?? null;
  const pendingOffers = offers?.filter((o) => o.status === 'pending') ?? [];
  const declinedOffers = offers?.filter((o) => o.status === 'declined') ?? [];

  return (
    <div>
      <TopNav title={t('family.taskDetail.title')} backTo="/family" />
      <div className="px-6 pt-4 pb-8">
        <div className="mb-1 flex items-center justify-between gap-2">
          <h1 className="text-lg font-bold text-gray-950">{task.title}</h1>
          <Badge variant={task.status === 'open' ? 'green' : task.status === 'assigned' ? 'blue' : 'gray'}>
            {t(statusKey)}
          </Badge>
        </div>
        <p className="mb-4 text-xs text-gray-500">
          {t(`categories.${task.category}`)} · {t(`subcategories.${task.subCategory}`)} ·{' '}
          {formatTimingSummary(t, task)}
        </p>

        {task.status === 'open' ? (
          <>
            <Card className="mb-4">
              <h3 className="mb-1 text-sm font-semibold text-gray-900">
                {t('family.taskDetail.descriptionTitle')}
              </h3>
              <p className="text-sm whitespace-pre-wrap text-gray-600">{task.description}</p>
              <TaskPhotos task={task} />
            </Card>

            <h2 className="mb-2 text-base font-bold text-gray-950">
              {t('family.taskDetail.offersTitle')}
            </h2>
            {actionError && <p className="mb-3 text-sm text-error-600">{actionError}</p>}
            {offersError ? (
              // A failed read is an ERROR, never the reassuring empty state
              // (PR #331 round 2).
              <div className="py-6 text-center">
                <p className="mb-3 text-sm text-error-600">{t('family.taskDetail.offersLoadError')}</p>
                <Button
                  size="sm"
                  variant="outline"
                  fullWidth={false}
                  onClick={() => {
                    // Clear the error too, so the retry FALLS THROUGH to the
                    // loading spinner (the AssignedTaskView retry idiom) —
                    // otherwise a re-failed subscribe changes nothing on
                    // screen and the button reads as dead (PR #331 round 3).
                    setOffersError(false);
                    setOffers(null);
                    setOffersTick((n) => n + 1);
                  }}
                >
                  {t('family.taskDetail.offersRetry')}
                </Button>
              </div>
            ) : offers === null ? (
              <div className="flex justify-center py-10">
                <Spinner />
              </div>
            ) : pendingOffers.length === 0 ? (
              <EmptyState icon={<UsersIcon className="h-6 w-6" />} message={t('family.taskDetail.offersEmpty')} />
            ) : (
              pendingOffers.map((offer) => (
                <OfferCard
                  key={offer.offerId}
                  offer={offer}
                  onAccept={setAcceptTarget}
                  onDecline={setDeclineTarget}
                />
              ))
            )}
            {declinedOffers.length > 0 && (
              <>
                <h3 className="mt-6 mb-2 text-sm font-semibold text-gray-500">
                  {t('family.taskDetail.declinedOffersTitle')}
                </h3>
                {declinedOffers.map((offer) => (
                  <OfferCard key={offer.offerId} offer={offer} />
                ))}
              </>
            )}

            <div className="mt-6">
              <Button variant="ghost" onClick={() => setCancelOpen(true)} disabled={busy}>
                {t('family.assigned.cancelCta')}
              </Button>
            </div>
          </>
        ) : (
          <>
            {actionError && <p className="mb-3 text-sm text-error-600">{actionError}</p>}
            <AssignedTaskView
              task={task}
              doerFirstName={acceptedOffer?.doerFirstName ?? null}
              onMarkDone={() => setMarkDoneOpen(true)}
              onCancel={() => setCancelOpen(true)}
              busy={busy}
              onEndorse={acceptedOffer && !endorsed ? () => setEndorseOpen(true) : null}
              // Description + photos stay available past acceptance — the
              // coordination phase is when the details matter most
              // (PR #331 round 2). Slotted between contact and checklist.
              details={
                <Card className="mb-4">
                  <h3 className="mb-1 text-sm font-semibold text-gray-900">
                    {t('family.taskDetail.descriptionTitle')}
                  </h3>
                  <p className="text-sm whitespace-pre-wrap text-gray-600">{task.description}</p>
                  <TaskPhotos task={task} />
                </Card>
              }
            />
          </>
        )}
      </div>

      {/* Accept confirm — §11.5's acceptance dialog: the §11.3 helper
          disclosure (when declared) + the decision-15 liability line. */}
      {acceptTarget && (
        <Dialog open onClose={() => setAcceptTarget(null)} ariaLabel={t('family.taskDetail.acceptConfirmTitle')}>
          <h3 className="mb-2 text-lg font-bold">{t('family.taskDetail.acceptConfirmTitle')}</h3>
          <p className="mb-2 text-sm text-gray-600">
            {t('family.taskDetail.acceptConfirmBody', {
              name: acceptTarget.doerFirstName,
              price: `${acceptTarget.price} € ${
                acceptTarget.priceBasis === 'hourly'
                  ? t('family.taskDetail.offerBasisHourly')
                  : t('family.taskDetail.offerBasisFlat')
              }`,
            })}
          </p>
          {acceptTarget.helper && (
            <p className="mb-2 text-xs leading-relaxed text-amber-700">
              {t('family.taskDetail.helperTitle', {
                name: `${acceptTarget.helper.firstName} ${acceptTarget.helper.lastName}`,
                age: acceptTarget.helper.age,
              })}{' '}
              — {t('family.taskDetail.helperDisclosure')}
            </p>
          )}
          <p className="mb-3 text-xs leading-relaxed text-gray-500">{t('family.post.liabilityNotice')}</p>
          <div className="mt-2 flex gap-2">
            <Button
              disabled={busy}
              onClick={() => {
                // Close BEFORE dispatching (the study RequestsPage
                // precedent — PR #331 round 2): a refusal's copy must
                // render on the PAGE, never behind an aria-modal scrim
                // where it is invisible and unannounced.
                const target = acceptTarget;
                setAcceptTarget(null);
                void runAction(
                  'doAcceptOffer',
                  { offerId: target.offerId },
                  'family.taskDetail.acceptError',
                );
              }}
              className="flex-1"
            >
              {t('family.taskDetail.acceptConfirmCta')}
            </Button>
            <Button variant="ghost" onClick={() => setAcceptTarget(null)} className="flex-1">
              {t('common.back')}
            </Button>
          </div>
        </Dialog>
      )}

      {declineTarget && (
        <Dialog open onClose={() => setDeclineTarget(null)} ariaLabel={t('family.taskDetail.declineConfirmTitle')}>
          <h3 className="mb-2 text-lg font-bold">{t('family.taskDetail.declineConfirmTitle')}</h3>
          <p className="mb-3 text-sm text-gray-600">
            {t('family.taskDetail.declineConfirmBody', { name: declineTarget.doerFirstName })}
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              disabled={busy}
              onClick={() => {
                // Close before dispatching — see the accept dialog.
                const target = declineTarget;
                setDeclineTarget(null);
                void runAction(
                  'doDeclineOffer',
                  { offerId: target.offerId },
                  'family.taskDetail.declineError',
                );
              }}
              className="flex-1"
            >
              {t('family.taskDetail.declineConfirmCta')}
            </Button>
            <Button variant="ghost" onClick={() => setDeclineTarget(null)} className="flex-1">
              {t('common.back')}
            </Button>
          </div>
        </Dialog>
      )}

      {cancelOpen && (
        <Dialog open onClose={() => setCancelOpen(false)} ariaLabel={t('family.assigned.cancelConfirmTitle')}>
          <h3 className="mb-2 text-lg font-bold">{t('family.assigned.cancelConfirmTitle')}</h3>
          <p className="mb-3 text-sm text-gray-600">
            {task.status === 'assigned'
              ? t('family.assigned.cancelConfirmBodyAssigned', {
                  name: acceptedOffer?.doerFirstName ?? '',
                })
              : t('family.assigned.cancelConfirmBodyOpen')}
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              disabled={busy}
              onClick={() => {
                // Close before dispatching — see the accept dialog.
                setCancelOpen(false);
                void runAction('doCancelTask', { taskId: task.taskId }, 'family.assigned.cancelError', () =>
                  toast(t('family.assigned.cancelledBanner')),
                );
              }}
              className="flex-1"
            >
              {t('family.assigned.cancelConfirmCta')}
            </Button>
            <Button variant="ghost" onClick={() => setCancelOpen(false)} className="flex-1">
              {t('family.assigned.cancelKeep')}
            </Button>
          </div>
        </Dialog>
      )}

      {endorseOpen && acceptedOffer && (
        <EndorseDoerDialog
          doerUserId={acceptedOffer.doerUserId}
          doerName={acceptedOffer.doerFirstName}
          defaultRefName={`${userDoc?.firstName ?? ''} ${userDoc?.lastName ?? ''}`.trim()}
          onClose={() => setEndorseOpen(false)}
          onEndorsed={() => setEndorsed(true)}
        />
      )}

      {markDoneOpen && (
        <Dialog open onClose={() => setMarkDoneOpen(false)} ariaLabel={t('family.assigned.markDoneConfirmTitle')}>
          <h3 className="mb-2 text-lg font-bold">{t('family.assigned.markDoneConfirmTitle')}</h3>
          <p className="mb-3 text-sm text-gray-600">{t('family.assigned.markDoneConfirmBody')}</p>
          <div className="mt-2 flex gap-2">
            <Button
              disabled={busy}
              onClick={() => {
                // Close before dispatching — see the accept dialog.
                setMarkDoneOpen(false);
                void runAction('doMarkTaskDone', { taskId: task.taskId }, 'family.assigned.markDoneError', () => {
                  toast(t('family.assigned.completedBanner'));
                  // The §9.1 prompt, on the one action that completes the
                  // task. Only when there IS someone to endorse: a task
                  // completed with no accepted offer has no doer.
                  if (acceptedOffer && !endorsed) setEndorseOpen(true);
                });
              }}
              className="flex-1"
            >
              {t('family.assigned.markDoneConfirmCta')}
            </Button>
            <Button variant="ghost" onClick={() => setMarkDoneOpen(false)} className="flex-1">
              {t('common.back')}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
