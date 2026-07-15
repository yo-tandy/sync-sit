import { z } from 'zod';
import { SUBJECTS } from '../constants/subjects.js';

/**
 * Input for submitTutorEndorsement. familyId is derived server-side from the
 * caller's parent profile; the relationship gate is the tutor's approvedFamilies
 * membership (an accepted contact request), so no familyId is accepted here.
 */
export const submitTutorEndorsementSchema = z.object({
  tutorUserId: z.string().min(1, 'tutorUserId is required'),
  referenceText: z.string().trim().min(10, 'Reference text too short (min 10 characters)'),
  refName: z.string().min(1, 'refName is required'),
  subject: z
    .enum(SUBJECTS, { errorMap: () => ({ message: 'Subject must be one of the supported subjects' }) })
    .optional(),
});

export type SubmitTutorEndorsementInput = z.infer<typeof submitTutorEndorsementSchema>;

/**
 * Input for respondToTutorEndorsement. Only the endorsed tutor may accept or
 * dismiss (enforced in the callable).
 */
export const respondTutorEndorsementSchema = z.object({
  referenceId: z.string().min(1, 'referenceId is required'),
  action: z.enum(['accept', 'dismiss'], {
    errorMap: () => ({ message: 'Action must be accept or dismiss' }),
  }),
});

export type RespondTutorEndorsementInput = z.infer<typeof respondTutorEndorsementSchema>;
