import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../config/firebase.js';
import { getCorsOrigin } from '../config/cors.js';
import { verifyAdmin } from './verifyAdmin.js';
import { writeAuditLog } from './writeAuditLog.js';

interface HolidayPeriod {
  name: string;
  startDate: string;
  endDate: string;
}

interface UpdateHolidaysInput {
  schoolYear: string;
  zone: string;
  periods: HolidayPeriod[];
}

/**
 * Write or update holiday periods for a given school year.
 */
export const updateHolidays = onCall(
  { region: 'europe-west1', cors: getCorsOrigin() },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in');
    }

    await verifyAdmin(request.auth.uid);

    const { schoolYear, zone, periods } = request.data as UpdateHolidaysInput;

    if (!schoolYear || !zone || !periods) {
      throw new HttpsError('invalid-argument', 'schoolYear, zone, and periods are required');
    }

    await db.collection('holidays').doc(schoolYear).set(
      {
        schoolYear,
        zone,
        periods,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    await writeAuditLog({
      adminUserId: request.auth.uid,
      action: 'update_holidays',
      details: { schoolYear, zone, periodCount: periods.length },
    });

    return { success: true };
  }
);
