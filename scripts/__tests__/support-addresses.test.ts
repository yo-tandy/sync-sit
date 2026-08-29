import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * No app may publish a support address on a domain that does not receive mail.
 *
 * This regressed twice, silently, on live sites (issues #115 and #349):
 * study-web published support@sync-study.com and do-web published
 * support@sync-do.com, and NEITHER domain was ever connected. Nothing failed
 * -- the pages rendered, the mailto: link opened, the member typed a message,
 * and it bounced somewhere they never saw. There is no test a single app can
 * write that catches this, because from inside study-web
 * support@sync-study.com looks exactly right; it is only wrong relative to
 * which domains actually exist.
 *
 * The allowed set is deliberately tiny and deliberately not "looks like our
 * brand". Adding a domain here is a claim that it has MX records and is
 * verified with Resend -- make that claim only after checking, and see plan
 * docs/platform-plan.md §8 for the consolidation that should eventually
 * collapse this to one
 * entry that matches every brand.
 */
const RECEIVES_MAIL = new Set(['sync-sit.com']);

const APPS_DIR = resolve(__dirname, '../../apps');
const WEB_APPS = ['web', 'study-web', 'do-web'];

const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry) && !full.includes('__tests__')) out.push(full);
  }
  return out;
};

describe('published support addresses reach a mailbox that exists', () => {
  it.each(WEB_APPS)('%s declares SUPPORT_EMAIL on a domain that receives mail', (app) => {
    const src = readFileSync(join(APPS_DIR, app, 'src/constants/brand.ts'), 'utf8');
    const match = src.match(/export const SUPPORT_EMAIL\s*=\s*'([^']+)'/);
    expect(match, `${app}/src/constants/brand.ts must export SUPPORT_EMAIL`).not.toBeNull();
    const domain = match![1].split('@')[1];
    expect(
      RECEIVES_MAIL.has(domain),
      `${app} publishes support@${domain}, which does not receive mail. ` +
        `Point it at a domain in RECEIVES_MAIL, or add ${domain} only once it ` +
        `genuinely has MX records and Resend verification.`,
    ).toBe(true);
  });

  it('no app hardcodes a support address outside its brand constant', () => {
    // The constant is only a single point of change if everything reads it.
    // Both regressions above survived partly because study-web had THREE
    // copies: the constant, a redeclared literal in ReportProblemPage, and an
    // inline one in AboutPage -- so fixing the constant fixed neither page.
    const offenders: string[] = [];
    for (const app of WEB_APPS) {
      for (const file of walk(join(APPS_DIR, app, 'src'))) {
        if (file.endsWith('constants/brand.ts')) continue;
        const text = readFileSync(file, 'utf8');
        for (const m of text.matchAll(/support@[A-Za-z0-9.-]+/g)) {
          offenders.push(`${file.slice(APPS_DIR.length + 1)}: ${m[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
