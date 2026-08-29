import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
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

  it('is ok on the real repository, which has both files and links', () => {
    const r = checkTree(repoRoot);
    expect(r.scannedNothing).toBe(false);
    expect(r.ok).toBe(true);
  });
});

describe('the real repository', () => {
  it('has no broken in-repo markdown links', () => {
    const r = checkTree(repoRoot);
    expect(r.problems).toEqual([]);
  });

  /**
   * Pins the scan surface. If a refactor moves docs, or the ignore list grows
   * a pattern that swallows docs/, these numbers drop toward zero and the job
   * above goes green for the wrong reason. Deliberately a floor rather than
   * an exact count, so adding documentation never fails the build.
   */
  it('actually scans the documentation tree', () => {
    const r = checkTree(repoRoot);
    expect(r.filesScanned).toBeGreaterThan(50);
    expect(r.linksChecked).toBeGreaterThan(20);
  });

  it('reaches the plan docs specifically, not just the shallow ones', () => {
    const r = checkTree(repoRoot);
    expect(r.files).toContain('docs/sync-do-project-plan.md');
    expect(r.files).toContain('docs/platform-plan.md');
    expect(r.files).toContain('docs/sync-study-project-plan.md');
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
    jobs: Record<string, { steps: { name?: string; run?: string; uses?: string }[] }>;
    permissions?: Record<string, string>;
  };

  it('runs the checker as its own job in the Tests workflow', () => {
    expect(Object.keys(workflow.jobs)).toContain('docs-links');
  });

  it('invokes the real script, not an inline reimplementation that can drift', () => {
    const runs = workflow.jobs['docs-links'].steps.map((s) => s.run ?? '').join('\n');
    expect(runs).toContain('scripts/check-markdown-links.mjs');
  });

  it('keeps the workflow read-only', () => {
    // The job needs the checkout and nothing else. Least privilege is set at
    // the workflow level, so a new job inherits it -- this pin fails if the
    // workflow-level block is ever dropped or widened.
    expect(workflow.permissions).toEqual({ contents: 'read' });
  });
});
