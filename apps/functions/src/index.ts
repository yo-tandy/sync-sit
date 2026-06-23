/**
 * Sync/Sit — Cloud Functions
 *
 * All function exports are organized by domain.
 * Each module exports named functions that are registered with Firebase.
 */

// Shared — re-exported from @ejm/shared-functions
export {
  // Auth
  verifyEjmEmail,
  verifyParentEmail,
  verifyCode,
  // Enrollment (family-related)
  enrollFamily,
  generateInviteLink,
  joinFamily,
  validateInviteLink,
  removeCoParent,
  // Verification
  submitVerification,
  reviewVerification,
  listPendingVerifications,
  getVerificationStatus,
  generateCommunityCode,
  lookupCommunityCode,
  approveCommunityCode,
  getVerificationDocument,
  // Admin
  getAdminDashboard,
  listUsers,
  blockUser,
  deleteUser,
  resetUserPassword,
  updateHolidays,
  listAuditLogs,
  exportUserData,
  deactivateUser,
  migrateUsersToProfiles,
  addPreapprovedEmail,
  removePreapprovedEmail,
  listPreapprovedEmails,
} from '@ejm/shared-functions';

// Sync-sit-specific — stay in apps/functions
export { enrollBabysitter } from './enrollment/enrollBabysitter.js';
export { searchBabysitters } from './search/searchBabysitters.js';
export { sendContactRequest } from './search/sendContactRequest.js';
export { addPreferredBabysitter } from './family/addPreferredBabysitter.js';
export { removePreferredBabysitter } from './family/removePreferredBabysitter.js';
export { lookupBabysitter } from './family/lookupBabysitter.js';
export { respondToContactSharing } from './family/respondToContactSharing.js';
export { respondToRequest } from './appointments/respondToRequest.js';
export { cancelAppointment } from './appointments/cancelAppointment.js';
export { modifyAppointment } from './appointments/modifyAppointment.js';
export { acknowledgeModification } from './appointments/acknowledgeModification.js';
export { getParentContacts } from './appointments/getParentContacts.js';
export { resubmitAppointment } from './appointments/resubmitAppointment.js';
export { submitFamilyEndorsement } from './references/submitFamilyEndorsement.js';
export { acceptFamilyEndorsement } from './references/acceptFamilyEndorsement.js';
export { publishManualReference } from './references/publishManualReference.js';
export { notifyOnNewReference } from './references/onReferenceCreated.js';
export { sendReminders } from './scheduled/sendReminders.js';
export { cleanupOldData } from './scheduled/cleanupOldData.js';
export { listAppointments } from './admin/listAppointments.js';
export { deleteAppointment } from './admin/deleteAppointment.js';
