import { z } from 'zod';

/**
 * Input for the lookupBabysitter callable (issue #437). `query` is free text
 * a parent already knows about the babysitter — a name, an email, or a phone
 * number — matched via @ejm/shared-core's matchesProviderIdentity. Bounded
 * BEFORE the trim so this cannot become a free normalization service for
 * arbitrarily long junk strings, and a 2-character floor keeps a single
 * keystroke from scanning the whole searchable population for a substring hit.
 */
export const lookupBabysitterSchema = z.object({
  query: z
    .string({ errorMap: () => ({ message: 'Search query is required' }) })
    .max(100, 'Search query is too long')
    .transform((raw) => raw.trim())
    .refine((q) => q.length >= 2, {
      message: 'Search query must be at least 2 characters',
    }),
});

export type LookupBabysitterInput = z.infer<typeof lookupBabysitterSchema>;
