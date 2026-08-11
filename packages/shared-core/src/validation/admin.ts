import { z } from 'zod';

/**
 * Input for the admin `listFamilies` callable. Mirrors listUsers's
 * search/filter/limit/startAfterId paging shape.
 */
export const listFamiliesInputSchema = z.object({
  searchQuery: z.string().max(200).optional(),
  statusFilter: z.enum(['active', 'deleted']).optional(),
  verifiedFilter: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).default(50),
  startAfterId: z.string().optional(),
});

export type ListFamiliesInput = z.infer<typeof listFamiliesInputSchema>;
