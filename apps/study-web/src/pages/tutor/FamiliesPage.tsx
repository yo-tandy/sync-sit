import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import type { StudyContactRequestDoc } from '@ejm/study-core';
import { Card, Button, TopNav, Spinner, EmptyState, UsersIcon } from '@ejm/shared-ui';

/**
 * Tutor "My families" page — the study analogue of sync-sit's babysitter
 * FamiliesPage (apps/web/src/pages/babysitter/FamiliesPage.tsx).
 *
 * DATA-MODEL MAPPING: in study, "my families" = families the tutor has an
 * approved contact relationship with. The server truth is
 * profiles.tutor.approvedFamilies, which respondToTutorContactRequest builds
 * EXACTLY when a studyContactRequests doc flips to 'accepted' (same
 * transaction). The client-readable projection of that set — with display
 * fields — is therefore the tutor's own accepted request docs: rules let the
 * tutor read studyContactRequests where tutorUserId == me (same provable
 * equality query as RequestsPage), and each doc carries the denormalized
 * familyName / parentName. Filtering to status === 'accepted' client-side
 * mirrors the approvedFamilies gate one-to-one (sendTutorContactRequest blocks
 * new requests from already-approved families, so a family appears at most
 * once; we still dedupe defensively by familyId).
 *
 * CONTACT GATING: unlike sit (where the page toggles the babysitter's own
 * contact sharing), study's consent flows tutor → family: accepting a request
 * shares the TUTOR's contact details with the family. There is no revoke path
 * (respondToTutorContactRequest rejects non-pending requests), so this page is
 * read-only. Family-side contact details and kids are NOT readable by tutors
 * (families/{id} rules gate reads to family members/admin) and are never
 * rendered — only the denormalized name fields on the request doc, exactly
 * what sit's page shows.
 */
export function FamiliesPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { firebaseUser } = useAuthStore();
  const uid = firebaseUser?.uid ?? null;

  const [requests, setRequests] = useState<StudyContactRequestDoc[] | null>(null);
  // The subscription errored (e.g. PERMISSION_DENIED) — surfaced honestly,
  // never conflated with the empty state (RequestsPage idiom).
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!uid) return;
    const unsubscribe = onSnapshot(
      query(collection(db, 'studyContactRequests'), where('tutorUserId', '==', uid)),
      (snap) => {
        const rows = snap.docs.map((d) => d.data() as StudyContactRequestDoc);
        setLoadError(false);
        setRequests(rows);
      },
      () => setLoadError(true),
    );
    return unsubscribe;
  }, [uid]);

  const formatDate = (ts: StudyContactRequestDoc['createdAt'] | undefined): string => {
    const raw: unknown = ts;
    // Emulator-written rows can arrive as a plain Date; production Firestore
    // returns a Timestamp with .toDate(). Handle both, then fall back to ''
    // (mirrors RequestsPage).
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

  const sinceSeconds = (r: StudyContactRequestDoc): number =>
    r.respondedAt?.seconds ?? r.createdAt?.seconds ?? 0;

  // Approved families only — the accepted-request projection of
  // approvedFamilies. Deduped by familyId (defensive; see header comment),
  // newest relationship first.
  const families = (requests ?? [])
    .filter((r) => r.status === 'accepted')
    .sort((a, b) => sinceSeconds(b) - sinceSeconds(a))
    .filter((r, i, rows) => rows.findIndex((o) => o.familyId === r.familyId) === i);

  return (
    <div>
      <TopNav title={t('tutor.families.title')} backTo="/tutor" />

      <div className="px-5 pt-4 pb-8">
        <p className="mb-6 text-sm text-gray-500">{t('tutor.families.desc')}</p>

        {loadError && (
          <p className="py-10 text-center text-sm text-red-600">{t('tutor.families.loadError')}</p>
        )}

        {!loadError && requests === null && (
          <div className="flex justify-center py-20">
            <Spinner />
          </div>
        )}

        {!loadError && requests !== null && families.length === 0 && (
          <Card>
            <EmptyState
              icon={<UsersIcon className="h-6 w-6" />}
              message={t('tutor.families.empty')}
              actionLabel={t('tutor.families.emptyAction')}
              actionTo="/tutor/requests"
            />
          </Card>
        )}

        {families.length > 0 && (
          <div className="space-y-3">
            {families.map((r) => (
              <Card key={r.familyId}>
                <p className="text-sm font-semibold text-gray-900">{r.familyName}</p>
                <p className="text-xs text-gray-500">{r.parentName}</p>
                <p className="mt-1 text-xs text-gray-500">
                  {t(`tutor.subjects.names.${r.subject}`)} · {r.level}
                </p>
                <p className="mt-0.5 text-xs text-gray-500">
                  {t('tutor.families.since', { date: formatDate(r.respondedAt ?? r.createdAt) })}
                </p>
                {/* An approved relationship unlocks tutor-initiated proposals
                    (same CTA + route as RequestsPage history rows). */}
                <div className="mt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      navigate(`/tutor/propose/${r.familyId}`, {
                        state: {
                          familyName: r.familyName,
                          subject: r.subject,
                          level: r.level,
                        },
                      })
                    }
                  >
                    {t('tutor.sessions.propose.cta')}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
