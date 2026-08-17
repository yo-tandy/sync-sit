import { z } from 'zod';
import { SUBJECTS } from '../constants/subjects.js';
import { CLASS_LEVELS } from '../constants/classLevels.js';
import { LOCATION_PREFS } from '../constants/locationPrefs.js';

// ── Sub-schemas ──

const latLngSchema = z.object({
  // Bounded to valid geographic ranges; this also rejects ±Infinity, which
  // would otherwise yield NaN distances that silently defeat the radius cap.
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const searchFiltersSchema = z.object({
  // Legacy single-select form — kept for back-compat with older clients;
  // searchTutors normalizes it into the array form internally.
  locationPref: z.enum(LOCATION_PREFS).optional(),
  // Multi-select form (issue #167): the set of session-location TYPES the
  // family wants; a tutor matches when their prefs intersect it.
  locationPrefs: z.array(z.enum(LOCATION_PREFS)).max(LOCATION_PREFS.length).optional(),
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
  // Coverage-area label the client resolves from the family's search address
  // (postcode/city via @ejm/shared-core resolveAreaLabel) — an arrondissement
  // ('16e') or nearby-town name. Untrusted, display-agnostic filter input:
  // anything that is not a string of at most 30 chars is treated as ABSENT
  // (catch), never rejected — a malformed label must degrade to "no area
  // resolved", not break the whole search.
  areaLabel: z.string().max(30).optional().catch(undefined),
  filters: searchFiltersSchema.optional(),
});

export type SearchTutorsInput = z.infer<typeof searchTutorsSchema>;
