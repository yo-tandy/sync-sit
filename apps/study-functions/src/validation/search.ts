import { z } from 'zod';
import { SUBJECTS } from '../constants/subjects.js';
import { CLASS_LEVELS } from '../constants/classLevels.js';
import { LOCATION_PREFS } from '../constants/locationPrefs.js';

// ── Sub-schemas ──

const latLngSchema = z.object({
  lat: z.number(),
  lng: z.number(),
});

const searchFiltersSchema = z.object({
  locationPref: z.enum(LOCATION_PREFS).optional(),
  maxRate: z.number().positive('maxRate must be a positive number').optional(),
  maxDistanceKm: z.number().positive('maxDistanceKm must be a positive number').optional(),
});

/**
 * Input for the searchTutors callable. Subject-first: a search always targets
 * one subject at one class level; optional caller location enables distance
 * scoring, and optional filters narrow by session location, rate, and range.
 */
export const searchTutorsSchema = z.object({
  subject: z.enum(SUBJECTS, {
    errorMap: () => ({ message: 'Subject must be one of the supported subjects' }),
  }),
  level: z.enum(CLASS_LEVELS, {
    errorMap: () => ({ message: 'Level must be one of the supported class levels' }),
  }),
  latLng: latLngSchema.optional(),
  filters: searchFiltersSchema.optional(),
});

export type SearchTutorsInput = z.infer<typeof searchTutorsSchema>;
