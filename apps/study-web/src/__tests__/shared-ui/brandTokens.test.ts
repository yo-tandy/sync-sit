import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Drift guard for the shared-ui brand token ramps (issue #118).
// Parses the theme CSS as text: these assertions pin source values,
// which is what the emitted builds resolve from.

function readTokens(file: string): Record<string, string> {
  const path = resolve(__dirname, '../../../../../packages/shared-ui/src/theme', file);
  const css = readFileSync(path, 'utf8');
  const tokens: Record<string, string> = {};
  for (const m of css.matchAll(/--color-([a-z]+-\d+):\s*([^;]+);/g)) {
    tokens[m[1]] = m[2].trim();
  }
  return tokens;
}

const LIGHT_STOPS = ['brand-50', 'brand-100', 'brand-200', 'brand-300'];

describe.each([
  { app: 'sit', file: 'sit.css' },
  { app: 'study', file: 'study.css' },
])('$app brand ramp', ({ file }) => {
  it('defines all brand stops 50-800', () => {
    const tokens = readTokens(file);
    for (const stop of [50, 100, 200, 300, 400, 500, 600, 700, 800]) {
      expect(tokens[`brand-${stop}`], `brand-${stop}`).toBeTruthy();
    }
  });

  it('light tints 50/100/200/300 are four distinct values', () => {
    const tokens = readTokens(file);
    const values = LIGHT_STOPS.map((s) => tokens[s]);
    expect(new Set(values).size).toBe(4);
  });
});

describe('app primaries', () => {
  it('sit brand-600 is EJM red', () => {
    expect(readTokens('sit.css')['brand-600']).toBe('rgb(223, 26, 48)');
  });

  it('study brand-600 is study blue', () => {
    expect(readTokens('study.css')['brand-600']).toBe('#094ad4');
  });

  it('study.css no longer remaps red-* (red means red in study)', () => {
    const tokens = readTokens('study.css');
    expect(Object.keys(tokens).filter((k) => k.startsWith('red-'))).toEqual([]);
  });
});
