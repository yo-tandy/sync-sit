import { describe, it, expect } from 'vitest';
import {
  resolveE2eBaseUrl,
  devServerPort,
  parseE2eApp,
  parseE2eLane,
  E2E_LANE1_DEV_PORTS,
} from '../../tests-e2e/lanes.js';

/**
 * The Playwright half of issue #358: E2E_APP/E2E_LANE pick the dev server a
 * spec drives, so a browser-driven run can target its own lane instead of
 * lane 1's shared dev stack. Lives in the `scripts` vitest project because
 * tests-e2e/ itself belongs to Playwright, which must not run this.
 */
describe('resolveE2eBaseUrl', () => {
  it('defaults to lane-1 sit — the historical hardcoded base URL', () => {
    expect(resolveE2eBaseUrl({})).toBe('http://localhost:5173');
  });

  it('PLAYWRIGHT_BASE_URL still wins over everything', () => {
    expect(
      resolveE2eBaseUrl({
        PLAYWRIGHT_BASE_URL: 'http://localhost:4321',
        E2E_APP: 'do',
        E2E_LANE: '3',
      }),
    ).toBe('http://localhost:4321');
  });

  it('picks the app on lane 1 when only E2E_APP is set', () => {
    expect(resolveE2eBaseUrl({ E2E_APP: 'do' })).toBe('http://localhost:5175');
    expect(resolveE2eBaseUrl({ E2E_APP: 'study' })).toBe('http://localhost:5174');
  });

  it('shifts the dev port by +100 per lane', () => {
    expect(resolveE2eBaseUrl({ E2E_APP: 'do', E2E_LANE: '3' })).toBe(
      'http://localhost:5375',
    );
    expect(resolveE2eBaseUrl({ E2E_APP: 'sit', E2E_LANE: '2' })).toBe(
      'http://localhost:5273',
    );
  });

  it('accepts the workspace names as aliases', () => {
    expect(parseE2eApp('do-web')).toBe('do');
    expect(parseE2eApp('study-web')).toBe('study');
    expect(parseE2eApp('web')).toBe('sit');
  });

  it('rejects an unknown app or lane rather than falling back to lane 1', () => {
    expect(() => parseE2eApp('doweb')).toThrow('E2E_APP');
    expect(() => parseE2eLane('0')).toThrow('E2E_LANE');
    expect(() => parseE2eLane('7')).toThrow('E2E_LANE');
    expect(() => parseE2eLane('three')).toThrow('E2E_LANE');
  });

  it('lane-1 ports match the apps vite.config.ts server ports', () => {
    // apps/web 5173, apps/study-web 5174, apps/do-web 5175.
    expect(E2E_LANE1_DEV_PORTS).toEqual({ sit: 5173, study: 5174, do: 5175 });
    expect(devServerPort('sit', 1)).toBe(5173);
  });
});
