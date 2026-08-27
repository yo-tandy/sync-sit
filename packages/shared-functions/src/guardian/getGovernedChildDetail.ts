import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { ageFromDob } from '@ejm/shared-core';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { iso, requireActiveLinkParent } from './oversight.js';

/**
 * The full per-kid oversight view — ruling 8 of the governance design:
 * supervising parents see EVERYTHING, including pre/post session notes,
 * request messages, and lateCancellation flags. Consent-gated: an ACTIVE
 * link only (a pending claim grants nothing yet). Callable-based read —
 * no rules fan-out.
 *
 * List bound: sessions/appointments dated within the last 90 days plus
 * everything future or undated (recurring parents, dateless requests).
 */
export const getGovernedChildDetail = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }
    const { childUid } = request.data as { childUid?: string };
    if (!childUid || typeof childUid !== 'string') {
      throw new HttpsError('invalid-argument', 'childUid is required');
    }
    const { link } = await requireActiveLinkParent(request.auth.uid, childUid);

    const historyStart = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const inBound = (date: unknown) => typeof date !== 'string' || date >= historyStart;

    const [childSnap, scheduleSnap, overrideCountSnap] = await Promise.all([
      db.collection('users').doc(childUid).get(),
      db.collection('schedules').doc(childUid).get(),
      db.collection('schedules').doc(childUid).collection('overrides').count().get(),
    ]);
    const child = childSnap.data() ?? {};
    const dob = child.dateOfBirth?.toDate?.() ?? null;

    // All child-scoped queries are equality-only (single-field indexes) —
    // status/date bounds are applied in memory over one child's docs.
    const [sessionsSnap, studyContactSnap, aptSnap, sitContactSnap, referencesSnap] =
      await Promise.all([
        db.collection('study-sessions').where('tutorUserId', '==', childUid).get(),
        db
          .collection('studyContactRequests')
          .where('tutorUserId', '==', childUid)
          .where('status', '==', 'pending')
          .get(),
        db.collection('appointments').where('babysitterUserId', '==', childUid).get(),
        db
          .collection('contactSharingRequests')
          .where('babysitterUserId', '==', childUid)
          .where('status', '==', 'pending')
          .get(),
        db.collection('references').where('babysitterUserId', '==', childUid).count().get(),
      ]);

    const sessions = await Promise.all(
      sessionsSnap.docs
        .filter((d) => inBound(d.data().date))
        .map(async (d) => {
          const s = d.data();
          // Recurring occurrences (with their own notes) ride along, bounded
          // the same way. One subcollection read per recurring session.
          let instances: Array<Record<string, unknown>> = [];
          if (s.type === 'recurring') {
            const instSnap = await db
              .collection('study-sessions')
              .doc(d.id)
              .collection('instances')
              .get();
            instances = instSnap.docs
              .filter((i) => inBound(i.data().date))
              .map((i) => {
                const inst = i.data();
                return {
                  instanceId: i.id,
                  date: inst.date,
                  startTime: inst.startTime,
                  endTime: inst.endTime,
                  status: inst.status,
                  statusReason: inst.statusReason ?? null,
                  cancellationReason: inst.cancellationReason ?? null,
                  lateCancellation: inst.lateCancellation === true,
                  preSessionNote: inst.preSessionNote ?? null,
                  postSessionNote: inst.postSessionNote ?? null,
                };
              })
              .sort((a, b) => String(a.date).localeCompare(String(b.date)));
          }
          return {
            sessionId: d.id,
            type: s.type,
            status: s.status,
            statusReason: s.statusReason ?? null,
            // Absent on legacy docs ⟹ family-initiated (shared-core contract).
            proposedBy: s.proposedBy ?? 'family',
            recurringSlots: s.recurringSlots ?? null,
            familyName: s.familyName ?? null,
            subject: s.subject ?? null,
            level: s.level ?? null,
            rate: s.rate ?? null,
            location: s.location ?? null,
            date: s.date ?? null,
            startTime: s.startTime ?? null,
            endTime: s.endTime ?? null,
            message: s.message ?? null,
            preSessionNote: s.preSessionNote ?? null,
            postSessionNote: s.postSessionNote ?? null,
            lateCancellation: s.lateCancellation === true,
            cancellationReason: s.cancellationReason ?? null,
            createdAt: iso(s.createdAt),
            instances,
          };
        }),
    );

    const appointments = aptSnap.docs
      .filter((d) => inBound(d.data().date))
      .map((d) => {
        const a = d.data();
        return {
          appointmentId: d.id,
          type: a.type,
          status: a.status,
          statusReason: a.statusReason ?? null,
          familyName: a.familyName ?? null,
          date: a.date ?? null,
          startTime: a.startTime ?? null,
          endTime: a.endTime ?? null,
          offeredRate: a.offeredRate ?? null,
          lateCancellation: a.lateCancellation === true,
          message: a.message ?? null,
          additionalInfo: a.additionalInfo ?? null,
          cancellationReason: a.cancellationReason ?? null,
          createdAt: iso(a.createdAt),
        };
      });

    return {
      child: {
        childUid,
        firstName: child.firstName ?? null,
        lastName: child.lastName ?? null,
        photoUrl: child.photoUrl ?? null,
        email: child.email ?? null,
        status: child.status ?? null,
        age: dob ? ageFromDob(dob) : null,
        dateOfBirth: dob ? dob.toISOString().slice(0, 10) : null,
        identityLocked: child.identityLocked === true,
      },
      link: {
        status: link.status,
        origin: link.origin,
        requestedAt: iso(link.requestedAt),
        confirmedAt: iso(link.confirmedAt),
        consent: {
          tosVersion: link.consent?.tosVersion ?? null,
          privacyVersion: link.consent?.privacyVersion ?? null,
          supervisionAgreementVersion: link.consent?.supervisionAgreementVersion ?? null,
          approvedAt: iso(link.consent?.approvedAt),
        },
      },
      // Ruling 8: the FULL provider profiles, not summaries.
      providerProfiles: {
        babysitter: child.profiles?.babysitter ?? null,
        tutor: child.profiles?.tutor ?? null,
      },
      schedule: {
        weekly: scheduleSnap.data()?.weekly ?? null,
        overrideCount: overrideCountSnap.data().count,
      },
      study: {
        sessions: sessions.sort((a, b) => String(a.date).localeCompare(String(b.date))),
        contactRequests: studyContactSnap.docs.map((d) => {
          const r = d.data();
          return {
            requestId: d.id,
            status: r.status,
            // Who OPENED it (issue #207 PR4). A request the kid sent by
            // answering a published search cannot be DECLINED -- the callable
            // refuses that -- so the guardian page needs to tell the two
            // apart and offer a withdraw instead. Absent means family.
            initiatedBy: r.initiatedBy === 'tutor' ? 'tutor' : null,
            familyName: r.familyName ?? null,
            parentName: r.parentName ?? null,
            subject: r.subject ?? null,
            level: r.level ?? null,
            message: r.message ?? null,
            createdAt: iso(r.createdAt),
          };
        }),
      },
      sit: {
        appointments,
        contactSharingRequests: sitContactSnap.docs.map((d) => {
          const r = d.data();
          return {
            requestId: d.id,
            status: r.status,
            familyName: r.familyName ?? null,
            parentName: r.parentName ?? null,
            createdAt: iso(r.createdAt),
          };
        }),
      },
      counts: {
        references: referencesSnap.data().count,
        endorsements: child.profiles?.tutor?.endorsementCount ?? 0,
      },
    };
  },
);
