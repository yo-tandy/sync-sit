import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * The three app-host constants (sync-do plan §18.9).
 *
 * Two properties matter and neither is visible by reading a call site:
 *
 * 1. **They are env-overridable.** A staging deployment whose emails link to
 *    production is worse than no staging: a tester clicks "View your
 *    appointment" and lands on real data. Firebase loads `.env.<projectId>`
 *    from the functions directory at deploy time, so the staging project sets
 *    these three and nothing else changes.
 * 2. **Nothing inlines a host any more.** The whole point of centralising is
 *    that the domain cutover is three lines; a single re-inlined literal
 *    silently reintroduces the 12-file sweep, and no other test would notice.
 *
 * The constants are module-level, so overriding means resetting the module
 * registry and re-importing rather than mutating after the fact.
 */
const ORIGINAL = { ...process.env };

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.resetModules();
});

describe('app host constants', () => {
  it('default to the live production hosts', async () => {
    delete process.env.SIT_APP_URL;
    delete process.env.STUDY_APP_URL;
    delete process.env.DO_APP_URL;
    const m = await import('../email.js');
    expect(m.SIT_APP_URL).toBe('https://sync-sit.com');
    expect(m.STUDY_APP_URL).toBe('https://sync-study-app.web.app');
    expect(m.DO_APP_URL).toBe('https://sync-do-app.web.app');
  });

  it('take their value from the environment when one is set', async () => {
    process.env.SIT_APP_URL = 'https://staging-sit.example';
    process.env.STUDY_APP_URL = 'https://staging-study.example';
    process.env.DO_APP_URL = 'https://staging-do.example';
    const m = await import('../email.js');
    expect(m.SIT_APP_URL).toBe('https://staging-sit.example');
    expect(m.STUDY_APP_URL).toBe('https://staging-study.example');
    expect(m.DO_APP_URL).toBe('https://staging-do.example');
  });

  it('carry the override into email copy, not just the constant', async () => {
    // The constant being overridable is worth nothing if a call site inlined
    // the host instead of building on it. Assert through the rendered email.
    process.env.SIT_APP_URL = 'https://staging-sit.example';
    const m = await import('../email.js');
    const { html } = m.buildAccountExistsEmail('sit');
    expect(html).toContain('https://staging-sit.example/login');
    // No LINK may point at production. The support ADDRESS
    // (support@sync-sit.com) legitimately remains: addresses are not
    // env-driven here, because moving them needs the new domain verified at
    // Resend with SPF and DKIM or the mail lands in spam (plan §18.9, #156).
    // Asserting on the scheme is what keeps those two apart.
    expect(html).not.toContain('https://sync-sit.com');
    expect(html).not.toContain('https://sync-sit.web.app');
    expect(html).toContain('support@sync-sit.com');
  });

  it('keep each app on its own host', async () => {
    process.env.SIT_APP_URL = 'https://s-sit.example';
    process.env.STUDY_APP_URL = 'https://s-study.example';
    process.env.DO_APP_URL = 'https://s-do.example';
    const m = await import('../email.js');
    expect(m.buildAccountExistsEmail('study').html).toContain('https://s-study.example/login');
    expect(m.buildAccountExistsEmail('do').html).toContain('https://s-do.example/login');
    // Cross-contamination is the failure this guards: one shared table, three
    // hosts, and a copy-paste puts a study reader on the sit host.
    expect(m.buildAccountExistsEmail('study').html).not.toContain('s-sit.example');
    expect(m.buildAccountExistsEmail('do').html).not.toContain('s-sit.example');
  });
});

describe('no server-side file re-inlines an app host', () => {
  it('the only production host literals are the three fallbacks', async () => {
    // The value of centralising is that the domain cutover is three lines. One
    // re-inlined literal silently restores the twelve-file sweep, and every
    // other test still passes — the exact silent-regression shape this file
    // exists for. Sources are scanned rather than call sites asserted, because
    // the next inlined host will be in a file that doesn't exist yet.
    //
    // Scope, stated so it isn't over-read: `roots` is a fixed list of the three
    // server trees that exist today. A FOURTH functions codebase (an
    // apps/do-functions, say) would not be scanned until it is added here.
    const { readdirSync, readFileSync, statSync } = await import('node:fs');
    const { join, resolve } = await import('node:path');

    const roots = [
      resolve(__dirname, '../../../../shared-functions/src'),
      resolve(__dirname, '../../../../../apps/functions/src'),
      resolve(__dirname, '../../../../../apps/study-functions/src'),
    ];
    const walk = (dir: string): string[] => {
      let out: string[] = [];
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry === '__tests__' || entry === 'node_modules') continue;
          out = out.concat(walk(full));
        } else if (/\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full)) {
          out.push(full);
        }
      }
      return out;
    };

    const HOST = /https:\/\/(sync-sit|sync-study-app|sync-do-app|sync-study|sync-do)[a-z0-9.-]*/g;
    const offenders: string[] = [];
    for (const root of roots) {
      // Deliberately NOT tolerant of a missing root. Swallowing the error let
      // this pass vacuously: rename apps/functions and the scan silently
      // covers two thirds of the surface while still reporting green -- the
      // same silent-regression shape the file exists to prevent, one level up.
      const files = walk(root);
      expect(files.length, `${root} should contain sources to scan`).toBeGreaterThan(0);
      for (const f of files) {
        const src = readFileSync(f, 'utf8');
        src.split('\n').forEach((line, i) => {
          // The three fallbacks are the sanctioned literals; comments are prose.
          if (/^\s*(\*|\/\/)/.test(line)) return;
          if (/(SIT|STUDY|DO)_APP_URL\s*=\s*process\.env/.test(line)) return;
          if (HOST.test(line)) offenders.push(`${f.split('/src/')[1]}:${i + 1}`);
          HOST.lastIndex = 0;
        });
      }
    }
    expect(offenders).toEqual([]);
  });
});
