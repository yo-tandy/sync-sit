import { z } from 'zod';
import { SUBJECTS } from '../constants/subjects.js';
import { CLASS_LEVELS } from '../constants/classLevels.js';
import { LOCATION_PREFS } from '../constants/locationPrefs.js';

/**
 * Input for the publishTutorSearch callable (issue #207). Subject-first like
 * searchTutors, but deliberately WITHOUT latLng/areaLabel: the published doc's
 * area label is resolved server-side from the family doc's postcode/city —
 * the client never chooses what location signal gets broadcast.
 */
export const publishTutorSearchSchema = z.object({
  subject: z.enum(SUBJECTS, {
    errorMap: () => ({ message: 'Subject must be one of the supported subjects' }),
  }),
  level: z.enum(CLASS_LEVELS, {
    errorMap: () => ({ message: 'Level must be one of the supported class levels' }),
  }),
  locationPrefs: z.array(z.enum(LOCATION_PREFS)).max(LOCATION_PREFS.length).optional(),
  maxRate: z.number().positive('maxRate must be a positive number').optional(),
});

export type PublishTutorSearchInput = z.infer<typeof publishTutorSearchSchema>;
