import { z } from 'zod';
import { SUBJECTS } from '../constants/subjects.js';
import { CLASS_LEVELS } from '../constants/classLevels.js';

/**
 * Input for sendTutorContactRequest. The familyId is NEVER accepted from the
 * client — it is derived server-side from the caller's parent profile.
 */
export const sendTutorContactRequestSchema = z.object({
  tutorUserId: z.string().min(1, 'tutorUserId is required'),
  subject: z.enum(SUBJECTS, {
    errorMap: () => ({ message: 'Subject must be one of the supported subjects' }),
  }),
  level: z.enum(CLASS_LEVELS, {
    errorMap: () => ({ message: 'Level must be one of the supported class levels' }),
  }),
  message: z.string().max(1000, 'Message must be at most 1000 characters').optional(),
});

export type SendTutorContactRequestInput = z.infer<typeof sendTutorContactRequestSchema>;

/**
 * Input for respondToTutorContactRequest. Only the tutor who owns the request
 * may accept/decline it (enforced in the callable).
 */
export const respondTutorContactRequestSchema = z.object({
  requestId: z.string().min(1, 'requestId is required'),
  action: z.enum(['accept', 'decline'], {
    errorMap: () => ({ message: 'Action must be accept or decline' }),
  }),
});

export type RespondTutorContactRequestInput = z.infer<typeof respondTutorContactRequestSchema>;
