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
 *
 * FILE-GRANULAR, on purpose. Importing anything from a file that owns the
 * mailer counts as reaching it — `config/push.ts` pulls three URL constants
 * from `config/email.ts` and so every push-sending function is in the set
 * too, mail or no mail. The two failure modes are not symmetric: over-binding
 * mounts a secret a function never reads; under-binding is #497 again. So
 * the walk errs coarse, and the fix for a false positive is to bind, not to
 * teach the walk about symbols.
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

/** Where `@ejm/shared-functions/<sub>.js` and the bare barrel resolve to. */
const SHARED_SRC = 'packages/shared-functions/src';

function toTs(p: string): string {
  return p.replace(/\.js$/, '.ts');
}

const IDENT = /^[A-Za-z_$][\w$]*$/;

/** Names inside an import/export `{ … }` clause: comments stripped, `type` and `as` handled. */
function namesIn(clause: string, side: 'local' | 'exported'): string[] {
  return clause
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(',')
    .map((raw) => {
      const parts = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/);
      return side === 'exported' ? parts[parts.length - 1] : parts[0];
    })
    .filter((n) => IDENT.test(n));
}

/**
 * The barrel's export map: which source file each name re-exported from
 * `packages/shared-functions/src/index.ts` actually lives in. A deployed
 * function that does `import { SIT_APP_URL } from '@ejm/shared-functions'`
 * is one hop from `config/email.ts` — the file that owns the mailer — and
 * the walk has to see that hop, or the bare-barrel importers fall into the
 * same blind spot the package-absolute ones did (review on #501).
 */
function parseBarrel(index: string): { named: Map<string, string>; star: string[] } {
  const named = new Map<string, string>();
  const star: string[] = [];
  for (const m of index.matchAll(/export\s+\*\s+from\s+'(\.[^']+)'/g)) {
    star.push(`${SHARED_SRC}/${toTs(m[1].replace(/^\.\//, ''))}`);
  }
  for (const m of index.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'(\.[^']+)'/g)) {
    const file = `${SHARED_SRC}/${toTs(m[2].replace(/^\.\//, ''))}`;
    for (const name of namesIn(m[1], 'exported')) named.set(name, file);
  }
  return { named, star };
}

describe('RESEND_API_KEY secret binding (#497)', () => {
  const files = ROOTS.flatMap(tsFiles);
  const src = new Map(files.map((f) => [f, readFileSync(join(REPO, f), 'utf8')]));
  const barrel = parseBarrel(src.get(`${SHARED_SRC}/index.ts`)!);

  /** The star-exported barrel files that define `name` (all of them if none visibly does). */
  function starFilesDefining(name: string): string[] {
    const defines = new RegExp(
      `export\\s+(?:async\\s+)?(?:const|let|function|class|type|interface|enum)\\s+${name}\\b|export\\s*\\{[^}]*\\b${name}\\b`,
    );
    const hits = barrel.star.filter((f) => src.has(f) && defines.test(src.get(f)!));
    return hits.length > 0 ? hits : barrel.star;
  }

  /**
   * Every file `clause from 'spec'` in `f` can pull code from. Three shapes,
   * and the walk must follow all three (the first version followed only the
   * first — review on #501 found five functions hiding behind the other two):
   *   - `./x.js`                              relative, incl. `export * from` shims
   *   - `@ejm/shared-functions/config/x.js`   package-absolute subpath
   *   - `@ejm/shared-functions`               the barrel, resolved per imported name
   * Other packages (`@ejm/shared-core`, …) own no mailer and are not followed.
   */
  function depsOf(f: string): string[] {
    const out: string[] = [];
    for (const m of src.get(f)!.matchAll(/(?:import|export)\s+([^;]*?)\s+from\s+'([^']+)'/g)) {
      const [, clause, spec] = m;
      if (spec.startsWith('.')) {
        out.push(toTs(relative(REPO, resolve(dirname(join(REPO, f)), spec))));
      } else if (spec.startsWith('@ejm/shared-functions/')) {
        out.push(`${SHARED_SRC}/${toTs(spec.slice('@ejm/shared-functions/'.length))}`);
      } else if (spec === '@ejm/shared-functions') {
        const names = clause.match(/\{([^}]*)\}/);
        if (!names) {
          // `import * as sf` or a default: could be anything the barrel exports.
          out.push(...barrel.named.values(), ...barrel.star);
          continue;
        }
        for (const name of namesIn(names[1], 'local')) {
          const known = barrel.named.get(name);
          out.push(...(known ? [known] : starFilesDefining(name)));
        }
      }
    }
    return out.filter((p) => src.has(p));
  }

  // Transitive closure: a function that calls a notify helper needs the key
  // just as much as one that calls the mailer itself.
  const reaches = new Set(files.filter((f) => MAIL.test(src.get(f)!)));
  for (let changed = true; changed; ) {
    changed = false;
    for (const f of files) {
      if (reaches.has(f)) continue;
      if (depsOf(f).some((d) => reaches.has(d))) {
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

  it('follows package-absolute specifiers, re-export shims and bare-barrel names, not only relative imports', () => {
    // Each of these reaches the mailer ONLY through the import shape named --
    // the five the first walker missed (review on #501), grouped by cause.
    // package-absolute: `from '@ejm/shared-functions/config/notifyParents.js'`
    expect(needsSecret).toContain('apps/study-functions/src/sessions/proposeSession.ts');
    expect(needsSecret).toContain('apps/study-functions/src/scheduled/extendRecurring.ts');
    expect(needsSecret).toContain('apps/study-functions/src/contact/respondToTutorContactRequest.ts');
    expect(needsSecret).toContain('apps/study-functions/src/contact/sendFamilyContactRequest.ts');
    // shim: `../config/notifyParents.js` -> `export * from '@ejm/shared-functions/...'`
    expect(needsSecret).toContain('apps/functions/src/search/contactPublishedSearch.ts');
    // bare barrel: `import { SIT_APP_URL } from '@ejm/shared-functions'` lands in config/email.ts
    expect(barrel.star).toContain(`${SHARED_SRC}/config/email.ts`);
    expect(starFilesDefining('SIT_APP_URL')).toEqual([`${SHARED_SRC}/config/email.ts`]);
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
