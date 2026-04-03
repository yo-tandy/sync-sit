/**
 * Sync/Sit — Cloud Functions
 *
 * All function exports are organized by domain.
 * Each module exports named functions that are registered with Firebase.
 */

// Auth
export { verifyEjmEmail } from './auth/verifyEjmEmail.js';
export { verifyParentEmail } from './auth/verifyParentEmail.js';
export { verifyCode } from './auth/verifyCode.js';

// Enrollment
export { enrollBabysitter } from './enrollment/enrollBabysitter.js';
export { enrollFamily } from './enrollment/enrollFamily.js';
export { generateInviteLink } from './enrollment/generateInviteLink.js';
export { joinFamily } from './enrollment/joinFamily.js';
export { removeCoParent } from './enrollment/removeCoParent.js';

// Search
export { searchBabysitters } from './search/searchBabysitters.js';
export { sendContactRequest } from './search/sendContactRequest.js';

// Appointments
export { respondToRequest } from './appointments/respondToRequest.js';
export { cancelAppointment } from './appointments/cancelAppointment.js';
export { modifyAppointment } from './appointments/modifyAppointment.js';
export { acknowledgeModification } from './appointments/acknowledgeModification.js';

// Verification
export { submitVerification } from './verification/submitVerification.js';
export { reviewVerification } from './verification/reviewVerification.js';
export { listPendingVerifications } from './verification/listPendingVerifications.js';
export { getVerificationStatus } from './verification/getVerificationStatus.js';
export { generateCommunityCode } from './verification/generateCommunityCode.js';
export { lookupCommunityCode } from './verification/lookupCommunityCode.js';
export { approveCommunityCode } from './verification/approveCommunityCode.js';

// Scheduled
export { sendReminders } from './scheduled/sendReminders.js';
export { cleanupOldData } from './scheduled/cleanupOldData.js';

// Admin
export { getAdminDashboard } from './admin/getAdminDashboard.js';
export { listUsers } from './admin/listUsers.js';
export { blockUser } from './admin/blockUser.js';
export { deleteUser } from './admin/deleteUser.js';
export { resetUserPassword } from './admin/resetUserPassword.js';
export { listAppointments } from './admin/listAppointments.js';
export { deleteAppointment } from './admin/deleteAppointment.js';
export { updateHolidays } from './admin/updateHolidays.js';
export { listAuditLogs } from './admin/listAuditLogs.js';
export { exportUserData } from './admin/exportUserData.js';
export { deactivateUser } from './admin/deactivateUser.js';
export { addPreapprovedEmail } from './admin/managePreapprovedEmails.js';
export { removePreapprovedEmail } from './admin/managePreapprovedEmails.js';
export { listPreapprovedEmails } from './admin/managePreapprovedEmails.js';
