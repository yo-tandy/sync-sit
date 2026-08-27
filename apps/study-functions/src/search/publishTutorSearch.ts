import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getConfigValue } from '@ejm/shared-functions/config/adminConfig.js';
import { db } from '@ejm/shared-functions/config/firebase.js';
import { getCorsOrigin } from '@ejm/shared-functions/config/cors.js';
import { writeUserActivity } from '@ejm/shared-functions/admin/writeAuditLog.js';
import {
  getParentProfile,
  resolveAreaLabel,
  PUBLISHED_SEARCH_MAX_ACTIVE,
  PUBLISHED_SEARCH_TTL_DAYS,
} from '@ejm/shared-core';
import type { User } from '@ejm/shared-core';
import { publishTutorSearchSchema } from '../validation/publishSearch.js';

/**
 * publishTutorSearch (issue #207, study side): a verified family broadcasts a
 * tutoring search to the shared `publishedSearches` demand board, readable by
 * EVERY active, enrolled tutor — including ones not matching the search terms
 * or hidden from search (`searchable: false`); the widened audience is the
 * feature. PII stance mirrors the sit publish: area LABEL resolved
 * server-side from the family doc's postcode/city (never address/latLng).
 *
 * Study searches are subject-first with no date, so expiry is a flat 7 days.
 * No status field: active == exists && expiresAt > now (client filter + the
 * daily sweep + contact-time re-check). Withdraw is a rules-gated
 * owner-family client delete, not a callable.
 */
export const publishTutorSearch = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const uid = request.auth.uid;

    const parsed = publishTutorSearchSchema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError(
        'invalid-argument',
        parsed.error.issues[0]?.message || 'Invalid publish parameters',
      );
    }
    const { subject, level, locationPrefs, maxRate } = parsed.data;

    // ── Caller gate: parent with a fully-verified family (familyId derived
    // server-side, never from input — sendTutorContactRequest idiom) ──
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
    const expiresAt = new Date(now.getTime() + (await getConfigValue('publishedSearchTtlDays').catch(() => PUBLISHED_SEARCH_TTL_DAYS)) * 24 * 60 * 60 * 1000);

    // ── Cap: at most PUBLISHED_SEARCH_MAX_ACTIVE active docs per family per
    // app; expiry filtered in code so expired-but-unswept docs don't count. ──
    const activeSnap = await db.collection('publishedSearches')
      .where('familyId', '==', familyId)
      .where('app', '==', 'study')
      .get();
    const activeCount = activeSnap.docs.filter((d) => {
      const exp = d.data().expiresAt;
      const expMs = exp?.toMillis ? exp.toMillis() : exp?.toDate ? exp.toDate().getTime() : 0;
      return expMs > now.getTime();
    }).length;
    const maxActive = await getConfigValue('publishedSearchMaxActive').catch(() => PUBLISHED_SEARCH_MAX_ACTIVE);
    if (activeCount >= maxActive) {
      throw new HttpsError('resource-exhausted', 'Too many active published searches for this family');
    }

    // ── Area label — the ONLY location signal published. May be null. ──
    const areaLabel = resolveAreaLabel({
      postcode: (familyData.postcode as string | undefined) ?? undefined,
      city: (familyData.city as string | undefined) ?? undefined,
    });

    const ref = db.collection('publishedSearches').doc();
    await ref.set({
      id: ref.id,
      app: 'study',
      familyId,
      createdByUserId: uid,
      familyName: (familyData.familyName as string) || '',
      areaLabel,
      subject,
      level,
      locationPrefs: locationPrefs ?? [],
      maxRate: maxRate ?? null,
      createdAt: now,
      expiresAt,
    });

    await writeUserActivity(uid, 'search_published', { publishedSearchId: ref.id, app: 'study' });

    return { publishedSearchId: ref.id };
  },
);
