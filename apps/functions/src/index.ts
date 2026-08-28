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
  signOutEverywhere,
  // Enrollment (family-related)
  enrollFamily,
  generateInviteLink,
  joinFamily,
  validateInviteLink,
  removeCoParent,
  // Guardian (parental governance)
  createKidInvite,
  cancelKidInvite,
  resendKidInvite,
  redeemKidInvite,
  respondToSupervisionRequest,
  revokeSupervision,
  correctChildIdentity,
  getGovernedChildren,
  getGovernedChildDetail,
  guardianSetChildSearchable,
  listSupervisedAccounts,
  listAdminAlerts,
  reviewAdminAlert,
  forceRevokeSupervision,
  // Cross-app session handoff
  createAppHandoffCode,
  redeemAppHandoffCode,
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
  listFamilies,
  blockUser,
  correctUserIdentity,
  deleteUser,
  resetUserPassword,
  updateHolidays,
  listAuditLogs,
  exportUserData,
  deactivateUser,
  addPreapprovedEmail,
  removePreapprovedEmail,
  listPreapprovedEmails,
  // Admin-panel configuration (issue #250)
  getAdminConfig,
  updateAdminConfig,
} from '@ejm/shared-functions';

// Sync-sit-specific — stay in apps/functions
export { enrollBabysitter } from './enrollment/enrollBabysitter.js';
export { searchBabysitters } from './search/searchBabysitters.js';
export { sendContactRequest } from './search/sendContactRequest.js';
export { publishSearch } from './search/publishSearch.js';
export { contactPublishedSearch } from './search/contactPublishedSearch.js';
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
export { setAppointmentNote } from './appointments/setAppointmentNote.js';
export { submitFamilyEndorsement } from './references/submitFamilyEndorsement.js';
export { acceptFamilyEndorsement } from './references/acceptFamilyEndorsement.js';
export { publishManualReference } from './references/publishManualReference.js';
export { notifyOnNewReference } from './references/onReferenceCreated.js';
export { mirrorNotificationToGuardians } from './guardian/onNotificationCreated.js';
export { sendReminders } from './scheduled/sendReminders.js';
export { cleanupOldData } from './scheduled/cleanupOldData.js';
export { listAppointments } from './admin/listAppointments.js';
export { deleteAppointment } from './admin/deleteAppointment.js';
export {
  setEnrollmentExemption,
  removeEnrollmentExemption,
  listEnrollmentExemptions,
} from './admin/enrollmentExemptions.js';

// Sync-do — do-prefixed callables in this codebase per plan §3.2 (decision
// 11: an existing functions codebase, tie-broken to the one holding the
// nearest prior art). Domain code lives under src/do/**.
export { doEnrollDoer } from './do/enrollDoer.js';
export { doUpdateDoerProfile } from './do/updateDoerProfile.js';
export { doPostTask } from './do/postTask.js';
export { doUpdateTask } from './do/updateTask.js';
export { doCancelTask } from './do/cancelTask.js';
export { doMarkTaskDone } from './do/markTaskDone.js';
export { doStripTaskPhoto } from './do/stripTaskPhoto.js';
export { doGetOwnPhotoUrl } from './do/getOwnPhotoUrl.js';
export { doGetTaskPhotoUrl } from './do/getTaskPhotoUrl.js';
// doSweepTasks (plan §8) is NOT a separate scheduled export: it rides the
// existing cleanupOldData schedule (runDoSweepTasks in ./do/sweepTasks.js),
// per the §8 row — one daily job, not two.
