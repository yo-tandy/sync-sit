import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import type { OfferDoc, OfferStatus } from '@ejm/do-core';
import { Badge, Button, Card, Dialog, EmptyState, MailIcon, Spinner, useToast } from '@ejm/shared-ui';
import { db, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { TABS, type Tab, isLinkable, tabOf } from './offerTabs';

const STATUS_BADGE: Record<OfferStatus, { key: string; variant: 'green' | 'amber' | 'gray' | 'blue' }> = {
  pending: { key: 'doer.myOffers.statusPending', variant: 'blue' },
  pending_guardian: { key: 'doer.myOffers.statusAwaitingParent', variant: 'amber' },
  accepted: { key: 'doer.myOffers.statusAccepted', variant: 'green' },
  declined: { key: 'doer.myOffers.statusDeclined', variant: 'gray' },
  withdrawn: { key: 'doer.myOffers.statusWithdrawn', variant: 'gray' },
  expired: { key: 'doer.myOffers.statusExpired', variant: 'gray' },
};

/**
 * The student's offers (plan §9.2 "My offers"): ONE live query —
 * `where('doerUserId','==',uid)` ordered `createdAt desc`, the §7.3
 * `(doerUserId, createdAt)` composite — with the five status tabs
 * narrowing CLIENT-SIDE (§7.3's index note: no per-status server filter,
 * no extra composites).
 *
 * Every card renders from the offer doc ALONE — §4.2's denormalized
 * taskTitle/taskCategory/taskTiming — so a terminal offer whose task the
 * student can no longer read (§7.2 scopes task reads to
 * open-or-own-assignment) still shows its summary line. This page never
 * reads `doTasks` at all.
 */
export function MyOffersPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const { firebaseUser } = useAuthStore();
  const uid = firebaseUser?.uid ?? null;

  const [tab, setTab] = useState<Tab>('pending');
  const [offers, setOffers] = useState<OfferDoc[] | null>(null);
  const [error, setError] = useState(false);

  const [withdrawTarget, setWithdrawTarget] = useState<OfferDoc | null>(null);
  const [busy, setBusy] = useState(false);
  const [withdrawError, setWithdrawError] = useState(false);

  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(
      query(collection(db, 'taskOffers'), where('doerUserId', '==', uid), orderBy('createdAt', 'desc')),
      (snap) => {
        setOffers(snap.docs.map((d) => ({ ...(d.data() as OfferDoc), offerId: d.id })));
        setError(false);
      },
      () => setError(true),
    );
    return unsub;
  }, [uid]);

  const byTab = useMemo(() => {
    const groups: Record<Tab, OfferDoc[]> = {
      pending: [],
      awaitingParent: [],
      accepted: [],
      declined: [],
      withdrawn: [],
    };
    for (const offer of offers ?? []) groups[tabOf(offer.status)].push(offer);
    return groups;
  }, [offers]);

  const withdraw = async () => {
    if (!withdrawTarget) return;
    setBusy(true);
    setWithdrawError(false);
    try {
      await httpsCallable(functions, 'doWithdrawOffer')({ offerId: withdrawTarget.offerId });
      setWithdrawTarget(null);
      toast(t('doer.myOffers.statusWithdrawn'));
    } catch {
      setWithdrawError(true);
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return <p className="px-6 py-10 text-center text-sm text-gray-500">{t('doer.myOffers.loadError')}</p>;
  }
  if (offers === null) {
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    );
  }

  const emptyKey = {
    pending: 'doer.myOffers.emptyPending',
    awaitingParent: 'doer.myOffers.emptyAwaitingParent',
    accepted: 'doer.myOffers.emptyAccepted',
    declined: 'doer.myOffers.emptyDeclined',
    withdrawn: 'doer.myOffers.emptyWithdrawn',
  }[tab];

  return (
    <div className="px-6 pt-4 pb-8">
      <h1 className="mb-4 text-xl font-bold text-gray-950">{t('doer.myOffers.title')}</h1>

      <div role="tablist" aria-label={t('doer.myOffers.title')} className="mb-4 flex gap-1 rounded-xl bg-gray-100 p-1">
        {TABS.map((key) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`flex-1 rounded-lg px-1 py-2 text-xs font-semibold transition-colors ${
              tab === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t(`doer.myOffers.tab${key.charAt(0).toUpperCase()}${key.slice(1)}`)}
          </button>
        ))}
      </div>

      {byTab[tab].length === 0 ? (
        <EmptyState icon={<MailIcon className="h-6 w-6" />} message={t(emptyKey)} />
      ) : (
        byTab[tab].map((offer) => {
          const badge = STATUS_BADGE[offer.status];
          const body = (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-semibold text-gray-900">{offer.taskTitle}</p>
                <p className="shrink-0 text-sm font-bold text-brand-800">
                  {offer.price} €{' '}
                  <span className="text-xs font-medium text-gray-500">
                    {t(offer.priceBasis === 'hourly' ? 'doer.myOffers.basisHourly' : 'doer.myOffers.basisFlat')}
                  </span>
                </p>
              </div>
              <p className="mt-0.5 text-xs text-gray-500">
                {t(`categories.${offer.taskCategory}`)} · {t(`timing.${offer.taskTiming}`)}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Badge variant={badge.variant}>{t(badge.key)}</Badge>
              </div>
              {offer.status === 'pending_guardian' && (
                <p className="mt-1.5 text-xs text-amber-700">{t('doer.myOffers.awaitingParentNote')}</p>
              )}
              {offer.status === 'declined' && (
                <p className="mt-1.5 text-xs text-gray-500">
                  {t(
                    offer.declinedReason === 'sibling_accepted'
                      ? 'doer.myOffers.declinedSibling'
                      : offer.declinedReason === 'task_closed'
                        ? 'doer.myOffers.declinedTaskClosed'
                        : 'doer.myOffers.declinedFamily',
                  )}
                </p>
              )}
            </>
          );

          return (
            <Card key={offer.offerId} className="mb-3">
              {isLinkable(offer.status) ? (
                <Link to={`/doer/tasks/${offer.taskId}`} className="block">
                  {body}
                </Link>
              ) : (
                body
              )}
              {(offer.status === 'pending' || offer.status === 'pending_guardian') && (
                <div className="mt-3 flex gap-2 border-t border-gray-100 pt-3">
                  {offer.status === 'pending' && (
                    <Link
                      to={`/doer/tasks/${offer.taskId}/offer`}
                      className="inline-flex h-9 flex-1 items-center justify-center rounded-lg border-[1.5px] border-gray-300 px-3 text-sm font-semibold text-gray-700 transition-colors hover:border-brand-300"
                    >
                      {t('doer.myOffers.updateCta')}
                    </Link>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="flex-1"
                    onClick={() => {
                      setWithdrawError(false);
                      setWithdrawTarget(offer);
                    }}
                  >
                    {t('doer.myOffers.withdrawCta')}
                  </Button>
                </div>
              )}
            </Card>
          );
        })
      )}

      {withdrawTarget && (
        <Dialog open onClose={() => setWithdrawTarget(null)} ariaLabel={t('doer.myOffers.withdrawConfirmTitle')}>
          <h3 className="mb-2 text-lg font-bold">{t('doer.myOffers.withdrawConfirmTitle')}</h3>
          <p className="mb-3 text-sm text-gray-600">{t('doer.myOffers.withdrawConfirmBody')}</p>
          {withdrawError && <p className="mb-3 text-sm text-error-600">{t('doer.myOffers.withdrawError')}</p>}
          <div className="mt-2 flex gap-2">
            <Button disabled={busy} onClick={withdraw} className="flex-1">
              {busy ? t('doer.myOffers.withdrawing') : t('doer.myOffers.withdrawConfirmCta')}
            </Button>
            <Button variant="ghost" onClick={() => setWithdrawTarget(null)} className="flex-1">
              {t('doer.myOffers.withdrawKeep')}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
