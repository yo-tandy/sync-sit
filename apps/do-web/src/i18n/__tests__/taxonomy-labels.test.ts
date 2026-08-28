import { describe, it, expect } from 'vitest';
import { SUB_CATEGORIES, TASK_CATEGORIES } from '@ejm/do-core';
import en from '../en';
import fr from '../fr';

/**
 * Drift guard between do-core's taxonomy (plan §4.3 — content, not schema)
 * and the app's labels: every category and sub-category key must have a
 * non-empty label in both locales, or a taxonomy addition would render raw
 * keys in the wizard. The reverse direction (orphan labels) is pinned too,
 * so a renamed key cannot leave its old label behind silently.
 */
describe('taxonomy label coverage', () => {
  for (const [lang, res] of [['en', en], ['fr', fr]] as const) {
    it(`${lang} labels every category`, () => {
      for (const cat of TASK_CATEGORIES) {
        expect((res.categories as Record<string, string>)[cat], `categories.${cat}`).toBeTruthy();
      }
    });

    it(`${lang} labels every sub-category, with no orphans`, () => {
      const labels = res.subcategories as Record<string, string>;
      const keys = SUB_CATEGORIES.map((s) => s.key);
      for (const key of keys) {
        expect(labels[key], `subcategories.${key}`).toBeTruthy();
      }
      const orphans = Object.keys(labels).filter((k) => !keys.includes(k));
      expect(orphans).toEqual([]);
    });
  }
});
