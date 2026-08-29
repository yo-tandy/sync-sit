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

  it("does not claim a VITE_ variable is set by a workflow when it isn't", () => {
    // The specific error this file was written for. Any VITE_ name the doc
    // presents under "Set today" must genuinely appear in a workflow.
    const workflows = readdirSync(join(ROOT, '.github/workflows'))
      .filter((f) => /\.ya?ml$/.test(f))
      .map((f) => readFileSync(join(ROOT, '.github/workflows', f), 'utf8'))
      .join('\n');
    const setSection = doc.split('**Set today**')[1]?.split('**Read by the apps')[0] ?? '';
    expect(setSection, 'the "Set today" section should exist').not.toBe('');
    const claimed = [...setSection.matchAll(/`(VITE_[A-Z0-9_]+)`/g)].map((m) => m[1]);
    expect(claimed.length).toBeGreaterThan(0);
    const notActuallySet = claimed.filter((v) => !workflows.includes(v)).sort();
    expect(notActuallySet, 'doc claims these are set in a workflow; they are not').toEqual([]);
  });
});
