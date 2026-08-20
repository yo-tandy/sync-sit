import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getParentProfile, type User } from '@ejm/shared-core';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';

/**
 * Load parent contact details for a given appointment.
 * Only the assigned babysitter can call this.
 */
export const getParentContacts = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    const uid = request.auth.uid;
    const { appointmentId } = request.data as { appointmentId: string };

    if (!appointmentId) {
      throw new HttpsError('invalid-argument', 'appointmentId is required');
    }

    // Verify the caller is the babysitter on this appointment
    const aptSnap = await db.collection('appointments').doc(appointmentId).get();
    if (!aptSnap.exists) {
      throw new HttpsError('not-found', 'Appointment not found');
    }

    const apt = aptSnap.data()!;
    if (apt.babysitterUserId !== uid) {
      throw new HttpsError('permission-denied', 'Only the assigned babysitter can view parent contacts');
    }
    // Being ON the appointment was a sufficient gate while only a FAMILY could
    // create one — they had already chosen this sitter. Published searches
    // (issue #207) let any active enrolled sitter mint a pending appointment
    // unilaterally, so that alone would hand out both parents' names, emails,
    // phones and WhatsApp before the family ever sees the request, and keep
    // working after a decline (the doc persists). Sitter-initiated
    // appointments therefore disclose contacts only once CONFIRMED — the same
    // consent boundary the address/latLng/pets/note already sit behind
    // (PR #212 review).
    if (apt.initiatedBy === 'babysitter' && apt.status !== 'confirmed') {
      throw new HttpsError(
        'permission-denied',
        'Parent contacts are available once the family accepts your request',
      );
    }

    // Load family and parent contacts
    const familySnap = await db.collection('families').doc(apt.familyId).get();
    if (!familySnap.exists) {
      return { contacts: [] };
    }

    const parentIds: string[] = familySnap.data()?.parentIds || [];
    const contacts: { firstName: string; lastName: string; email: string; phone?: string }[] = [];

    for (const pid of parentIds) {
      const pSnap = await db.collection('users').doc(pid).get();
      if (pSnap.exists) {
        const p = pSnap.data()!;
        // phone/whatsapp live on profiles.parent (Plan D).
        const parent = getParentProfile(p as User);
        contacts.push({
          firstName: p.firstName || '',
          lastName: p.lastName || '',
          email: p.email || '',
          ...(parent?.phone && { phone: parent.phone }),
          ...(parent?.whatsapp && { whatsapp: parent.whatsapp }),
        });
      }
    }

    return { contacts };
  }
);
