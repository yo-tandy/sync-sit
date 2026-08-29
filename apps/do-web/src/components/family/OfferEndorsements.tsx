import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { Spinner } from '@ejm/shared-ui';
import {
  endorsementSources,
  endorsementLabelKey,
  toCrossAppEndorsement,
  ENDORSEMENT_PER_SOURCE_LIMIT,
  PUBLIC_ENDORSEMENT_STATUSES,
  type CrossAppEndorsement,
} from '@ejm/shared-core';
import { db } from '@/config/firebase';

/** i18n prefix for this surface's origin labels — see endorsementLabelKey. */
const ORIGIN_LABEL_PREFIX = 'family.taskDetail.endorsementFrom';

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
        // allSettled, not all: one failing source (an unbuilt sibling
        // composite, a transient error) must not take the other two down with
        // it. The error line below is now reserved for a TOTAL failure.
        //
        // Unlike sit's and study's cards there is no expand/collapse here, so
        // there is no retry trigger to preserve: this effect is keyed on
        // doerUserId and a partial result stands until the card remounts. That
        // predates this PR (the surface was already one-shot Promise.all) and
        // is not a regression — noting it so the next reader does not mistake
        // the absence of a completeness flag for an oversight.
        const settled = await Promise.allSettled(
          sources.map(({ field }) =>
            getDocs(
              query(
                collection(db, 'references'),
                where(field, '==', doerUserId),
                where('status', 'in', PUBLIC_ENDORSEMENT_STATUSES),
                limit(ENDORSEMENT_PER_SOURCE_LIMIT),
              ),
            ),
          ),
        );
        if (cancelled) return;
        if (settled.every((r) => r.status === 'rejected')) {
          setFailed(true);
          return;
        }
        // Concatenated in source order, so sync-do's own entries lead.
        setLines(
          settled.flatMap((r, i) =>
            r.status === 'fulfilled'
              ? r.value.docs.map((d) =>
                  toCrossAppEndorsement(sources[i].app, d.id, d.data() as Record<string, unknown>),
                )
              : [],
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
                {t(endorsementLabelKey(ORIGIN_LABEL_PREFIX, line.sourceApp))}
              </span>
            )}
          </p>
        </li>
      ))}
    </ul>
  );
}
