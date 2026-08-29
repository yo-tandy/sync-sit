import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getSubCategoryDef, type OfferDoc, type TaskDoc } from '@ejm/do-core';
import { Badge, Button, Card, Dialog, InfoBanner, Spinner, TopNav, useToast } from '@ejm/shared-ui';
import { db, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { useConsiderations } from '@/lib/considerations';
import { formatTimingSummary, tsMillis } from '@/lib/taskDisplay';
import { useTaskPhotoUrls } from '@/lib/useTaskPhotoUrls';
import { AssignedWorkView } from '@/components/doer/AssignedWorkView';

/** All photos, via the shared §7.4 signed-URL hook. */
function DoerTaskPhotos({ task }: { task: TaskDoc }) {
  const { t } = useTranslation();
  const { urls, loading } = useTaskPhotoUrls(task.taskId, task.photos);
  if (task.photos.length === 0) return null;
  return (
    <div className="mt-3">
      <h4 className="mb-2 text-xs font-semibold text-gray-700">{t('doer.taskDetail.photosTitle')}</h4>
      {loading ? (
        <div className="flex justify-center py-4">
          <Spinner className="h-5 w-5" />
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {task.photos.map(
            ({ photoId }) =>
              urls[photoId] && (
                <img
                  key={photoId}
                  src={urls[photoId]}
                  alt=""
                  data-testid="task-photo"
                  className="aspect-square w-full rounded-lg object-cover"
                />
              ),
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The doer's task detail (plan §9.2): everything the family published,
 * plus the §5 considerations list as "what to ask before you offer"
 * (surface 2 of 3), plus the adultPresent badge — and, when the task is
 * the caller's own assignment, the AssignedWorkView (contact via
 * doGetAssignedContact, checklist, mark-done, cancel).
 *
 * The caller's own offer on this task is read with an EQUALITY-ONLY query
 * (`doerUserId == uid && taskId == t`) rather than a direct doc get of
 * `${taskId}_${uid}`: a get of a MISSING doc under §7.2's
 * `resource.data.doerUserId` rule errors the rule and surfaces as
 * permission-denied, so "no offer yet" and "denied" would be
 * indistinguishable. The equality query is provable (it constrains
 * doerUserId to the caller) and needs no composite (equality-only).
 *
 * A task that stops being readable (assigned to someone else, cancelled,
 * swept) surfaces as the not-available state, never a broken page —
 * §7.2's doer read is open-or-own-assignment by design.
 */
export function DoerTaskDetailPage() {
  const { t } = useTranslation();
  const { taskId } = useParams<{ taskId: string }>();
  const toast = useToast();
  const { firebaseUser } = useAuthStore();
  const uid = firebaseUser?.uid ?? null;

  const [task, setTask] = useState<TaskDoc | null | 'missing'>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [myOffer, setMyOffer] = useState<OfferDoc | null>(null);
  const [snapshotNow, setSnapshotNow] = useState(0);

  const [markDoneOpen, setMarkDoneOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const considerations = useConsiderations(task && task !== 'missing' ? task.subCategory : null);

  useEffect(() => {
    if (!taskId) return;
    const unsub = onSnapshot(
      doc(db, 'doTasks', taskId),
      (snap) => {
        setTask(snap.exists() ? { ...(snap.data() as TaskDoc), taskId: snap.id } : 'missing');
        setSnapshotNow(Date.now());
        setUnavailable(false);
      },
      // permission-denied == not open and not my assignment (§7.2) — the
      // truthful state is "no longer available", not an error page.
      () => setUnavailable(true),
    );
    return unsub;
  }, [taskId]);

  useEffect(() => {
    if (!taskId || !uid) return;
    const unsub = onSnapshot(
      query(collection(db, 'taskOffers'), where('doerUserId', '==', uid), where('taskId', '==', taskId)),
      (snap) =>
        setMyOffer(
          snap.docs.length > 0 ? { ...(snap.docs[0].data() as OfferDoc), offerId: snap.docs[0].id } : null,
        ),
      // Own-offer state is a convenience; the form's refusal mapping is
      // the backstop.
      () => setMyOffer(null),
    );
    return unsub;
  }, [taskId, uid]);

  const runAction = async (callable: string, payload: Record<string, unknown>, errorKey: string, onDone?: () => void) => {
    setBusy(true);
    setActionError(null);
    try {
      await httpsCallable(functions, callable)(payload);
      onDone?.();
    } catch {
      // Close the confirm dialogs BEFORE surfacing the error: the error
      // renders at page level, and an open modal overlay would hide it
      // (the PR #331 round-2 modal-overlay blocker, applied here too).
      setMarkDoneOpen(false);
      setCancelOpen(false);
      setActionError(t(errorKey));
    } finally {
      setBusy(false);
    }
  };

  if (unavailable || task === 'missing') {
    return (
      <div>
        <TopNav title={t('doer.taskDetail.title')} backTo="/home" />
        <p className="px-6 py-10 text-center text-sm text-gray-500">{t('doer.taskDetail.notAvailable')}</p>
      </div>
    );
  }
  if (task === null) {
    return (
      <div>
        <TopNav title={t('doer.taskDetail.title')} backTo="/home" />
        <div className="flex justify-center py-20">
          <Spinner />
        </div>
      </div>
    );
  }

  const mine = task.assignedUserId !== null && task.assignedUserId === uid;
  const expired = task.status === 'open' && tsMillis(task.expiresAt) <= snapshotNow;
  const subDef = getSubCategoryDef(task.subCategory);
  const adultBadge = (
    <Badge variant={task.adultPresent === 'yes' ? 'green' : task.adultPresent === 'partly' ? 'amber' : 'gray'}>
      {t('doer.taskDetail.adultPresentLabel')}:{' '}
      {t(
        task.adultPresent === 'yes'
          ? 'doer.taskDetail.adultYes'
          : task.adultPresent === 'partly'
            ? 'doer.taskDetail.adultPartly'
            : 'doer.taskDetail.adultNo',
      )}
    </Badge>
  );

  return (
    <div>
      <TopNav title={t('doer.taskDetail.title')} backTo="/home" />
      <div className="px-6 pt-4 pb-8">
        <h1 className="mb-1 text-lg font-bold text-gray-950">{task.title}</h1>
        <p className="mb-2 text-xs text-gray-500">
          {t(`categories.${task.category}`)} · {t(`subcategories.${task.subCategory}`)} ·{' '}
          {formatTimingSummary(t, task)}
        </p>
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          {adultBadge}
          {task.transportNeeded && <Badge variant="blue">{t('doer.taskDetail.transportLabel')}</Badge>}
        </div>

        {mine ? (
          <>
            {actionError && <p className="mb-3 text-sm text-error-600">{actionError}</p>}
            <AssignedWorkView
              task={task}
              onMarkDone={() => setMarkDoneOpen(true)}
              onCancel={() => setCancelOpen(true)}
              busy={busy}
            />
          </>
        ) : (
          <>
            {expired && <InfoBanner className="mb-4">{t('doer.taskDetail.expiredNotice')}</InfoBanner>}

            <Card className="mb-4">
              <h3 className="mb-1 text-sm font-semibold text-gray-900">{t('doer.taskDetail.descriptionTitle')}</h3>
              <p className="text-sm whitespace-pre-wrap text-gray-600">{task.description}</p>
              <DoerTaskPhotos task={task} />
            </Card>

            <Card className="mb-4">
              <h3 className="mb-2 text-sm font-semibold text-gray-900">{t('doer.taskDetail.detailsTitle')}</h3>
              <div className="space-y-1 text-sm text-gray-700">
                <p>
                  {t('doer.taskDetail.areaLabel')}: <span className="font-medium">{task.areaLabel}</span>
                </p>
                <p>
                  {t('doer.taskDetail.familyLabel')}: <span className="font-medium">{task.familyName}</span>
                </p>
                {task.toolsProvided !== null && (
                  <p>
                    {t('doer.taskDetail.toolsLabel')}:{' '}
                    <span className="font-medium">
                      {task.toolsProvided ? t('doer.taskDetail.toolsProvided') : t('doer.taskDetail.toolsBring')}
                    </span>
                  </p>
                )}
                {task.cadence?.timeHint && <p>{task.cadence.timeHint}</p>}
                {task.cadence?.note && <p>{task.cadence.note}</p>}
                {task.estimatedHours !== null && (
                  <p>
                    {t('doer.taskDetail.estimatedHoursLabel')}:{' '}
                    <span className="font-medium">
                      {t('doer.taskDetail.estimatedHoursValue', { count: task.estimatedHours })}
                    </span>
                  </p>
                )}
                {task.suggestedBudget !== null && (
                  <p>
                    {t('doer.taskDetail.budgetLabel')}:{' '}
                    <span className="font-medium">
                      {t('doer.taskDetail.budgetValue', { amount: task.suggestedBudget })}
                    </span>
                  </p>
                )}
              </div>
            </Card>

            {subDef?.flags.handlesFamilyMoney && (
              <InfoBanner variant="warning" className="mb-4">
                {t('doer.taskDetail.moneyNotice')}
              </InfoBanner>
            )}

            {considerations.length > 0 && (
              <Card className="mb-4">
                <h3 className="mb-1 text-sm font-semibold text-gray-900">
                  {t('doer.taskDetail.considerationsTitle')}
                </h3>
                <p className="mb-2 text-xs text-gray-500">{t('doer.taskDetail.considerationsHint')}</p>
                <ul className="list-disc space-y-1 pl-5 text-sm text-gray-600">
                  {considerations.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </Card>
            )}

            {task.status === 'open' && !expired && (
              <div className="mt-6">
                {myOffer === null ||
                myOffer.status === 'withdrawn' ||
                myOffer.status === 'declined' ||
                myOffer.status === 'expired' ? (
                  <Link
                    to={`/tasks/${task.taskId}/offer`}
                    className="inline-flex h-12 w-full items-center justify-center rounded-lg bg-brand-600 px-4 text-sm font-semibold text-white transition-all hover:bg-brand-600/90"
                  >
                    {myOffer === null ? t('doer.taskDetail.offerCta') : t('doer.taskDetail.offerAgainCta')}
                  </Link>
                ) : (
                  <Card>
                    <p className="mb-1 text-sm font-semibold text-gray-900">
                      {t('doer.taskDetail.yourOfferTitle')}:{' '}
                      {t('doer.taskDetail.yourOfferPrice', { price: myOffer.price })}
                    </p>
                    {myOffer.status === 'pending_guardian' ? (
                      <p className="text-xs text-amber-700">{t('doer.taskDetail.awaitingParentHint')}</p>
                    ) : (
                      <>
                        <p className="mb-2 text-xs text-gray-500">{t('doer.taskDetail.reviewOfferHint')}</p>
                        <Link
                          to={`/tasks/${task.taskId}/offer`}
                          className="text-sm font-semibold text-brand-600"
                        >
                          {t('doer.taskDetail.updateOfferCta')}
                        </Link>
                      </>
                    )}
                  </Card>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {markDoneOpen && (
        <Dialog open onClose={() => setMarkDoneOpen(false)} ariaLabel={t('doer.assigned.markDoneConfirmTitle')}>
          <h3 className="mb-2 text-lg font-bold">{t('doer.assigned.markDoneConfirmTitle')}</h3>
          <p className="mb-3 text-sm text-gray-600">{t('doer.assigned.markDoneConfirmBody')}</p>
          <div className="mt-2 flex gap-2">
            <Button
              disabled={busy}
              onClick={() =>
                runAction('doMarkTaskDone', { taskId: task.taskId }, 'doer.assigned.markDoneError', () => {
                  setMarkDoneOpen(false);
                  toast(t('doer.assigned.awaitingFamilyBanner'));
                })
              }
              className="flex-1"
            >
              {busy ? t('doer.assigned.markingDone') : t('doer.assigned.markDoneConfirmCta')}
            </Button>
            <Button variant="ghost" onClick={() => setMarkDoneOpen(false)} className="flex-1">
              {t('common.back')}
            </Button>
          </div>
        </Dialog>
      )}

      {cancelOpen && (
        <Dialog open onClose={() => setCancelOpen(false)} ariaLabel={t('doer.assigned.cancelConfirmTitle')}>
          <h3 className="mb-2 text-lg font-bold">{t('doer.assigned.cancelConfirmTitle')}</h3>
          {/* §6.4's aftermath grace is stated where the cancellation is
              decided, so the contact line not going instantly dead is
              expected rather than discovered. */}
          <p className="mb-3 text-sm text-gray-600">{t('doer.assigned.cancelConfirmBody')}</p>
          <div className="mt-2 flex gap-2">
            <Button
              disabled={busy}
              onClick={() =>
                runAction('doCancelTask', { taskId: task.taskId }, 'doer.assigned.cancelError', () => {
                  setCancelOpen(false);
                  toast(t('doer.assigned.cancelledBanner'));
                })
              }
              className="flex-1"
            >
              {busy ? t('doer.assigned.cancelling') : t('doer.assigned.cancelConfirmCta')}
            </Button>
            <Button variant="ghost" onClick={() => setCancelOpen(false)} className="flex-1">
              {t('doer.assigned.cancelKeep')}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
