import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { parse } from 'yaml';
import { checkTree, headingAnchors, slug } from '../check-markdown-links.mjs';

/**
 * The link checker, and the pins that keep it from becoming another green
 * light that measures nothing.
 *
 * WHY THIS EXISTS. PR #388 renamed a heading in docs/sync-do-project-plan.md
 * and orphaned the table-of-contents link pointing at it. Nothing noticed:
 * `.github/workflows/` had no markdown or link lint, the anchor still LOOKED
 * like a link, and a dead anchor degrades silently -- GitHub scrolls to the
 * top of the page instead of erroring, so a reader concludes the section is
 * gone rather than that the link is stale. It was caught by a human reading
 * the diff, which is not a control.
 *
 * The defect class is specifically THE ANCHOR, not the missing file: a
 * renamed heading with a stale `#...` fragment. A checker that only verified
 * that linked FILES exist would have passed that diff, so the anchor cases
 * below are the ones that carry the weight.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. External `http(s)` URLs are never
 * fetched. A network check fails on rate limits, transient outages and
 * link-shorteners, and a CI job that goes red for reasons unrelated to the
 * commit gets muted -- at which point it is worse than absent, because the
 * badge still says someone is watching.
 */

const repoRoot = resolve(__dirname, '../..');

/** Build a throwaway doc tree, run the checker over it, delete it. */
function withTree<T>(files: Record<string, string>, fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'linkcheck-'));
  try {
    for (const [name, body] of Object.entries(files)) {
      const full = join(dir, name);
      mkdirSync(resolve(full, '..'), { recursive: true });
      writeFileSync(full, body);
    }
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('slug() matches GitHub heading anchors', () => {
  // Each of these is a real heading shape from this repo's docs. The em dash
  // and the section sign are the interesting ones: both are stripped, and
  // the spaces around them collapse into the doubled hyphen that makes these
  // anchors look like typos when they are not.
  it.each([
    ['Project Overview', 'project-overview'],
    ['1. Project Overview', '1-project-overview'],
    ['18. Appendix A — the shared shell and the domain (moved)', '18-appendix-a--the-shared-shell-and-the-domain-moved'],
    ['2. §9.5 is superseded — the switcher is a bar', '2-95-is-superseded--the-switcher-is-a-bar'],
    ['Task & Offer Lifecycle', 'task--offer-lifecycle'],
    ['Firestore: Collections, Rules, Indexes', 'firestore-collections-rules-indexes'],
    ['`notifPrefs` shape', 'notifprefs-shape'],
  ])('%s -> %s', (heading, expected) => {
    expect(slug(heading)).toBe(expected);
  });

  it('disambiguates repeated headings the way GitHub does', () => {
    const anchors = headingAnchors('# Notes\n\n## Notes\n\n## Notes\n');
    expect([...anchors]).toEqual(['notes', 'notes-1', 'notes-2']);
  });
});

describe('the anchor case that actually happened', () => {
  it('fails when a heading is renamed out from under a link to it', () => {
    const broken = withTree(
      {
        'plan.md': [
          '# Plan',
          '',
          '1. [Appendix A](#18-appendix-a--the-shared-shell-issue-124)',
          '',
          '## 18. Appendix A — the shared shell and the domain (moved)',
          '',
        ].join('\n'),
      },
      (dir) => checkTree(dir),
    );

    expect(broken.problems).toHaveLength(1);
    expect(broken.problems[0]).toMatchObject({
      kind: 'dead-anchor',
      file: 'plan.md',
      target: '#18-appendix-a--the-shared-shell-issue-124',
    });
  });

  it('passes once the link is repointed at the new heading', () => {
    const fixed = withTree(
      {
        'plan.md': [
          '# Plan',
          '',
          '1. [Appendix A](#18-appendix-a--the-shared-shell-and-the-domain-moved)',
          '',
          '## 18. Appendix A — the shared shell and the domain (moved)',
          '',
        ].join('\n'),
      },
      (dir) => checkTree(dir),
    );

    expect(fixed.problems).toEqual([]);
    // The green must come from having looked, not from having found nothing
    // to look at -- see the "silently scans nothing" test below.
    expect(fixed.linksChecked).toBe(1);
  });
});

describe('cross-file links', () => {
  it('resolves an anchor into another file, and fails when that anchor is wrong', () => {
    const r = withTree(
      {
        'a.md': '# A\n\n[ok](b.md#section-two)\n[bad](b.md#section-three)\n',
        'b.md': '# B\n\n## Section two\n',
      },
      (dir) => checkTree(dir),
    );
    expect(r.problems.map((p) => p.kind)).toEqual(['dead-anchor']);
    expect(r.problems[0].target).toBe('b.md#section-three');
  });

  it('reports a link to a file that does not exist', () => {
    const r = withTree({ 'a.md': '# A\n\n[gone](./nope.md)\n' }, (dir) => checkTree(dir));
    expect(r.problems.map((p) => p.kind)).toEqual(['missing-file']);
  });

  it('accepts a link to a non-markdown file that exists', () => {
    const r = withTree(
      { 'a.md': '# A\n\n[script](run.sh)\n', 'run.sh': '#!/bin/sh\n' },
      (dir) => checkTree(dir),
    );
    expect(r.problems).toEqual([]);
  });
});

describe('what it must NOT flag', () => {
  it('never fetches external URLs', () => {
    const r = withTree(
      {
        'a.md': '# A\n\n[gh](https://github.com/yo-tandy/sync-sit/issues/99999999)\n[m](mailto:x@y.com)\n',
      },
      (dir) => checkTree(dir),
    );
    expect(r.problems).toEqual([]);
    expect(r.linksChecked).toBe(0);
  });

  it('ignores links inside fenced code blocks', () => {
    // Docs in this repo show markdown examples; a link in a ``` fence is
    // sample text, and flagging it would train people to ignore the job.
    const r = withTree(
      {
        'a.md': ['# A', '', '```markdown', '[example](#not-a-real-heading)', '```', ''].join('\n'),
      },
      (dir) => checkTree(dir),
    );
    expect(r.problems).toEqual([]);
    expect(r.linksChecked).toBe(0);
  });

  it('ignores links inside inline code spans', () => {
    const r = withTree({ 'a.md': '# A\n\nWrite it as `[text](#anchor)` in the TOC.\n' }, (dir) =>
      checkTree(dir),
    );
    expect(r.problems).toEqual([]);
    expect(r.linksChecked).toBe(0);
  });

  it('ignores image embeds', () => {
    const r = withTree({ 'a.md': '# A\n\n![shot](assets/nope.png)\n' }, (dir) => checkTree(dir));
    expect(r.problems).toEqual([]);
  });

  it('skips any URI scheme, not just the four that were once listed', () => {
    // These used to fall through to the relative-path branch and be reported
    // as `missing-file` — a false red, which is how a docs job gets muted.
    const r = withTree(
      {
        'a.md': '# A\n\n[e](vscode://file/x)\n[s](slack://open)\n[p](//example.com/x)\n',
      },
      (dir) => checkTree(dir),
    );
    expect(r.problems).toEqual([]);
    expect(r.linksChecked).toBe(0);
  });
});

describe('root-relative targets resolve against the scan root', () => {
  // `[x](/docs/plan.md)` is repo-root-relative in GitHub's renderer. Resolving
  // it against the FILESYSTEM root produced a confusing `missing-file` — or,
  // where that path happened to exist, silently read a file outside the
  // checkout.
  it('finds a file addressed from the root', () => {
    const r = withTree(
      {
        'docs/a.md': '# A\n\n[b](/docs/b.md#section-two)\n',
        'docs/b.md': '# B\n\n## Section two\n',
      },
      (dir) => checkTree(dir),
    );
    expect(r.problems).toEqual([]);
    expect(r.linksChecked).toBe(1);
  });

  it('still reports a dead anchor through a root-relative path', () => {
    const r = withTree(
      {
        'docs/a.md': '# A\n\n[b](/docs/b.md#nope)\n',
        'docs/b.md': '# B\n\n## Section two\n',
      },
      (dir) => checkTree(dir),
    );
    expect(r.problems.map((p) => p.kind)).toEqual(['dead-anchor']);
  });
});

describe('it must not pass by scanning nothing', () => {
  /**
   * The failure mode this repo keeps hitting: a job that is green because it
   * found no work. `.cjs` files were "linted" by a config that matched none
   * of them; `pnpm -r typecheck` skipped the package with no typecheck
   * script; the test job was absent entirely on stacked PRs while the rollup
   * read green. A link checker pointed at the wrong directory, or one whose
   * file walk quietly stopped matching `.md`, would report zero problems and
   * zero links and look identical to success.
   */
  it('is not ok on a tree with no markdown files at all', () => {
    const r = withTree({ 'notes.txt': 'nothing here' }, (dir) => checkTree(dir));
    expect(r.filesScanned).toBe(0);
    expect(r.scannedNothing).toBe(true);
    expect(r.ok).toBe(false);
    // ...and it says so WITHOUT inventing a broken link, so the two
    // conditions stay distinguishable in the output.
    expect(r.problems).toEqual([]);
  });

  it('is not ok when markdown exists but not one in-repo link was checked', () => {
    const r = withTree({ 'a.md': '# A\n\nProse only, no links.\n' }, (dir) => checkTree(dir));
    expect(r.filesScanned).toBe(1);
    expect(r.linksChecked).toBe(0);
    expect(r.scannedNothing).toBe(true);
    expect(r.ok).toBe(false);
  });

  it('is ok on a tree that has both files and links', () => {
    const r = withTree(
      { 'a.md': '# A\n\n[toc](#a)\n' },
      (dir) => checkTree(dir),
    );
    expect(r.scannedNothing).toBe(false);
    expect(r.ok).toBe(true);
  });
});

/**
 * COVERAGE of the real tree, deliberately NOT cleanliness of it.
 *
 * These assert that the walk still reaches the documentation — that a refactor
 * or a widened ignore list has not quietly shrunk what the checker sees, which
 * would make the CI job green for the worst possible reason. Every assertion
 * here survives a dead link on purpose: repo link CLEANLINESS is enforced in
 * exactly one place, the `docs-links` job, and asserting it here as well is
 * what silently re-created the release gate this PR removes (see the release
 * coupling test below).
 */
describe('the real repository is still in view', () => {
  const real = checkTree(repoRoot);

  it('actually scans the documentation tree', () => {
    // Floors, not exact counts, so adding documentation never fails a build.
    expect(real.filesScanned).toBeGreaterThan(50);
    expect(real.linksChecked).toBeGreaterThan(20);
  });

  it('reaches the plan docs specifically, not just the shallow ones', () => {
    expect(real.files).toContain('docs/sync-do-project-plan.md');
    expect(real.files).toContain('docs/platform-plan.md');
    expect(real.files).toContain('docs/sync-study-project-plan.md');
  });

  it('is looking at something, rather than reporting an empty scan', () => {
    expect(real.scannedNothing).toBe(false);
  });
});

describe('the CLI, which is what CI actually runs', () => {
  /**
   * These exist because the module API was entirely correct while the binary
   * was a NO-OP. `invokedDirectly` compared argv[1] against
   * `new URL(import.meta.url).pathname`, which is percent-encoded, so from a
   * checkout under a path with a space ("/Users/me/My Repos/sync-sit") the
   * guard was false, the CLI block never ran, and the command printed nothing
   * and exited 0. Twenty-six passing tests said nothing about it, because not
   * one of them ran the file as a program.
   *
   * A check whose own entry point is untested is precisely what this PR is
   * arguing against, so the entry point is tested — including from a
   * directory whose name contains a space, which is the case that failed.
   */
  const script = resolve(__dirname, '../check-markdown-links.mjs');

  const run = (dir: string) => {
    const r = spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  };

  it('exits 1 and names the offender on a dead anchor', () => {
    const r = withTree(
      { 'a.md': '# A\n\n[toc](#gone)\n\n## Still here\n' },
      (dir) => run(dir),
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('dead-anchor');
    expect(r.stderr).toContain('#gone');
  });

  it('exits 0 on a clean tree, and says what it looked at', () => {
    const r = withTree(
      { 'a.md': '# A\n\n[toc](#still-here)\n\n## Still here\n' },
      (dir) => run(dir),
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('checked 1 in-repo links');
  });

  it('exits 1 rather than passing quietly when there is nothing to check', () => {
    const r = withTree({ 'a.md': '# A\n\nProse only.\n' }, (dir) => run(dir));
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('covered nothing');
  });

  it('works from a directory whose path contains a space', () => {
    // The exact reproduction of the bug: before the fileURLToPath fix this
    // exited 0 with empty output on this input.
    const parent = mkdtempSync(join(tmpdir(), 'linkcheck-'));
    const dir = join(parent, 'My Repos');
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'a.md'), '# A\n\n[toc](#gone)\n');
      const r = run(dir);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('dead-anchor');
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});

describe('fenced blocks close on a matching delimiter', () => {
  it('does not let a ~~~ inside a ``` block end the block', () => {
    // The bug this pins: with interchangeable toggles, the `~~~` flipped the
    // state, so `## Real heading` below was treated as fenced content, its
    // anchor never registered, and the link to it reported dead.
    const r = withTree(
      {
        'a.md': [
          '# A',
          '',
          '```',
          'code with a ~~~ inside it',
          '```',
          '',
          '## Real heading',
          '',
          '[link](#real-heading)',
          '',
        ].join('\n'),
      },
      (dir) => checkTree(dir),
    );
    expect(r.problems).toEqual([]);
    expect(r.linksChecked).toBe(1);
  });

  it('closes a four-backtick fence only on four or more backticks', () => {
    const r = withTree(
      {
        'a.md': [
          '# A',
          '',
          '````',
          '```',
          'still inside',
          '```',
          '````',
          '',
          '## After',
          '',
          '[link](#after)',
          '',
        ].join('\n'),
      },
      (dir) => checkTree(dir),
    );
    expect(r.problems).toEqual([]);
    expect(r.linksChecked).toBe(1);
  });
});

describe('malformed input fails legibly rather than crashing', () => {
  it('does not throw URIError on a literal percent in a link target', () => {
    const r = withTree({ 'a.md': '# A\n\n[odd](./100%-done.md)\n' }, (dir) => checkTree(dir));
    expect(r.problems.map((p) => p.kind)).toEqual(['missing-file']);
  });
});

/**
 * THE PROPERTY THE RELEASE OPT-OUT IS ACTUALLY FOR.
 *
 * Skipping the `docs-links` job is not enough on its own, and the first
 * version of this PR shipped exactly that mistake: `release.yml` also runs the
 * `test` job unconditionally, that job runs `pnpm test:unit`, whose tail is
 * `vitest run --project scripts` — this file. While this file asserted
 * `checkTree(repoRoot).problems === []`, a dead anchor in a plan still failed
 * `verify_tests` and still blocked a tagged deploy, which is precisely the
 * hotfix-under-incident case the opt-out exists to prevent.
 *
 * The two YAML pins could not see it. They assert the `with:` and the `if:`
 * exist, and both did; the behaviour was broken anyway. A pin that both halves
 * satisfy while the outcome is unchanged is the thing this whole PR argues
 * against, so the property gets a test that exercises it end to end rather
 * than a third pin on the plumbing.
 *
 * It plants a dead anchor in `docs/` and runs the `scripts` project the way
 * the release path does, asserting it stays green. `LINKCHECK_META_CHILD`
 * stops the child re-entering this test.
 */
const IS_META_CHILD = process.env.LINKCHECK_META_CHILD === '1';

describe.skipIf(IS_META_CHILD)('a tagged release is not gated on documentation links', () => {
  // Cleanup runs in a `finally`, so an interrupted run can strand this file;
  // .gitignore carries the name so it can never be swept into a commit, and
  // the test below asserts that entry still matches. Same convention as
  // bundle-shared-for-deploy.test.ts's stray probe.
  const FIXTURE = 'docs/__linkcheck_releaseCouplingProbe.md';

  it('the scripts suite stays green while a doc in the tree has a dead anchor', () => {
    const fixture = resolve(repoRoot, FIXTURE);
    try {
      writeFileSync(fixture, '# Probe\n\n[dead](#no-such-anchor-anywhere)\n');

      // Sanity: the checker really does consider the tree broken right now.
      // Without this the test could pass because the fixture did nothing.
      const seen = checkTree(repoRoot);
      expect(seen.problems.some((p) => p.file === FIXTURE)).toBe(true);

      const child = spawnSync(
        resolve(repoRoot, 'node_modules/.bin/vitest'),
        ['run', '--project', 'scripts', 'markdown-links'],
        {
          cwd: repoRoot,
          encoding: 'utf8',
          env: { ...process.env, LINKCHECK_META_CHILD: '1', CI: '1' },
        },
      );

      expect(child.status).toBe(0);
    } finally {
      rmSync(fixture, { force: true });
    }
  });

  it('keeps the fixture name ignored, so an interrupted run cannot commit it', () => {
    const ignored = readFileSync(resolve(repoRoot, '.gitignore'), 'utf8');
    expect(ignored).toContain(FIXTURE);
  });
});

describe('CI wiring', () => {
  /**
   * Asserted against the parsed yaml rather than the file text, for the
   * reason release-workflow.test.ts gives: a regex over the source matches
   * the explanatory comments as readily as the config, and a pin that a
   * comment can satisfy is not a pin.
   */
  const workflow = parse(
    readFileSync(resolve(repoRoot, '.github/workflows/test.yml'), 'utf8'),
  ) as {
    jobs: Record<
      string,
      { if?: string; steps: { name?: string; run?: string; uses?: string }[] }
    >;
    permissions?: Record<string, string>;
  } & Record<string, unknown>;

  // `on:` parses to the boolean key `true` under YAML 1.1. The `yaml` package
  // defaults to the 1.2 core schema, where it stays the string `"on"`, so
  // reading `.on` works today — but release-workflow.test.ts reads both keys
  // deliberately so its pins do not hinge on the parser's schema version, and
  // there is no reason for the two workflow-pinning files to disagree.
  const triggers = (doc: Record<string, unknown>) =>
    (doc['on'] ?? doc[true as unknown as string]) as {
      workflow_call?: { inputs?: Record<string, { type?: string; default?: unknown }> };
    };

  it('runs the checker as its own job in the Tests workflow', () => {
    expect(Object.keys(workflow.jobs)).toContain('docs-links');
  });

  it('invokes the real script, not an inline reimplementation that can drift', () => {
    const runs = workflow.jobs['docs-links'].steps.map((s) => s.run ?? '').join('\n');
    expect(runs).toContain('scripts/check-markdown-links.mjs');
  });

  /**
   * The release path. release.yml calls test.yml via workflow_call, so every
   * job here also gates a tagged production deploy — including, without this,
   * a hotfix tag blocked by a dead link in a plan. The decoupling is only as
   * good as the two halves staying in sync, and both halves are silent when
   * they break: drop the `with:` and doc rot gates production again; drop the
   * `if:` and the input does nothing at all.
   */
  it('does not gate a tagged release on documentation links', () => {
    const release = parse(
      readFileSync(resolve(repoRoot, '.github/workflows/release.yml'), 'utf8'),
    ) as { jobs: Record<string, { with?: Record<string, unknown>; uses?: string }> };

    expect(release.jobs.verify_tests.uses).toBe('./.github/workflows/test.yml');
    expect(release.jobs.verify_tests.with?.skip_docs_links).toBe(true);
  });

  it('honours that opt-out with an if: on the job', () => {
    // Without this the input is inert and the `with:` above is decoration.
    expect(String(workflow.jobs['docs-links'].if)).toContain('skip_docs_links');
  });

  it('declares the input the release workflow passes', () => {
    // A workflow_call input that the callee does not declare is a hard error
    // at dispatch time, so this pins the pair rather than one side.
    const called = triggers(workflow).workflow_call?.inputs?.skip_docs_links;
    expect(called).toBeDefined();
    expect(called.default).toBe(false);
  });

  it('exposes the checker as a pnpm script so it can be run before pushing', () => {
    const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
    expect(pkg.scripts['docs:links']).toContain('scripts/check-markdown-links.mjs');
  });

  it('keeps the workflow read-only', () => {
    // The job needs the checkout and nothing else. Least privilege is set at
    // the workflow level, so a new job inherits it -- this pin fails if the
    // workflow-level block is ever dropped or widened.
    expect(workflow.permissions).toEqual({ contents: 'read' });
  });
});
