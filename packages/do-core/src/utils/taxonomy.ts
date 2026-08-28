import type { SubCategoryDef, TaskCategory } from '../constants/categories.js';
import { SUB_CATEGORIES, TASK_CATEGORIES } from '../constants/categories.js';

/** Type guard: is this string one of the seven V1 categories (§5)? */
export function isTaskCategory(value: unknown): value is TaskCategory {
  return (
    typeof value === 'string' &&
    (TASK_CATEGORIES as readonly string[]).includes(value)
  );
}

/** The sub-category definitions of one category, in §5 order. */
export function getSubCategories(
  category: TaskCategory,
): readonly SubCategoryDef[] {
  return SUB_CATEGORIES.filter((s) => s.category === category);
}

/** Lookup by sub-category key ('ikea_assembly'); undefined when unknown. */
export function getSubCategoryDef(key: string): SubCategoryDef | undefined {
  return SUB_CATEGORIES.find((s) => s.key === key);
}

/**
 * Validates a task's (category, subCategory) pair: the category must be one
 * of the seven and the sub-category key must belong to it. Returns an error
 * message or null, like the other validators.
 */
export function validateCategoryPair(
  category: unknown,
  subCategory: unknown,
): string | null {
  if (!isTaskCategory(category)) {
    return 'category is not a sync-do category';
  }
  if (typeof subCategory !== 'string') {
    return 'subCategory must be a string';
  }
  const def = getSubCategoryDef(subCategory);
  if (!def || def.category !== category) {
    return 'subCategory does not belong to category';
  }
  return null;
}

/**
 * Does an offer on this sub-category need the §6.2 guardian gate for a
 * governed student? Unknown keys are treated as flagged — fail CLOSED: a
 * gate must never no-op silently on bad input.
 */
export function requiresGuardianConsent(subCategoryKey: string): boolean {
  const def = getSubCategoryDef(subCategoryKey);
  return def ? def.flags.guardianConsent === true : true;
}
