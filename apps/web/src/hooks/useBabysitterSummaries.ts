import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';
import type { BabysitterSummary } from '@ejm/sit-core';
import { formatBabysitterName } from '@/lib/formatName';

/**
 * Babysitter summaries for the family's appointment surfaces, keyed by uid.
 *
 * Shared by the landing page rows and /family/appointments so both name the
 * babysitter from the same source — the landing page used to show only the
 * date, so the two pages described the same appointment differently.
 *
 * One callable per batch of not-yet-requested uids (issue #529): no direct
 * users/{uid} read; `age` arrives computed and contact is present only when
 * this family is approved or has a confirmed appointment with the babysitter.
 * A uid the callable does not answer for falls back to the generic label.
 */
export function useBabysitterSummaries(uids: string[]): Record<string, BabysitterSummary> {
  const { t } = useTranslation();
  const [babysitters, setBabysitters] = useState<Record<string, BabysitterSummary>>({});
  // Requested once per uid, so overlapping list updates don't refire the batch.
  const requested = useRef<Set<string>>(new Set());
  const key = [...new Set(uids.filter(Boolean))].sort().join(',');

  useEffect(() => {
    const missing = key ? key.split(',').filter((uid) => !requested.current.has(uid)) : [];
    if (missing.length === 0) return;
    missing.forEach((uid) => requested.current.add(uid));

    const summarize = httpsCallable<{ uids: string[] }, { summaries: BabysitterSummary[] }>(
      functions,
      'getBabysitterSummaries',
    );
    summarize({ uids: missing })
      .then((res) => res?.data?.summaries ?? [])
      .catch(() => [] as BabysitterSummary[])
      .then((summaries) => {
        const byUid = new Map(summaries.map((s) => [s.uid, s]));
        const entries = missing.map((uid) => {
          const s = byUid.get(uid);
          if (s) {
            const info: BabysitterSummary = { ...s, name: formatBabysitterName(s.firstName, s.lastName) };
            return [uid, info] as [string, BabysitterSummary];
          }
          return [uid, { uid, firstName: '', lastName: '', name: t('familyDashboard.babysitterFallback') }] as [string, BabysitterSummary];
        });
        setBabysitters((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
      });
  }, [key]);

  return babysitters;
}
