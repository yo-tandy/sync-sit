import { useEffect, useState } from 'react';
import { collection, limit as fsLimit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { isActivePublishedSearch } from '@ejm/shared-core';

/**
 * The published-searches board doc as STUDY renders it (issue #207): the PII
 * the tutor-search publish callable deliberately exposed — familyName, area
 * LABEL, subject and level, location preferences, max rate — and nothing
 * more (no address/latLng/kid names exist on the doc at all). Sit's board
 * doc carries a different field set; the two shapes are deliberately not
 * shared.
 */
export interface BoardSearch {
  id: string;
  familyName: string;
  areaLabel: string | null;
  subject: string;
  level: string;
  locationPrefs: string[] | null;
  maxRate: number | null;
  createdAt: { toMillis: () => number };
  expiresAt: { toMillis: () => number; toDate: () => Date };
}

/**
 * Live ACTIVE study published searches, newest first — deliberately unfiltered
 * by the tutor's own subjects or searchable flag (the board's point).
 * Shared by the dashboard preview (max 3) and the full board page, so the
 * two can never disagree about what "active" or "newest" means.
 *
 * `searches === null` means the first snapshot is still pending; `[]` with
 * `errored` set is the failure state, which callers render distinctly from a
 * genuinely empty board.
 */
export function usePublishedSearches(max: number): {
  searches: BoardSearch[] | null;
  errored: boolean;
} {
  const [searches, setSearches] = useState<BoardSearch[] | null>(null);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    const q = query(
      collection(db, 'publishedSearches'),
      where('app', '==', 'study'),
      orderBy('createdAt', 'desc'),
      fsLimit(max),
    );
    return onSnapshot(
      q,
      (snap) => {
        const now = Date.now();
        setSearches(
          snap.docs
            .map((d) => d.data() as BoardSearch)
            .filter((d) => isActivePublishedSearch(d, now)),
        );
        setErrored(false);
      },
      () => {
        setSearches([]);
        setErrored(true);
      },
    );
  }, [max]);

  return { searches, errored };
}
