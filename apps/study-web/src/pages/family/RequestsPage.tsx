import { useState, useEffect } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { collection, query, where, orderBy, getDocs } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { getParentProfile } from '@ejm/shared-core';
import type { StudyContactRequestDoc, StudyContactRequestStatus } from '@ejm/study-core';
import { Card, Badge, TopNav, Spinner } from '@ejm/shared-ui';

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
const STATUS_ORDER: StudyContactRequestStatus[] = ['pending', 'accepted', 'declined'];

const STATUS_VARIANT: Record<StudyContactRequestStatus, 'amber' | 'green' | 'gray'> = {
  pending: 'amber',
  accepted: 'green',
  declined: 'gray',
};

export function RequestsPage() {
  const { t, i18n } = useTranslation();
  const { userDoc } = useAuthStore();
  const familyId = getParentProfile(userDoc)?.familyId ?? null;

  const [requests, setRequests] = useState<StudyContactRequestDoc[] | null>(null);

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

                      {r.status === 'accepted' && (
                        <Link
                          to={`/family/search?subject=${encodeURIComponent(
                            r.subject,
                          )}&level=${encodeURIComponent(r.level)}`}
                          className="mt-3 inline-block text-xs font-semibold text-red-600 hover:underline"
                        >
                          {t('family.requests.viewContact')}
                        </Link>
                      )}
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}
