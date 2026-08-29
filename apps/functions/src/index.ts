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
export { doSubmitOffer } from './do/submitOffer.js';
export { doUpdateOffer } from './do/updateOffer.js';
export { doWithdrawOffer } from './do/withdrawOffer.js';
export { doDecideOfferAsGuardian } from './do/decideOfferAsGuardian.js';
export { doAcceptOffer } from './do/acceptOffer.js';
export { doDeclineOffer } from './do/declineOffer.js';
export { doGetAssignedContact } from './do/getAssignedContact.js';
export { doSubmitEndorsement } from './do/submitEndorsement.js';
export { doRespondToEndorsement } from './do/respondToEndorsement.js';
export { doStripTaskPhoto } from './do/stripTaskPhoto.js';
export { doGetOwnPhotoUrl } from './do/getOwnPhotoUrl.js';
export { doGetTaskPhotoUrl } from './do/getTaskPhotoUrl.js';
// The §10 board digest (plan §8's doSendTaskDigest row) — hourly batcher,
// per-recipient 6h rate limit via profiles.doer.lastDigestAt.
export { doSendTaskDigest } from './do/sendTaskDigest.js';
// Admin (§9.4): the two rows backing the Tasks tab in apps/web's EXISTING
// panel. sync-do grows no admin tree of its own, and this tab is the ONE
// sanctioned sit-side sync-do surface — admin tooling, not a member entry
// point, so decision 20's no-reachability constraint is untouched.
export { doAdminListTasks, doAdminDeleteTask } from './do/adminTasks.js';
// doSweepTasks (plan §8) is NOT a separate scheduled export: it rides the
// existing cleanupOldData schedule (runDoSweepTasks in ./do/sweepTasks.js),
// per the §8 row — one daily job, not two.
