/**
 * EJM Babysitter Coordinator — Cloud Functions
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

// Search
export { searchBabysitters } from './search/searchBabysitters.js';
export { sendContactRequest } from './search/sendContactRequest.js';

// Appointments
export { respondToRequest } from './appointments/respondToRequest.js';

// Scheduled
export { sendReminders } from './scheduled/sendReminders.js';
