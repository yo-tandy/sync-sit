import { describe, it, expect } from 'vitest';
import en from '../en';
import fr from '../fr';

/** Recursively collect dotted key paths from a nested translation object. */
function keyPaths(obj: unknown, prefix = ''): string[] {
  if (obj === null || typeof obj !== 'object') return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    keyPaths(v, prefix ? `${prefix}.${k}` : k),
  );
}

describe('i18n en/fr parity', () => {
  const enKeys = new Set(keyPaths(en));
  const frKeys = new Set(keyPaths(fr));

  it('fr has every en key', () => {
    const missing = [...enKeys].filter((k) => !frKeys.has(k));
    expect(missing).toEqual([]);
  });

  it('en has every fr key (no orphan fr keys)', () => {
    const missing = [...frKeys].filter((k) => !enKeys.has(k));
    expect(missing).toEqual([]);
  });

  it('no translation value is empty', () => {
    for (const [lang, res] of [['en', en], ['fr', fr]] as const) {
      const empties = keyPaths(res).filter((path) => {
        const val = path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], res);
        return typeof val === 'string' && val.trim() === '';
      });
      expect(empties, `${lang} has empty values`).toEqual([]);
    }
  });
});
