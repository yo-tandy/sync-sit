import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, resolve, relative } from 'path';

/**
 * The tripwire for issue #497.
 *
 * `RESEND_API_KEY` used to be applied to Cloud Run services out of band, by a
 * hard-coded list of 11 service names in `scripts/fix-cloud-run-permissions.sh`.
 * Every email path added after that list was written ran without the key:
 * `getResend()` returned null and the mail was dropped behind a `[NO-RESEND]`
 * log line, with nothing failing. 109 of 120 services were missing it when this
 * was finally noticed — months of silently unsent mail.
 *
 * Declaring the key as a secret param fixes the 109; THIS TEST is what stops
 * the 110th. It recomputes, from the import graph, which deployed functions can
 * reach the mailer, and fails if any of them does not declare the param. A new
 * email path — or a new import that drags a notify helper into a function that
 * did not have one — is a red build, not a silent production regression.
 *
 * Deliberately a source-graph test, not a runtime one: the binding only has an
 * effect at DEPLOY time, so there is no runtime behaviour to assert. The thing
 * that can drift is the declaration, and that is what this reads.
 */

const ROOTS = [
  'apps/functions/src',
  'apps/study-functions/src',
  'packages/shared-functions/src',
];

/** Repo root, from this file at packages/shared-functions/src/config/__tests__/. */
const REPO = resolve(import.meta.dirname, '../../../../..');

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  (function walk(d: string) {
    for (const entry of readdirSync(d)) {
      const p = join(d, entry);
      if (statSync(p).isDirectory()) {
        if (!entry.includes('__tests__')) walk(p);
      } else if (p.endsWith('.ts') && !p.includes('.test.')) {
        out.push(relative(REPO, p));
      }
    }
  })(join(REPO, dir));
  return out;
}

/** Reaches the Resend client, or one of the send helpers built on it. */
const MAIL =
  /\bgetResend\s*\(|sendVerificationEmail|sendAccountExistsEmail|sendAdminNotification|sendNotificationEmail/;

/** Defines something Firebase actually deploys (and so can carry `secrets`). */
const DEPLOYED = /\b(onCall|onSchedule|onDocument\w+|onObjectFinalized|onRequest)\s*\(/;

describe('RESEND_API_KEY secret binding (#497)', () => {
  const files = ROOTS.flatMap(tsFiles);
  const src = new Map(files.map((f) => [f, readFileSync(join(REPO, f), 'utf8')]));

  // Transitive closure over relative imports: a function that calls a notify
  // helper needs the key just as much as one that calls the mailer itself.
  const reaches = new Set(files.filter((f) => MAIL.test(src.get(f)!)));
  for (let changed = true; changed; ) {
    changed = false;
    for (const f of files) {
      if (reaches.has(f)) continue;
      const deps = [...src.get(f)!.matchAll(/from\s+'(\.[^']+)'/g)]
        .map((m) =>
          relative(REPO, resolve(dirname(join(REPO, f)), m[1])).replace(/\.js$/, '.ts'),
        )
        .filter((p) => src.has(p));
      if (deps.some((d) => reaches.has(d))) {
        reaches.add(f);
        changed = true;
      }
    }
  }

  const needsSecret = [...reaches].filter((f) => DEPLOYED.test(src.get(f)!)).sort();

  it('finds the mailer-reaching functions at all (guards the guard)', () => {
    // If the seed regex or the walk ever stops matching, every assertion below
    // passes vacuously against an empty set. Pin a floor and two known members.
    expect(needsSecret.length).toBeGreaterThan(30);
    expect(needsSecret).toContain('packages/shared-functions/src/verification/submitVerification.ts');
    expect(needsSecret).toContain('apps/study-functions/src/sessions/bookSession.ts');
  });

  it('every deployed function that can reach the mailer declares the secret', () => {
    const missing = needsSecret.filter((f) => !/secrets:\s*\[[^\]]*RESEND_API_KEY/.test(src.get(f)!));
    expect(
      missing,
      `These deployed functions can reach the mailer but do not declare RESEND_API_KEY, so their `
        + `mail would be silently dropped in production (#497). Add `
        + `\`secrets: [RESEND_API_KEY]\` to each one's options:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  it('nothing declares the secret without importing the shared param', () => {
    // A stray `secrets: [RESEND_API_KEY]` with no import is a typecheck error
    // today, but only inside a codebase that is actually typechecked — pin it
    // here so the graph and the import stay in step.
    const declaring = files.filter((f) => /secrets:\s*\[[^\]]*RESEND_API_KEY/.test(src.get(f)!));
    const unimported = declaring.filter((f) => !/RESEND_API_KEY.*from\s+'[^']*secrets\.js'/s.test(src.get(f)!));
    expect(unimported).toEqual([]);
  });

  it('the retired hard-coded service list is gone from the ops script', () => {
    // The list this test replaces. If it comes back, the two sources of truth
    // can disagree again — which is the whole defect.
    const script = readFileSync(join(REPO, 'scripts/fix-cloud-run-permissions.sh'), 'utf8');
    // Comments SHOULD still name the key — the block left behind explains why
    // the re-apply is gone. What must not come back is executable code doing
    // it, so strip comment lines before asserting.
    const code = script
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('#'))
      .join('\n');
    expect(code).not.toMatch(/EMAIL_SVCS/);
    expect(code).not.toMatch(/RESEND_API_KEY/);
  });
});
