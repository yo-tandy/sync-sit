import { useState, useEffect } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { collection, query, where, orderBy, getDocs } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { getParentProfile } from '@ejm/shared-core';
import type {
  StudyContactRequestDoc,
  StudyContactRequestStatus,
  TutorEndorsementDoc,
} from '@ejm/study-core';
import { Card, Button, Badge, TopNav, Spinner, Dialog } from '@ejm/shared-ui';
import { EndorseTutorDialog } from '@/components/family/EndorseTutorDialog';

/**
 * Family-side list of the contact requests this family has sent. Reads
 * `studyContactRequests` where `familyId == mine` ordered newest-first (a
 * composite index backs this), then groups the rows by status. Tutor identity
 * is rendered from the doc's denormalized `tutorName` — parents cannot read
 * tutor user docs.
 *
 * Accepted rows deep-link back to the search page with the subject/level
 * prefilled; that page auto-runs the search and reveals the tutor's contact
 * block on the matching card (Task 1 auto-search contract).
 */
const STATUS_ORDER: StudyContactRequestStatus[] = ['pending', 'accepted', 'declined', 'cancelled'];

const STATUS_VARIANT: Record<StudyContactRequestStatus, 'amber' | 'green' | 'gray'> = {
  pending: 'amber',
  accepted: 'green',
  declined: 'gray',
  cancelled: 'gray',
};

/** Endorsement status → chip variant for the "Your endorsements" section. */
const ENDORSEMENT_VARIANT: Record<string, 'amber' | 'green' | 'gray'> = {
  private: 'amber',
  approved: 'green',
  published: 'green',
  removed: 'gray',
};

/** Epoch seconds for a createdAt that may be a Timestamp or a plain Date. */
function createdAtSeconds(ts: TutorEndorsementDoc['createdAt']): number {
  const raw: unknown = ts;
  if (raw instanceof Date) return raw.getTime() / 1000;
  const seconds = (raw as { seconds?: number })?.seconds;
  return typeof seconds === 'number' ? seconds : 0;
}

export function RequestsPage() {
  const { t, i18n } = useTranslation();
  const { userDoc } = useAuthStore();
  const familyId = getParentProfile(userDoc)?.familyId ?? null;
  const defaultRefName = `${userDoc?.firstName ?? ''} ${userDoc?.lastName ?? ''}`.trim();

  const [requests, setRequests] = useState<StudyContactRequestDoc[] | null>(null);
  const [endorsements, setEndorsements] = useState<TutorEndorsementDoc[]>([]);
  // The accepted request whose endorse dialog is open, or null.
  const [endorsing, setEndorsing] = useState<StudyContactRequestDoc | null>(null);
  // The pending request whose cancel-confirmation dialog is open, or null.
  const [cancelTarget, setCancelTarget] = useState<StudyContactRequestDoc | null>(null);
  // requestId currently awaiting the cancel callable, or null (row in-flight).
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  // tutorUserIds endorsed this session (submit succeeded or already-exists) — the
  // matching accepted row shows a disabled "Endorsed" state (persisted nothing).
  const [endorsedTutors, setEndorsedTutors] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!familyId) return;
    let cancelled = false;
    getDocs(
      query(
        collection(db, 'studyContactRequests'),
        where('familyId', '==', familyId),
        orderBy('createdAt', 'desc'),
      ),
    )
      .then((snap) => {
        if (cancelled) return;
        setRequests(snap.docs.map((d) => d.data() as StudyContactRequestDoc));
      })
      .catch(() => {
        if (!cancelled) setRequests([]);
      });
    return () => {
      cancelled = true;
    };
  }, [familyId]);

  // This family's submitted endorsements for the "Your endorsements" section.
  // Equality-only (submittedByFamilyId + appSource) — no composite needed — so we
  // sort newest-first client-side.
  useEffect(() => {
    if (!familyId) return;
    let cancelled = false;
    getDocs(
      query(
        collection(db, 'references'),
        where('submittedByFamilyId', '==', familyId),
        where('appSource', '==', 'study'),
      ),
    )
      .then((snap) => {
        if (cancelled) return;
        const rows = snap.docs.map((d) => d.data() as TutorEndorsementDoc);
        rows.sort((a, b) => createdAtSeconds(b.createdAt) - createdAtSeconds(a.createdAt));
        setEndorsements(rows);
      })
      .catch(() => {
        if (!cancelled) setEndorsements([]);
      });
    return () => {
      cancelled = true;
    };
  }, [familyId]);

  const markEndorsed = (tutorUserId: string) =>
    setEndorsedTutors((prev) => new Set(prev).add(tutorUserId));

  // NON-OPTIMISTIC: a cancel is a state change the backend owns, so we only move
  // the row to 'cancelled' after the callable resolves. The row is disabled
  // while in flight; on failure it stays pending and an error shows.
  const cancelRequest = async (req: StudyContactRequestDoc) => {
    setCancelError(null);
    setCancellingId(req.requestId);
    try {
      const fn = httpsCallable(functions, 'cancelContactRequest');
      await fn({ requestId: req.requestId });
      setRequests((rs) =>
        (rs ?? []).map((r) =>
          r.requestId === req.requestId ? { ...r, status: 'cancelled' } : r,
        ),
      );
    } catch {
      setCancelError(t('family.requests.actionError'));
    } finally {
      setCancellingId(null);
    }
  };

  const formatDate = (ts: StudyContactRequestDoc['createdAt']): string => {
    const raw: unknown = ts;
    // Emulator-written rows can arrive as a plain Date; production Firestore
    // returns a Timestamp with .toDate(). Handle both, then fall back to ''.
    const date =
      raw instanceof Date
        ? raw
        : raw && typeof (raw as { toDate?: unknown }).toDate === 'function'
          ? (raw as { toDate: () => Date }).toDate()
          : null;
    if (!date) return '';
    return date.toLocaleDateString(i18n.language === 'fr' ? 'fr-FR' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div>
      <TopNav title={t('family.requests.title')} backTo="/family" />

      <div className="px-5 pt-4 pb-8">
        {cancelError && <p className="mb-4 text-sm text-red-600">{cancelError}</p>}

        {/* Spinner only while a real fetch is in flight — with no familyId there
            is nothing to load, so fall through to the empty state. */}
        {familyId != null && requests === null && (
          <div className="flex justify-center py-20">
            <Spinner />
          </div>
        )}

        {(!familyId || (requests !== null && requests.length === 0)) && (
          <Card>
            <p className="py-4 text-center text-sm text-gray-500">{t('family.requests.empty')}</p>
          </Card>
        )}

        {familyId != null &&
          requests !== null &&
          requests.length > 0 &&
          STATUS_ORDER.map((status) => {
            const rows = requests.filter((r) => r.status === status);
            if (rows.length === 0) return null;
            return (
              <div key={status} className="mb-6">
                <h2 className="mb-2 text-sm font-semibold text-gray-700">
                  {t(`family.requests.section.${status}`)}
                </h2>
                <div className="space-y-3">
                  {rows.map((r) => (
                    <Card key={r.requestId}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-gray-900">{r.tutorName}</p>
                          <p className="text-xs text-gray-500">
                            {t(`tutor.subjects.names.${r.subject}`)} · {r.level}
                          </p>
                          <p className="mt-0.5 text-xs text-gray-400">
                            {t('family.requests.sentOn', { date: formatDate(r.createdAt) })}
                          </p>
                        </div>
                        <Badge variant={STATUS_VARIANT[r.status]}>
                          {t(`family.requests.status.${r.status}`)}
                        </Badge>
                      </div>

                      {r.status === 'pending' && (
                        <div className="mt-3">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={cancellingId === r.requestId}
                            onClick={() => setCancelTarget(r)}
                          >
                            {t('family.requests.cancel')}
                          </Button>
                        </div>
                      )}

                      {r.status === 'accepted' && (
                        <div className="mt-3 flex flex-wrap items-center gap-3">
                          <Link
                            to={`/family/search?subject=${encodeURIComponent(
                              r.subject,
                            )}&level=${encodeURIComponent(r.level)}`}
                            className="text-xs font-semibold text-red-600 hover:underline"
                          >
                            {t('family.requests.viewContact')}
                          </Link>
                          {/* Deep link into booking: the page re-derives the
                              tutor's card data via searchTutors from these
                              subject/level values (router-state-first fallback). */}
                          <Link
                            to={`/family/book/${r.tutorUserId}`}
                            state={{
                              subject: r.subject,
                              level: r.level,
                              tutorName: r.tutorName,
                            }}
                          >
                            <Button size="sm">{t('family.requests.book')}</Button>
                          </Link>
                          {endorsedTutors.has(r.tutorUserId) ? (
                            <Button size="sm" variant="outline" disabled>
                              {t('family.requests.endorsed')}
                            </Button>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => setEndorsing(r)}>
                              {t('family.requests.endorse', { name: r.tutorName })}
                            </Button>
                          )}
                        </div>
                      )}
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}

        {/* ── Your endorsements ── */}
        {familyId != null && endorsements.length > 0 && (
          <div className="mb-6">
            <h2 className="mb-2 text-sm font-semibold text-gray-700">
              {t('family.requests.endorsementsTitle')}
            </h2>
            <div className="space-y-3">
              {endorsements.map((e) => (
                <Card key={e.referenceId}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-gray-800">{e.referenceText}</p>
                      {e.refName && (
                        <p className="mt-1 text-xs text-gray-500">{e.refName}</p>
                      )}
                    </div>
                    <Badge variant={ENDORSEMENT_VARIANT[e.status] ?? 'gray'}>
                      {t(`family.requests.endorsementStatus.${e.status}`)}
                    </Badge>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>

      {endorsing && (
        <EndorseTutorDialog
          tutorUserId={endorsing.tutorUserId}
          tutorName={endorsing.tutorName}
          subject={endorsing.subject}
          defaultRefName={defaultRefName}
          onClose={() => setEndorsing(null)}
          onEndorsed={() => markEndorsed(endorsing.tutorUserId)}
        />
      )}

      {/* ── Cancel confirmation ── */}
      <Dialog open={cancelTarget !== null} onClose={() => setCancelTarget(null)}>
        <h3 className="mb-2 text-lg font-bold">{t('family.requests.confirmCancelTitle')}</h3>
        <p className="mb-5 text-sm text-gray-600">{t('family.requests.confirmCancelDesc')}</p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            disabled={cancellingId !== null}
            onClick={() => {
              const target = cancelTarget;
              setCancelTarget(null);
              if (target) cancelRequest(target);
            }}
          >
            {t('family.requests.confirmCancelCta')}
          </Button>
          <Button variant="ghost" className="flex-1" onClick={() => setCancelTarget(null)}>
            {t('family.requests.keepRequest')}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
