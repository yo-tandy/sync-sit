import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getConfigValue } from '@ejm/shared-functions/config/adminConfig.js';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { writeUserActivity } from '../admin/writeAuditLog.js';
import { getParentProfile } from '@ejm/sit-core';
import type { User } from '@ejm/sit-core';
import {
  resolveAreaLabel,
  PUBLISHED_SEARCH_MAX_ACTIVE,
  PUBLISHED_SEARCH_TTL_DAYS,
} from '@ejm/shared-core';
import { parisWallTimeToUtc } from '@ejm/shared-functions/scheduled/parisTime.js';

interface PublishSearchData {
  type: 'one_time' | 'recurring';
  // One-time
  date?: string;
  startTime?: string;
  endTime?: string;
  // Recurring
  recurringSlots?: { day: string; startTime: string; endTime: string }[];
  schoolWeeksOnly?: boolean;
  // Common
  kidIds: string[];
  offeredRate?: number;
  additionalInfo?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * publishSearch (issue #207, sit side): a verified family broadcasts a
 * babysitting search to the `publishedSearches` demand board, readable by
 * EVERY active babysitter — including ones unavailable for the search terms
 * or hidden from search (`searchable: false`); that widened audience is the
 * feature, so the doc is scrubbed accordingly: area LABEL only (never
 * address/latLng), kid AGES only (never names), ages re-derived server-side
 * from the family's kid docs.
 *
 * Expiry is server-computed: one_time searches live until
 * min(now + 7d, end of the babysitting day, Paris wall clock) — the owner's
 * "up to a week, and for babysitting no longer than the babysitting date";
 * recurring searches live 7 days. There is no status field: active == exists
 * && expiresAt > now (client filter + daily sweep + contact-time re-check).
 * Withdraw is a rules-gated owner-family client delete, not a callable.
 */
export const publishSearch = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;
    const data = request.data as PublishSearchData;

    // ── Input validation (sit house style: manual guards) ──
    if (data.type !== 'one_time' && data.type !== 'recurring') {
      throw new HttpsError('invalid-argument', 'type must be one_time or recurring');
    }
    if (!Array.isArray(data.kidIds) || data.kidIds.length === 0 || !data.kidIds.every((k) => typeof k === 'string')) {
      throw new HttpsError('invalid-argument', 'kidIds must be a non-empty string array');
    }
    // Dedupe + bound: duplicates would inflate numberOfKids/kidAges (and the
    // PR3 appointment minted from them); 10 matches the other input bounds.
    data.kidIds = [...new Set(data.kidIds)];
    if (data.kidIds.length > 10) {
      throw new HttpsError('invalid-argument', 'too many kids');
    }
    if (data.offeredRate !== undefined && (typeof data.offeredRate !== 'number' || data.offeredRate < 0 || data.offeredRate > 1000)) {
      throw new HttpsError('invalid-argument', 'offeredRate out of range');
    }
    if (data.additionalInfo !== undefined && (typeof data.additionalInfo !== 'string' || data.additionalInfo.length > 1000)) {
      throw new HttpsError('invalid-argument', 'additionalInfo too long');
    }
    if (data.type === 'one_time') {
      if (!data.date || !DATE_RE.test(data.date) || !data.startTime || !TIME_RE.test(data.startTime) || !data.endTime || !TIME_RE.test(data.endTime)) {
        throw new HttpsError('invalid-argument', 'one_time searches need date, startTime and endTime');
      }
      // Shape regexes pass '2026-13-45' and '25:99' — bound to the calendar
      // and the clock so junk stays on the 400 path (PR #210 review).
      const roundTrip = new Date(`${data.date}T00:00:00Z`);
      if (Number.isNaN(roundTrip.getTime()) || roundTrip.toISOString().slice(0, 10) !== data.date) {
        throw new HttpsError('invalid-argument', 'date is not a calendar date');
      }
      for (const t of [data.startTime, data.endTime]) {
        const [hh, mm] = t!.split(':').map(Number);
        if (hh > 23 || mm > 59) {
          throw new HttpsError('invalid-argument', 'time out of range');
        }
      }
    } else {
      const slots = data.recurringSlots;
      if (!Array.isArray(slots) || slots.length === 0) {
        throw new HttpsError('invalid-argument', 'recurring searches need at least one slot');
      }
      if (slots.length > 21) { // 7 days x up to 3 windows — same bound family as the other inputs
        throw new HttpsError('invalid-argument', 'too many recurring slots');
      }
      for (const s of slots) {
        if (!s || !DAY_KEYS.includes(s.day) || !TIME_RE.test(s.startTime || '') || !TIME_RE.test(s.endTime || '')) {
          throw new HttpsError('invalid-argument', 'invalid recurring slot');
        }
      }
    }

    // ── Caller gate: parent with a fully-verified family (familyId derived
    // server-side from the caller's own profile, never from input) ──
    const callerDoc = await db.collection('users').doc(uid).get();
    const callerParent = getParentProfile(callerDoc.data() as User | undefined);
    if (!callerParent || !callerParent.familyId) {
      throw new HttpsError('permission-denied', 'Only parents can publish searches');
    }
    const familyId = callerParent.familyId;
    const familyDoc = await db.collection('families').doc(familyId).get();
    const familyData = familyDoc.data();
    if (!familyData?.verification?.isFullyVerified) {
      throw new HttpsError('permission-denied', 'Family verification required before publishing a search');
    }

    const now = new Date();

    // ── Expiry: min(now + 7d, end of the babysitting day) for one_time;
    // 7d flat for recurring. Already-past one_time searches are rejected. ──
    const ttlMs = (await getConfigValue('publishedSearchTtlDays')) * 24 * 60 * 60 * 1000;
    let expiresAt = new Date(now.getTime() + ttlMs);
    if (data.type === 'one_time') {
      // End times at/after midnight (the picker's 00:00-02:00 "following
      // day" options) belong to the NEXT calendar day: an endTime that is
      // not after startTime crosses midnight, so the sitting ends 24h later
      // than the naive wall-time conversion says. Without this, a same-day
      // 20:00-01:00 sitting is rejected as already past, and a future one
      // expires the search ~24h before the sitting starts (PR #210 review).
      let sittingEnd = parisWallTimeToUtc(data.date!, data.endTime!);
      if (data.endTime! <= data.startTime!) {
        sittingEnd = new Date(sittingEnd.getTime() + 24 * 60 * 60 * 1000);
      }
      if (sittingEnd.getTime() <= now.getTime()) {
        throw new HttpsError('invalid-argument', 'The babysitting date is already past');
      }
      if (sittingEnd.getTime() < expiresAt.getTime()) {
        expiresAt = sittingEnd;
      }
    }

    // ── Cap: at most PUBLISHED_SEARCH_MAX_ACTIVE active docs per family per
    // app. Equality-only query (no composite needed beyond the familyId index);
    // expiry filtered in code — expired-but-unswept docs must not count. ──

    // ── Kid ages re-derived server-side from the family's kid docs; unknown
    // kidIds are rejected rather than silently dropped. ──
    const kidAges: number[] = [];
    for (const kidId of data.kidIds) {
      const kidSnap = await db.collection('families').doc(familyId).collection('kids').doc(kidId).get();
      if (!kidSnap.exists) {
        throw new HttpsError('invalid-argument', 'Unknown kid in kidIds');
      }
      kidAges.push(kidSnap.data()!.age as number);
    }

    // ── Area label from the family doc's postcode/city — the ONLY location
    // signal published (never address, never latLng). May be null. ──
    const areaLabel = resolveAreaLabel({
      postcode: (familyData.postcode as string | undefined) ?? undefined,
      city: (familyData.city as string | undefined) ?? undefined,
    });

    const ref = db.collection('publishedSearches').doc();
    const docBody = {
      id: ref.id,
      app: 'sit',
      familyId,
      createdByUserId: uid,
      familyName: (familyData.familyName as string) || '',
      areaLabel,
      type: data.type,
      date: data.type === 'one_time' ? data.date : null,
      startTime: data.type === 'one_time' ? data.startTime : null,
      endTime: data.type === 'one_time' ? data.endTime : null,
      recurringSlots: data.type === 'recurring'
        ? data.recurringSlots!.map(({ day, startTime, endTime }) => ({ day, startTime, endTime }))
        : null,
      schoolWeeksOnly: data.type === 'recurring' ? !!data.schoolWeeksOnly : false,
      kidIds: data.kidIds,
      kidAges,
      numberOfKids: data.kidIds.length,
      offeredRate: data.offeredRate ?? null,
      additionalInfo: data.additionalInfo?.trim() || null,
      createdAt: now,
      expiresAt,
    };

    // Cap check + create in ONE transaction so two concurrent publishes
    // cannot both pass the count (PR #210 review). The Admin SDK supports
    // queries inside transactions; expiry is still filtered in code so
    // expired-but-unswept docs never count against the cap.
    await db.runTransaction(async (tx) => {
      const activeSnap = await tx.get(
        db.collection('publishedSearches')
          .where('familyId', '==', familyId)
          .where('app', '==', 'sit'),
      );
      const activeCount = activeSnap.docs.filter((d) => {
        const exp = d.data().expiresAt;
        const expMs = exp?.toMillis ? exp.toMillis() : exp?.toDate ? exp.toDate().getTime() : 0;
        return expMs > now.getTime();
      }).length;
      const maxActive = await getConfigValue('publishedSearchMaxActive');
      if (activeCount >= maxActive) {
        throw new HttpsError('resource-exhausted', 'Too many active published searches for this family');
      }
      tx.set(ref, docBody);
    });

    await writeUserActivity(uid, 'search_published', { publishedSearchId: ref.id, app: 'sit' });

    return { publishedSearchId: ref.id };
  }
);
