import { useEffect, useState } from 'react';
import { collection, limit as fsLimit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { isActivePublishedSearch } from '@ejm/shared-core';

/**
 * The published-searches board doc as sit renders it (issue #207): the PII
 * the publish callable deliberately exposed — familyName, area LABEL,
 * schedule, kid ages, rate, additionalInfo — and nothing more (no
 * address/latLng/kid names exist on the doc at all).
 */
export interface BoardSearch {
  id: string;
  familyName: string;
  areaLabel: string | null;
  type: 'one_time' | 'recurring';
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  recurringSlots: { day: string; startTime: string; endTime: string }[] | null;
  schoolWeeksOnly: boolean;
  kidAges: number[];
  numberOfKids: number;
  offeredRate: number | null;
  additionalInfo: string | null;
  createdAt: { toMillis: () => number };
  expiresAt: { toMillis: () => number; toDate: () => Date };
}

/**
 * Live ACTIVE sit published searches, newest first — deliberately unfiltered
 * by the sitter's own availability or searchable flag (the board's point).
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
      where('app', '==', 'sit'),
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
