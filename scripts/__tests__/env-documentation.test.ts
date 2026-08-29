import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * docs/environments.md must describe the configuration that actually exists.
 *
 * This pin exists because the same mistake was made three times in one PR
 * (#374): a claim about configuration written from memory rather than from a
 * grep. The PR body cited a `.env.example` that `.gitignore` had swallowed;
 * the doc then said two `VITE_*` variables were set in `release.yml` when
 * nothing sets them. Prose drifts silently — nothing fails, and the next
 * person to stand up an environment follows a runbook that is wrong in
 * exactly the places they cannot check.
 */
const ROOT = resolve(__dirname, '../..');
const doc = readFileSync(join(ROOT, 'docs/environments.md'), 'utf8');

const walk = (dir: string): string[] => {
  let out: string[] = [];
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === 'dist') continue;
    const full = join(dir, e);
    if (statSync(full).isDirectory()) out = out.concat(walk(full));
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
};

describe('every functions codebase is configurable', () => {
  it('each codebase in firebase.json ships its own .env.example', () => {
    // The CLI loads .env/.env.<projectId> from each codebase's OWN source
    // directory, so one example file does not cover two codebases. A third
    // codebase added later would silently inherit the production fallbacks
    // for every link it builds — configuration missing in exactly the way
    // nothing fails (PR #374 round 4).
    const { existsSync } = require('node:fs') as typeof import('node:fs');
    const fb = JSON.parse(readFileSync(join(ROOT, 'firebase.json'), 'utf8')) as {
      functions?: { codebase?: string; source: string } | { codebase?: string; source: string }[];
    };
    const codebases = Array.isArray(fb.functions)
      ? fb.functions
      : fb.functions
        ? [fb.functions]
        : [];
    expect(codebases.length).toBeGreaterThan(0);
    const missing = codebases
      .filter((c) => !existsSync(join(ROOT, c.source, '.env.example')))
      .map((c) => `${c.codebase ?? 'default'} (${c.source})`);
    expect(missing, 'add a .env.example to each functions codebase').toEqual([]);
  });

  it('the runbook names every codebase an operator must configure', () => {
    const fb = JSON.parse(readFileSync(join(ROOT, 'firebase.json'), 'utf8')) as {
      functions?: { source: string } | { source: string }[];
    };
    const sources = (Array.isArray(fb.functions) ? fb.functions : [fb.functions!]).map(
      (c) => c.source,
    );
    const unnamed = sources.filter((src) => !doc.includes(src));
    expect(unnamed, 'docs/environments.md must name every functions source').toEqual([]);
  });
});

describe('docs/environments.md matches reality', () => {
  it('documents every VITE_ variable the apps actually read', () => {
    const read = new Set<string>();
    for (const app of ['web', 'study-web', 'do-web']) {
      for (const f of walk(join(ROOT, 'apps', app, 'src'))) {
        for (const m of readFileSync(f, 'utf8').matchAll(/import\.meta\.env\.(VITE_[A-Z0-9_]+)/g)) {
          read.add(m[1]);
        }
      }
    }
    expect(read.size).toBeGreaterThan(0);
    const undocumented = [...read].filter((v) => !doc.includes(v)).sort();
    expect(undocumented, 'add these to docs/environments.md').toEqual([]);
  });

  it('documents every app-host constant the server reads from the environment', () => {
    const email = readFileSync(
      join(ROOT, 'packages/shared-functions/src/config/email.ts'),
      'utf8',
    );
    // Only the exported CONFIGURATION constants -- the `export const X =
    // process.env.X ?? ...` shape. email.ts also reads FUNCTIONS_EMULATOR and
    // RESEND_API_KEY, which are runtime plumbing rather than per-environment
    // configuration and are deliberately out of this document's scope.
    const envVars = [
      ...email.matchAll(/export const [A-Z0-9_]+\s*=\s*process\.env\.([A-Z0-9_]+)/g),
    ].map((m) => m[1]);
    expect(envVars.length).toBeGreaterThan(0);
    const undocumented = envVars.filter((v) => !doc.includes(v)).sort();
    expect(undocumented, 'add these to docs/environments.md').toEqual([]);
  });

  it('names every committed .env file that sets a VITE_ variable', () => {
    // The hole in the previous version of this file: it checked workflow env:
    // blocks only, so it happily let the doc claim these vars were "set by
    // nothing" while three committed .env.development files set them for every
    // local dev run (PR #374 round 5). A source the test cannot see is a source
    // the doc will eventually get wrong.
    const { execSync } = require('node:child_process') as typeof import('node:child_process');
    const tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !f.endsWith('.example'));
    expect(tracked.length).toBeGreaterThan(0);

    const undocumented: string[] = [];
    for (const f of tracked) {
      const body = readFileSync(join(ROOT, f), 'utf8');
      const names = [...body.matchAll(/^(VITE_[A-Z0-9_]+)=/gm)].map((m) => m[1]);
      if (names.length === 0) continue;
      // The file itself must be named as a source, and each var documented.
      const base = f.split('/').pop()!;
      if (!doc.includes(base)) undocumented.push(`${f} (file not named in the doc)`);
      for (const n of names) if (!doc.includes(n)) undocumented.push(`${f}: ${n}`);
    }
    expect(undocumented, 'docs/environments.md must name these').toEqual([]);
  });

  it("does not claim a VITE_ variable is set by a workflow when it isn't", () => {
    // The specific error this file was written for. Any VITE_ name the doc
    // presents under "Set today" must genuinely appear in a workflow.
    const workflows = readdirSync(join(ROOT, '.github/workflows'))
      .filter((f) => /\.ya?ml$/.test(f))
      .map((f) => readFileSync(join(ROOT, '.github/workflows', f), 'utf8'))
      .join('\n');
    // Delimited by the NEXT bold heading rather than one specific phrase: the
    // previous version keyed on '**Read by the apps', and renaming that heading
    // silently widened the slice to the rest of the document.
    const after = doc.split('**Set today**')[1] ?? '';
    const setSection = after.split(/\n\*\*/)[0];
    expect(setSection, 'the "Set today" section should exist').not.toBe('');
    const claimed = [...setSection.matchAll(/`(VITE_[A-Z0-9_]+)`/g)].map((m) => m[1]);
    expect(claimed.length).toBeGreaterThan(0);
    const notActuallySet = claimed.filter((v) => !workflows.includes(v)).sort();
    expect(notActuallySet, 'doc claims these are set in a workflow; they are not').toEqual([]);
  });
});
