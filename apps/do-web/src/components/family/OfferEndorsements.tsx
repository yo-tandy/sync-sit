import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { Spinner } from '@ejm/shared-ui';
import {
  endorsementSources,
  toCrossAppEndorsement,
  PUBLIC_ENDORSEMENT_STATUSES,
  type CrossAppEndorsement,
} from '@ejm/shared-core';
import { db } from '@/config/firebase';

/** Origin label per sibling product; do labels only what is NOT its own. */
const ORIGIN_LABEL_KEY: Record<'sit' | 'study', string> = {
  sit: 'family.taskDetail.endorsementFromSit',
  study: 'family.taskDetail.endorsementFromStudy',
};

/** Per-source cap, the TutorCard precedent — an offer card is a summary,
 * not an archive. */
const PER_SOURCE_LIMIT = 10;

/**
 * The §9.1 offer-card endorsements: one query per registered product against
 * the shared `references` collection, keyed by that product's subject field
 * (the shared `endorsementSources` registry, issue #280 — sit and study read
 * the same registry, so a fourth product is one entry, not three edits) — and
 * each carries `where('status','in',['approved','published'])`, LOAD-BEARING:
 * the H2-hardened read rule grants an unrelated caller only the
 * public-status disjunct, provable only when the query constrains status.
 * Dropping it is PERMISSION_DENIED, and the wrong fix is widening the
 * rule (§9.1's warning, quoted from the plan). Served by the three
 * (key, status) composites from §7.3.
 *
 * Rendering order: sync-do's own endorsements FIRST, then sit's and
 * study's, each labeled with its origin app — a sit reference vouches for
 * babysitting, not wall-mounting; the label keeps cross-app signal honest.
 * A brand-new doer has none anywhere: the empty line is a starting state
 * (completed tasks EARN sync-do endorsements from PR11), rendered
 * gracefully rather than as an error.
 */
export function OfferEndorsements({ doerUserId }: { doerUserId: string }) {
  const { t } = useTranslation();
  const [lines, setLines] = useState<CrossAppEndorsement[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const sources = endorsementSources('do');
        const snaps = await Promise.all(
          sources.map(({ field }) =>
            getDocs(
              query(
                collection(db, 'references'),
                where(field, '==', doerUserId),
                where('status', 'in', PUBLIC_ENDORSEMENT_STATUSES),
                limit(PER_SOURCE_LIMIT),
              ),
            ),
          ),
        );
        if (cancelled) return;
        // Concatenated in source order, so sync-do's own entries lead.
        setLines(
          snaps.flatMap((snap, i) =>
            snap.docs.map((d) =>
              toCrossAppEndorsement(sources[i].app, d.id, d.data() as Record<string, unknown>),
            ),
          ),
        );
      } catch {
        if (!cancelled) setFailed(true);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [doerUserId]);

  if (failed) {
    return <p className="text-xs text-gray-400">{t('family.taskDetail.endorsementsError')}</p>;
  }
  if (lines === null) {
    return (
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Spinner className="h-3.5 w-3.5" />
      </div>
    );
  }
  if (lines.length === 0) {
    return <p className="text-xs text-gray-400">{t('family.taskDetail.endorsementsEmpty')}</p>;
  }

  return (
    <ul className="space-y-2">
      {lines.map((line) => (
        <li key={`${line.sourceApp}-${line.id}`} className="rounded-lg bg-gray-50 p-2.5">
          <p className="text-xs leading-relaxed text-gray-600">“{line.text}”</p>
          <p className="mt-1 text-[11px] text-gray-400">
            {line.refName && <span className="font-medium">{line.refName}</span>}
            {line.sourceApp !== 'do' && (
              <span className="ml-1.5 rounded bg-gray-200 px-1.5 py-0.5 font-medium text-gray-500">
                {t(ORIGIN_LABEL_KEY[line.sourceApp])}
              </span>
            )}
          </p>
        </li>
      ))}
    </ul>
  );
}
