// Config (shared backend infrastructure)
export * from './config/firebase.js';
export * from './config/cors.js';
export * from './config/email.js';
export * from './config/push.js';
export * from './config/notifyParents.js';

// Admin leaves used cross-module
export * from './admin/writeAuditLog.js';
export * from './admin/verifyAdmin.js';

// Callables — auth
export { verifyEjmEmail } from './auth/verifyEjmEmail.js';
export { verifyParentEmail } from './auth/verifyParentEmail.js';
export { verifyCode } from './auth/verifyCode.js';

// Callables — enrollment (family-related only)
export { enrollFamily } from './enrollment/enrollFamily.js';
export { generateInviteLink } from './enrollment/generateInviteLink.js';
export { joinFamily } from './enrollment/joinFamily.js';
export { validateInviteLink } from './enrollment/validateInviteLink.js';
export { removeCoParent } from './enrollment/removeCoParent.js';

// Callables — verification
export { submitVerification } from './verification/submitVerification.js';
export { reviewVerification } from './verification/reviewVerification.js';
export { listPendingVerifications } from './verification/listPendingVerifications.js';
export { getVerificationStatus } from './verification/getVerificationStatus.js';
export { generateCommunityCode } from './verification/generateCommunityCode.js';
export { lookupCommunityCode } from './verification/lookupCommunityCode.js';
export { approveCommunityCode } from './verification/approveCommunityCode.js';
export { getVerificationDocument } from './verification/getVerificationDocument.js';

// Callables — admin
export { getAdminDashboard } from './admin/getAdminDashboard.js';
export { listUsers } from './admin/listUsers.js';
export { blockUser } from './admin/blockUser.js';
export { deleteUser } from './admin/deleteUser.js';
export { resetUserPassword } from './admin/resetUserPassword.js';
export { updateHolidays } from './admin/updateHolidays.js';
export { listAuditLogs } from './admin/listAuditLogs.js';
export { exportUserData } from './admin/exportUserData.js';
export { deactivateUser } from './admin/deactivateUser.js';
export {
  addPreapprovedEmail,
  removePreapprovedEmail,
  listPreapprovedEmails,
} from './admin/managePreapprovedEmails.js';
