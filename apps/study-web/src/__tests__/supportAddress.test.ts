import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SUPPORT_EMAIL } from '@/constants/brand';

/**
 * The published support address must be reachable, and must come from one
 * place (issue #115).
 *
 * The failure this guards is not a crash: `support@sync-study.com` rendered
 * perfectly and every test passed. sync-study.com simply has no NS and no MX
 * records, so mail to it bounces — the documented way to reach support from
 * Sync/Study was a dead end, on three separate pages, and nothing in the
 * codebase could tell.
 *
 * A test cannot resolve DNS, so it pins the next best thing: the address sits
 * on a domain this project actually operates and receives mail on, and no file
 * re-declares its own copy. The three copies are how the address outlived the
 * domain in two of them.
 */

// Domains with working MX that this project controls. sync-study.com and
// sync-do.com are deliberately ABSENT: both are unregistered (#115, #349).
// Adding one here is a claim that its MX exists — check before you do.
const DELIVERABLE_DOMAINS = ['sync-sit.com'];

describe('study support address', () => {
  it('is on a domain that can actually receive mail', () => {
    const domain = SUPPORT_EMAIL.split('@')[1];
    expect(
      DELIVERABLE_DOMAINS,
      `${SUPPORT_EMAIL} is on ${domain}, which is not a domain we receive mail on`,
    ).toContain(domain);
  });

  it('is not re-declared anywhere in the app', () => {
    const src = resolve(__dirname, '..');
    const walk = (dir: string): string[] => {
      let out: string[] = [];
      for (const e of readdirSync(dir)) {
        if (e === 'node_modules') continue;
        const full = join(dir, e);
        if (statSync(full).isDirectory()) out = out.concat(walk(full));
        else if (/\.tsx?$/.test(full)) out.push(full);
      }
      return out;
    };
    const offenders = walk(src).filter((f) => {
      if (f.endsWith('constants/brand.ts')) return false; // the one definition
      return readFileSync(f, 'utf8')
        .split('\n')
        .some((line) => !/^\s*(\*|\/\/)/.test(line) && /support@[a-z0-9.-]+/i.test(line));
    });
    expect(
      offenders.map((f) => f.split('/src/')[1]),
      'build the address from @/constants/brand instead of re-declaring it',
    ).toEqual([]);
  });
});
