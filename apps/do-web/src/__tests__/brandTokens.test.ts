import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Drift guard for the sync-do brand ramp (plan §9.0 pins the exact values;
// mirrors study-web's brandTokens test for its own theme). Parses the theme
// CSS as text: these assertions pin source values, which is what the
// emitted builds resolve from.

function readTokens(file: string): Record<string, string> {
  const path = resolve(import.meta.dirname, '../../../../packages/shared-ui/src/theme', file);
  const css = readFileSync(path, 'utf8');
  const tokens: Record<string, string> = {};
  for (const m of css.matchAll(/--color-([a-z]+-\d+):\s*([^;]+);/g)) {
    tokens[m[1]] = m[2].split('/*')[0].trim();
  }
  return tokens;
}

describe('do brand ramp (§9.0)', () => {
  const tokens = readTokens('do.css');

  it('defines all brand stops 50-800', () => {
    for (const stop of [50, 100, 200, 300, 400, 500, 600, 700, 800]) {
      expect(tokens[`brand-${stop}`], `brand-${stop}`).toBeTruthy();
    }
  });

  it('pins the three owner-fixed greens: 500 icon green, 600 AA primary, 800 forest', () => {
    expect(tokens['brand-500']).toBe('#16ad05');
    expect(tokens['brand-600']).toBe('#0d8204');
    expect(tokens['brand-800']).toBe('#043f12');
  });

  it('matches the §9.0 ramp verbatim', () => {
    expect(tokens['brand-50']).toBe('#eefbe9');
    expect(tokens['brand-100']).toBe('#d8f5cd');
    expect(tokens['brand-200']).toBe('#b4ea9f');
    expect(tokens['brand-300']).toBe('#86da68');
    expect(tokens['brand-400']).toBe('#4cc72e');
    expect(tokens['brand-700']).toBe('#085c1c');
  });

  it('light tints 50/100/200/300 are four distinct values', () => {
    const values = ['brand-50', 'brand-100', 'brand-200', 'brand-300'].map((s) => tokens[s]);
    expect(new Set(values).size).toBe(4);
  });

  it('does not remap red-* (red means red in do, as in study)', () => {
    expect(Object.keys(tokens).filter((k) => k.startsWith('red-'))).toEqual([]);
  });
});
