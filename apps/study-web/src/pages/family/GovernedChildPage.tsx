import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';
import { Card, Button, Badge, TopNav, Spinner, Dialog } from '@ejm/shared-ui';
import { ReasonModal } from '@/components/sessions/ReasonModal';
import type { RecurringSlot } from '@ejm/shared-core';
import type {
  GovernedChildDetail,
  GovernedStudySession,
  GovernedSessionInstance,
} from '@/types/guardian';

const DAY_FULL: Record<RecurringSlot['day'], string> = {
  mon: 'monday',
  tue: 'tuesday',
  wed: 'wednesday',
  thu: 'thursday',
  fri: 'friday',
  sat: 'saturday',
  sun: 'sunday',
};

/** Machine-readable guardian error code from an HttpsError's details, if any. */
function guardianErrorCode(err: unknown): string | null {
  const code = (err as { details?: { code?: unknown } } | null)?.details?.code;
  return typeof code === 'string' ? code : null;
}

const TERMINAL = ['declined', 'cancelled', 'completed'];

const STATUS_VARIANT: Record<string, 'amber' | 'green' | 'gray'> = {
  pending: 'amber',
  confirmed: 'green',
  scheduled: 'green',
};

/** What the decline-confirmation dialog is targeting. */
type DeclineTarget =
  | { kind: 'session'; sessionId: string }
  | { kind: 'contact'; requestId: string }
  // A contact request the CHILD sent: withdrawn, not declined (issue #207 PR4).
  | { kind: 'withdrawContact'; requestId: string };

/**
 * What the reason-required cancellation modal is targeting: a whole
 * session/series, one recurring occurrence, or the withdrawal of the kid's
 * own pending proposal (also a cancelSession — declining one's own proposal
 * is refused server-side).
 */
type CancelTarget =
  | { kind: 'session'; session: GovernedStudySession }
  | { kind: 'instance'; session: GovernedStudySession; instance: GovernedSessionInstance }
  | { kind: 'withdraw'; session: GovernedStudySession };

/** What the searchable-toggle confirmation is targeting. */
type SearchableTarget = { app: 'study' | 'sit'; searchable: boolean };

/**
 * Per-kid oversight detail (governance ruling 8: supervising parents see
 * EVERYTHING — session notes, request messages, cancellation flags). All data
 * arrives via getGovernedChildDetail; the protective controls ride the
 * EXISTING session/request callables, which authorize the guardian
 * server-side. Guardian powers are DECLINE-ONLY: this page deliberately
 * renders no accept affordance anywhere (pinned by test).
 *
 * Every control is NON-OPTIMISTIC — state changes only after its callable
 * resolves, then the whole detail is refetched.
 */
export function GovernedChildPage() {
  const { t, i18n } = useTranslation();
  const { childUid } = useParams<{ childUid: string }>();

  const [detail, setDetail] = useState<GovernedChildDetail | null>(null);
  const [denied, setDenied] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // True while any control's callable is in flight (disables all controls —
  // the page refetches wholesale afterwards, so per-row granularity buys nothing).
  const [acting, setActing] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [searchTarget, setSearchTarget] = useState<SearchableTarget | null>(null);
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [declineTarget, setDeclineTarget] = useState<DeclineTarget | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!childUid) return;
    try {
      const fn = httpsCallable<{ childUid: string }, GovernedChildDetail>(
        functions,
        'getGovernedChildDetail',
      );
      const res = await fn({ childUid });
      if (!mountedRef.current) return;
      setDetail(res.data);
      setDenied(false);
      setLoadError(false);
    } catch (err) {
      if (!mountedRef.current) return;
      const code = guardianErrorCode(err);
      if (code === 'guardian/not-supervised' || code === 'guardian/not-a-family-parent') {
        setDenied(true);
      } else {
        setLoadError(true);
      }
    }
  }, [childUid]);

  useEffect(() => {
    load();
  }, [load]);

  const formatIso = (iso: string | null): string => {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString(i18n.language === 'fr' ? 'fr-FR' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  // "YYYY-MM-DD" parsed field-by-field (not new Date(str) — UTC-midnight slip).
  const formatDateStr = (s: string | null): string => {
    if (!s) return '';
    const [y, m, d] = s.split('-').map(Number);
    if (!y || !m || !d) return '';
    return new Date(y, m - 1, d).toLocaleDateString(i18n.language === 'fr' ? 'fr-FR' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const kidName = detail
    ? [detail.child.firstName, detail.child.lastName].filter(Boolean).join(' ')
    : '';
  const firstName = detail?.child.firstName ?? '';

  /** Run one protective control non-optimistically, then refetch the detail. */
  const runControl = async (name: string, payload: Record<string, unknown>) => {
    setActionError(null);
    setActing(true);
    try {
      const fn = httpsCallable(functions, name);
      await fn(payload);
      await load();
      return true;
    } catch {
      if (mountedRef.current) setActionError(t('family.governance.actionError'));
      return false;
    } finally {
      if (mountedRef.current) setActing(false);
    }
  };

  const submitCancel = async (reason: string) => {
    if (!cancelTarget) return;
    setCancelError(null);
    setActing(true);
    try {
      if (cancelTarget.kind === 'instance') {
        const fn = httpsCallable(functions, 'cancelSessionInstance');
        await fn({
          sessionId: cancelTarget.session.sessionId,
          instanceId: cancelTarget.instance.instanceId,
          reason,
        });
      } else {
        const fn = httpsCallable(functions, 'cancelSession');
        await fn({ sessionId: cancelTarget.session.sessionId, reason });
      }
      setCancelTarget(null);
      await load();
    } catch {
      if (mountedRef.current) setCancelError(t('family.governance.actionError'));
    } finally {
      if (mountedRef.current) setActing(false);
    }
  };

  const submitDecline = async () => {
    const target = declineTarget;
    setDeclineTarget(null);
    if (!target) return;
    if (target.kind === 'session') {
      await runControl('respondToSession', { sessionId: target.sessionId, action: 'decline' });
    } else if (target.kind === 'withdrawContact') {
      await runControl('cancelContactRequest', { requestId: target.requestId });
    } else {
      await runControl('respondToTutorContactRequest', {
        requestId: target.requestId,
        action: 'decline',
      });
    }
  };

  const toggleExpanded = (sessionId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  };

  // ── Denied / loading / error shells ──
  if (denied) {
    return (
      <div>
        <TopNav title={t('family.governance.title')} backTo="/family/governance" />
        <div className="px-5 pt-4 pb-8">
          <Card>
            <h2 className="mb-2 text-lg font-bold text-gray-900">
              {t('family.governance.child.deniedTitle')}
            </h2>
            <p className="mb-5 text-sm text-gray-600">{t('family.governance.child.deniedDesc')}</p>
            <Link to="/family/governance" className="block">
              <Button className="w-full">{t('family.governance.child.deniedBack')}</Button>
            </Link>
          </Card>
        </div>
      </div>
    );
  }

  if (detail === null) {
    return (
      <div>
        <TopNav title={t('family.governance.title')} backTo="/family/governance" />
        <div className="px-5 pt-4 pb-8">
          {loadError ? (
            <p className="py-10 text-center text-sm text-brand-600">
              {t('family.governance.child.loadError')}
            </p>
          ) : (
            <div className="flex justify-center py-20">
              <Spinner />
            </div>
          )}
        </div>
      </div>
    );
  }

  const sessions = detail.study.sessions;
  const pendingSessions = sessions.filter((s) => s.status === 'pending');
  const confirmedSessions = sessions.filter((s) => s.status === 'confirmed');
  const historySessions = sessions.filter((s) => TERMINAL.includes(s.status));
  const pendingContacts = detail.study.contactRequests.filter((r) => r.status === 'pending');
  const tutorProfile = detail.providerProfiles.tutor;
  const sitProfile = detail.providerProfiles.babysitter;

  const sessionMeta = (s: GovernedStudySession) => (
    <>
      <p className="text-sm font-semibold text-gray-900">{s.familyName}</p>
      {s.subject && (
        <p className="text-xs text-gray-500">
          {t(`tutor.subjects.names.${s.subject}`)}
          {s.level ? ` · ${s.level}` : ''}
        </p>
      )}
      {s.date && (
        <p className="mt-1 text-xs text-gray-700">
          {formatDateStr(s.date)}
          {s.startTime ? ` · ${s.startTime}` : ''}
          {s.endTime ? `–${s.endTime}` : ''}
        </p>
      )}
      {s.type === 'recurring' && s.recurringSlots?.[0] && (
        <p className="mt-1 text-xs text-gray-700">
          {t('family.sessions.recurringSlot', {
            day: t(`days.${DAY_FULL[s.recurringSlots[0].day]}`),
            start: s.recurringSlots[0].startTime,
            end: s.recurringSlots[0].endTime,
          })}
        </p>
      )}
    </>
  );

  // Ruling 8: message + notes are always rendered when present.
  const sessionTransparency = (s: {
    message: string | null;
    preSessionNote: string | null;
    postSessionNote: string | null;
  }) => (
    <>
      {s.message && (
        <p className="mt-2 rounded-lg bg-gray-50 p-2 text-xs italic text-gray-600">{s.message}</p>
      )}
      {s.preSessionNote && (
        <p className="mt-2 rounded-lg bg-gray-50 p-2 text-xs text-gray-600">
          <span className="font-semibold">{t('family.governance.child.notePre')}: </span>
          {s.preSessionNote}
        </p>
      )}
      {s.postSessionNote && (
        <p className="mt-2 rounded-lg bg-gray-50 p-2 text-xs text-gray-600">
          <span className="font-semibold">{t('family.governance.child.notePost')}: </span>
          {s.postSessionNote}
        </p>
      )}
    </>
  );

  const instanceRow = (s: GovernedStudySession, inst: GovernedSessionInstance) => (
    <li key={inst.instanceId} className="border-t border-gray-100 py-2 first:border-t-0">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-gray-700">
          {formatDateStr(inst.date)}
          {inst.startTime ? ` · ${inst.startTime}` : ''}
          {inst.endTime ? `–${inst.endTime}` : ''}
        </p>
        <Badge variant={STATUS_VARIANT[inst.status] ?? 'gray'}>
          {t(`family.governance.child.instanceStatus.${inst.status}`)}
        </Badge>
      </div>
      {sessionTransparency({ message: null, ...inst })}
      {inst.status === 'scheduled' && (
        <div className="mt-2">
          <Button
            size="sm"
            variant="outline"
            disabled={acting}
            onClick={() => {
              setCancelError(null);
              setCancelTarget({ kind: 'instance', session: s, instance: inst });
            }}
          >
            {t('family.governance.child.cancelOccurrence')}
          </Button>
        </div>
      )}
    </li>
  );

  const searchableRow = (app: 'study' | 'sit', searchable: boolean, labelKey: string) => (
    <div className="mt-2 flex items-center justify-between">
      <div className="flex-1 pr-4">
        <p className="text-sm font-medium text-gray-900">{t(labelKey)}</p>
        <p className="text-xs text-gray-500">
          {searchable
            ? t('family.governance.searchableOn')
            : t('family.governance.searchableOff')}
        </p>
      </div>
      <button
        type="button"
        aria-label={t(
          app === 'study'
            ? 'family.governance.child.toggleStudy'
            : 'family.governance.child.toggleSit',
        )}
        disabled={acting}
        onClick={() => setSearchTarget({ app, searchable: !searchable })}
        className={`flex h-6 w-10 items-center rounded-full p-0.5 transition-colors ${searchable ? 'bg-brand-600' : 'bg-gray-300'}`}
      >
        <div
          className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${searchable ? 'translate-x-4' : 'translate-x-0'}`}
        />
      </button>
    </div>
  );

  return (
    <div>
      <TopNav title={t('family.governance.title')} backTo="/family/governance" />

      <div className="px-5 pt-4 pb-8">
        {actionError && <p className="mb-4 text-sm text-brand-600">{actionError}</p>}

        {/* ── Header: kid identity ── */}
        <Card className="mb-4">
          <p className="text-base font-bold text-gray-900">{kidName}</p>
          <p className="text-xs text-gray-500">
            {detail.child.age != null &&
              `${t('family.governance.age', { age: detail.child.age })} · `}
            {detail.child.email}
          </p>
          {detail.link.confirmedAt && (
            <p className="mt-1 text-xs text-gray-500">
              {t('family.governance.child.supervisedSince', {
                date: formatIso(detail.link.confirmedAt),
              })}
            </p>
          )}
        </Card>

        {/* ── Profiles + protective searchable toggles ── */}
        <h2 className="mb-2 text-sm font-semibold text-gray-700">
          {t('family.governance.child.profilesTitle')}
        </h2>
        <Card className="mb-4">
          {tutorProfile ? (
            <>
              {(tutorProfile.subjects ?? []).map((offering) => (
                <p key={offering.subject} className="text-xs text-gray-600">
                  {t(`tutor.subjects.names.${offering.subject}`)} —{' '}
                  {offering.levels.join(', ')} — {t('family.search.rate', { rate: offering.rate })}
                </p>
              ))}
              {searchableRow(
                'study',
                tutorProfile.searchable === true,
                'family.governance.profileTutor',
              )}
            </>
          ) : (
            <p className="text-xs text-gray-500">{t('family.governance.child.noTutorProfile')}</p>
          )}
          {sitProfile != null && (
            <div className="mt-3 border-t border-gray-100 pt-3">
              <p className="text-xs text-gray-500">{t('family.governance.child.sitPresence')}</p>
              {searchableRow(
                'sit',
                (sitProfile as { searchable?: boolean }).searchable === true,
                'family.governance.profileBabysitter',
              )}
            </div>
          )}
        </Card>

        {/* ── Schedule summary ── */}
        <h2 className="mb-2 text-sm font-semibold text-gray-700">
          {t('family.governance.child.scheduleTitle')}
        </h2>
        <Card className="mb-4">
          <p className="text-xs text-gray-600">
            {detail.schedule.weekly
              ? t('family.governance.child.scheduleSet', {
                  count: detail.schedule.overrideCount,
                })
              : t('family.governance.child.scheduleNone')}
          </p>
        </Card>

        {/* ── Pending requests (decline-only) ── */}
        {(pendingSessions.length > 0 || pendingContacts.length > 0) && (
          <div className="mb-6">
            <h2 className="mb-2 text-sm font-semibold text-gray-700">
              {t('family.governance.child.pendingTitle')}
            </h2>
            <div className="space-y-3">
              {pendingSessions.map((s) => (
                <Card key={s.sessionId}>
                  {sessionMeta(s)}
                  {sessionTransparency(s)}
                  {s.proposedBy === 'provider' ? (
                    // The kid's OWN proposal — declining it would be refused
                    // server-side; the guardian may only withdraw it (a cancel).
                    <>
                      <p className="mt-2 text-xs text-amber-700">
                        {t('family.governance.child.proposedByChild', { name: firstName })}
                      </p>
                      <div className="mt-3">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={acting}
                          onClick={() => {
                            setCancelError(null);
                            setCancelTarget({ kind: 'withdraw', session: s });
                          }}
                        >
                          {t('family.governance.child.withdrawProposal')}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="mt-3">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={acting}
                        onClick={() => setDeclineTarget({ kind: 'session', sessionId: s.sessionId })}
                      >
                        {t('family.governance.child.decline')}
                      </Button>
                    </div>
                  )}
                </Card>
              ))}
              {pendingContacts.map((r) => (
                <Card key={r.requestId}>
                  <p className="text-sm font-semibold text-gray-900">{r.familyName}</p>
                  <p className="text-xs text-gray-500">
                    {/* parentName is '' until a parent answers a request
                        the KID sent, so build the line from what is there
                        rather than leading with a separator. */}
                    {[
                      r.parentName,
                      r.subject ? t(`tutor.subjects.names.${r.subject}`) : '',
                      r.level,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  {r.message && (
                    <p className="mt-2 rounded-lg bg-gray-50 p-2 text-xs italic text-gray-600">
                      {r.message}
                    </p>
                  )}
                  {r.initiatedBy === 'tutor' ? (
                    // The kid's OWN approach to a published search (issue #207
                    // PR4) — the same shape as a session they proposed, and
                    // handled the same way: declining it is refused
                    // server-side, so the guardian may only withdraw it.
                    <>
                      <p className="mt-2 text-xs text-amber-700">
                        {t('family.governance.child.contactSentByChild', { name: firstName })}
                      </p>
                      <div className="mt-3">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={acting}
                          onClick={() =>
                            setDeclineTarget({ kind: 'withdrawContact', requestId: r.requestId })
                          }
                        >
                          {t('family.governance.child.withdrawContact')}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="mt-3">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={acting}
                        onClick={() => setDeclineTarget({ kind: 'contact', requestId: r.requestId })}
                      >
                        {t('family.governance.child.decline')}
                      </Button>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* ── Confirmed sessions (cancel with reason) ── */}
        {confirmedSessions.length > 0 && (
          <div className="mb-6">
            <h2 className="mb-2 text-sm font-semibold text-gray-700">
              {t('family.governance.child.upcomingTitle')}
            </h2>
            <div className="space-y-3">
              {confirmedSessions.map((s) => (
                <Card key={s.sessionId}>
                  {sessionMeta(s)}
                  {sessionTransparency(s)}
                  <div className="mt-3 flex gap-2">
                    {s.type === 'recurring' && s.instances.length > 0 && (
                      <Button size="sm" variant="ghost" onClick={() => toggleExpanded(s.sessionId)}>
                        {expanded.has(s.sessionId)
                          ? t('family.governance.child.hideDates')
                          : t('family.governance.child.viewDates')}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={acting}
                      onClick={() => {
                        setCancelError(null);
                        setCancelTarget({ kind: 'session', session: s });
                      }}
                    >
                      {s.type === 'recurring'
                        ? t('family.governance.child.cancelSeries')
                        : t('family.governance.child.cancelSession')}
                    </Button>
                  </div>
                  {expanded.has(s.sessionId) && (
                    <ul className="mt-2">{s.instances.map((inst) => instanceRow(s, inst))}</ul>
                  )}
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* ── History (read-only) ── */}
        {historySessions.length > 0 && (
          <div className="mb-6">
            <h2 className="mb-2 text-sm font-semibold text-gray-700">
              {t('family.governance.child.historyTitle')}
            </h2>
            <div className="space-y-3">
              {historySessions.map((s) => (
                <Card key={s.sessionId}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">{sessionMeta(s)}</div>
                    <Badge variant="gray">
                      {t(`family.governance.child.status.${s.status}`)}
                    </Badge>
                  </div>
                  {sessionTransparency(s)}
                </Card>
              ))}
            </div>
          </div>
        )}

        {sessions.length === 0 && pendingContacts.length === 0 && (
          <Card>
            <p className="py-4 text-center text-sm text-gray-500">
              {t('family.governance.child.emptySessions')}
            </p>
          </Card>
        )}
      </div>

      {/* ── Searchable-toggle confirmation ── */}
      <Dialog open={searchTarget !== null} onClose={() => setSearchTarget(null)} ariaLabel={searchTarget?.searchable ? t('family.governance.child.confirmShowTitle') : t('family.governance.child.confirmHideTitle')}>
        <h3 className="mb-2 text-lg font-bold">
          {searchTarget?.searchable
            ? t('family.governance.child.confirmShowTitle')
            : t('family.governance.child.confirmHideTitle')}
        </h3>
        <p className="mb-5 text-sm text-gray-600">
          {searchTarget?.searchable
            ? t('family.governance.child.confirmShowDesc', { name: firstName })
            : t('family.governance.child.confirmHideDesc', { name: firstName })}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            disabled={acting}
            onClick={() => {
              const target = searchTarget;
              setSearchTarget(null);
              if (target && childUid) {
                runControl('guardianSetChildSearchable', {
                  childUid,
                  app: target.app,
                  searchable: target.searchable,
                });
              }
            }}
          >
            {searchTarget?.searchable
              ? t('family.governance.child.confirmShowCta')
              : t('family.governance.child.confirmHideCta')}
          </Button>
          <Button variant="ghost" className="flex-1" onClick={() => setSearchTarget(null)}>
            {t('common.cancel')}
          </Button>
        </div>
      </Dialog>

      {/* ── Decline confirmation (decline-only — there is no accept) ── */}
      <Dialog open={declineTarget !== null} onClose={() => setDeclineTarget(null)} ariaLabel={t(declineTarget?.kind === 'withdrawContact' ? 'family.governance.child.confirmWithdrawContactTitle' : 'family.governance.child.confirmDeclineTitle')}>
        <h3 className="mb-2 text-lg font-bold">
          {t(declineTarget?.kind === 'withdrawContact'
            ? 'family.governance.child.confirmWithdrawContactTitle'
            : 'family.governance.child.confirmDeclineTitle')}
        </h3>
        <p className="mb-5 text-sm text-gray-600">
          {t(declineTarget?.kind === 'withdrawContact'
            ? 'family.governance.child.confirmWithdrawContactDesc'
            : 'family.governance.child.confirmDeclineDesc', { name: firstName })}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" disabled={acting} onClick={submitDecline}>
            {t(declineTarget?.kind === 'withdrawContact'
              ? 'family.governance.child.confirmWithdrawContactCta'
              : 'family.governance.child.confirmDeclineCta')}
          </Button>
          <Button variant="ghost" className="flex-1" onClick={() => setDeclineTarget(null)}>
            {t('family.governance.child.keepRequest')}
          </Button>
        </div>
      </Dialog>

      {/* ── Cancellation / withdrawal (reason required) ── */}
      <ReasonModal
        open={cancelTarget !== null}
        title={
          cancelTarget?.kind === 'withdraw'
            ? t('family.governance.child.withdrawTitle')
            : cancelTarget?.kind === 'instance'
              ? t('family.governance.child.cancelOccurrenceTitle')
              : cancelTarget?.session.type === 'recurring'
                ? t('family.governance.child.cancelSeriesTitle')
                : t('family.governance.child.cancelTitle')
        }
        description={
          cancelTarget?.kind === 'withdraw'
            ? t('family.governance.child.withdrawDesc', { name: firstName })
            : t('family.governance.child.cancelDesc', { name: firstName })
        }
        placeholder={t('family.governance.child.cancelPlaceholder')}
        confirmLabel={
          cancelTarget?.kind === 'withdraw'
            ? t('family.governance.child.withdrawConfirm')
            : cancelTarget?.kind === 'instance'
              ? t('family.governance.child.cancelOccurrenceConfirm')
              : t('family.governance.child.cancelConfirm')
        }
        keepLabel={
          cancelTarget?.kind === 'withdraw'
            ? t('family.governance.child.withdrawKeep')
            : t('family.governance.child.cancelKeep')
        }
        submitting={acting}
        error={cancelError}
        onConfirm={submitCancel}
        onClose={() => setCancelTarget(null)}
      />
    </div>
  );
}
