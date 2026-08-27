import { z } from 'zod';

/**
 * Input for the lookupTutor callable (issue #235, parity A2). `code` is a
 * tutor's PERSONAL CODE — 8 uppercase hex chars minted by
 * getTutorPersonalCode. Codes travel person-to-person (read aloud, pasted
 * from a chat message), so normalization is deliberately forgiving about how
 * a human relays one: lowercase, stray whitespace and dashes are all
 * stripped before matching. Anything that does not collapse to exactly 8 hex
 * chars is rejected up front as invalid-argument — a malformed code must
 * never reach the Firestore query, where it would burn a read only to
 * not-found anyway.
 */
export const lookupTutorSchema = z.object({
  code: z
    .string({ errorMap: () => ({ message: 'Code is required' }) })
    // Bound BEFORE the transform: the strip/uppercase pass must not become a
    // free normalization service for arbitrarily long junk strings.
    .max(64, 'Code is too long')
    .transform((raw) => raw.replace(/[\s-]/g, '').toUpperCase())
    .refine((code) => /^[0-9A-F]{8}$/.test(code), {
      message: 'Code must be 8 letters or digits',
    }),
});

export type LookupTutorInput = z.infer<typeof lookupTutorSchema>;
