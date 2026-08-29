#!/usr/bin/env node
/**
 * Verify every in-repo markdown link — relative paths AND `#anchor`
 * fragments — actually resolves.
 *
 * The defect this exists for: a heading gets renamed, and the
 * table-of-contents link pointing at it keeps rendering as a link while
 * silently going nowhere. GitHub does not error on a dead fragment; it
 * scrolls to the top of the page, so the reader concludes the SECTION is
 * gone rather than that the LINK is stale. That happened in PR #388, in a
 * 2600-line plan whose table of contents is how anyone finds anything, and
 * nothing in CI could have caught it: there was no markdown or link lint.
 *
 * Anchors are therefore the point. A checker that only verified linked files
 * exist would have passed that diff unchanged.
 *
 * NOT CHECKED, deliberately:
 *   - external http(s) URLs. Fetching them makes the job fail on rate limits
 *     and transient outages, and a job that goes red for reasons unrelated to
 *     the commit gets muted — worse than absent, because the badge still
 *     claims someone is watching.
 *   - reference-style links (`[text][label]`) and bare autolinks. This repo
 *     does not use them.
 *   - titled destinations (`[x](y "title")`) and angle-bracket destinations
 *     (`[x](<y>)`). The destination regex stops at the first space or `)`,
 *     so a titled link is currently skipped rather than mis-parsed, and an
 *     angle-bracket one would carry its brackets into the path.
 *   - setext headings (`Title` underlined with `===` or `---`). Every heading
 *     in this repo is ATX (`#`), so no anchor is missed today.
 *   - any target carrying a URI scheme (`scheme:`) or protocol-relative
 *     (`//host/x`). Only relative paths and `#fragment`s are in scope.
 *   - where a `../` target resolves. A link may point above the scan root and
 *     will be checked there; the checker only ever compares heading slugs and
 *     never emits file contents, so this is a scope note rather than a leak.
 *   - fences indented four or more spaces — the normal indent for a code block
 *     nested in a list item. `fenceTracker` matches `^\s{0,3}` before the
 *     delimiter, so such a block is not tracked and its contents are read as
 *     prose. Latent rather than active: content at that indent is itself
 *     indented, so `^#{1,6}` cannot match a heading inside it either, and none
 *     of the three docs that currently have one contains a link. A markdown
 *     example inside a nested list item WOULD be flagged.
 *   - `.gitignore`. The walk skips a fixed IGNORED_DIRS set, not whatever git
 *     ignores, so the two lists have to be kept in step by hand.
 *
 * That list is exhaustive on purpose. The point of a check like this is that
 * silence means "looked and found nothing", so anything it does NOT look at
 * has to be written down — otherwise the next person reads a green run as a
 * guarantee it never made.
 *
 * Usage: node scripts/check-markdown-links.mjs [root]
 *        pnpm docs:links
 * Exit 0 when clean, 1 when anything is broken OR when the scan covered
 * nothing (see `scannedNothing`).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Directories the walk never enters.
 *
 * `_worktrees` and `.agents` are here because this repo gitignores both and
 * both routinely hold another branch's markdown. CI never sees them — the
 * runner checkout is clean — but the README advertises `pnpm docs:links` as
 * "the same check CI runs", so a developer with an agent worktree parked in
 * `_worktrees/` would get failures for files that are not in the repo, from a
 * command documented as reproducing CI. A false red is how a check gets muted,
 * which is the outcome this script exists to argue against.
 *
 * Not derived from `.gitignore`: that would need a matcher for its full
 * syntax, and getting it subtly wrong shrinks what the checker sees, which is
 * the one failure mode worth more than a few false positives. Kept in step by
 * hand, and the docstring's NOT CHECKED list says so.
 */
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.claude',
  'coverage',
  '_worktrees',
  '.agents',
]);

/**
 * GitHub's heading-to-anchor transform: lowercase, drop everything that is
 * not a letter, number, space, hyphen or underscore, then spaces to hyphens.
 *
 * The dropped characters are why anchors in this repo carry doubled hyphens —
 * `A — b` loses the em dash but keeps both surrounding spaces, giving `a--b`.
 * That looks like a typo and is not; leaving it out is the single easiest way
 * to write a checker that reports false failures on correct links.
 */
export function slug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/**
 * Track fenced code blocks the way CommonMark does: a fence closes only on a
 * run of the SAME character that is at least as long as the one that opened
 * it.
 *
 * Treating ``` and ~~~ as interchangeable toggles — which the first version
 * of this did — means a `~~~` sample inside a ``` block flips the state and
 * every line after it is misclassified: real links stop being checked and
 * real headings stop producing anchors, so the file reports false
 * `dead-anchor`s while silently skipping the rest. "Silently stops checking"
 * is exactly what this script exists to prevent, so it must not do it itself.
 *
 * Returns a fence tracker: call `.toggle(line)`, then read `.inFence`.
 */
function fenceTracker() {
  let open = null; // { char, len }
  return {
    get inFence() {
      return open !== null;
    },
    /** @returns true when this line is a fence delimiter (open or close). */
    toggle(line) {
      const m = /^\s{0,3}(`{3,}|~{3,})\s*(.*)$/.exec(line);
      if (!m) return false;
      const char = m[1][0];
      const len = m[1].length;
      if (open === null) {
        // An opening fence may carry an info string; a closing one may not.
        open = { char, len };
        return true;
      }
      if (char === open.char && len >= open.len && m[2].trim() === '') {
        open = null;
        return true;
      }
      // A shorter run, a different character, or an info string inside a
      // block is just content.
      return false;
    },
  };
}

/** Every anchor a rendered markdown document exposes, in document order. */
export function headingAnchors(text) {
  const anchors = new Set();
  const seen = new Map();
  const fence = fenceTracker();

  for (const line of text.split('\n')) {
    if (fence.toggle(line)) continue;
    if (fence.inFence) continue;

    const m = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;

    const base = slug(m[1]);
    if (!base) continue;
    // GitHub suffixes repeats: `notes`, `notes-1`, `notes-2`.
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    anchors.add(n === 0 ? base : `${base}-${n}`);
  }
  return anchors;
}

/**
 * Strip the spans where a `[text](target)` is prose rather than a link:
 * fenced blocks and inline code. Replaced with blank lines rather than
 * removed so reported line numbers still match the file.
 */
function maskNonLinkSpans(text) {
  const fence = fenceTracker();
  return text.split('\n').map((line) => {
    if (fence.toggle(line)) return '';
    if (fence.inFence) return '';
    return line.replace(/`[^`]*`/g, '');
  });
}

/**
 * `decodeURIComponent` throws `URIError` on a malformed escape, so a single
 * link containing a literal `%` would abort the whole run with a stack trace.
 * A percent sign in a path is far more likely than a percent-escape here, so
 * fall back to the raw string rather than failing the file.
 */
function tryDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * `withFileTypes` reads the entry type from the directory record instead of
 * a `statSync` per entry: one syscall fewer per file, and — the reason that
 * matters here — it does NOT follow symlinks, so a symlinked directory cycle
 * cannot send this into infinite recursion.
 */
function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) out.push(full);
  }
  return out;
}

/**
 * Check every markdown file under `root`.
 *
 * Returns `{ ok, problems, files, filesScanned, linksChecked }`. `ok` is
 * false when a link is broken AND when the run covered nothing — a scan that
 * found no files, or found files but not one in-repo link, is not a pass. It
 * is the shape every silently-empty check in this repo took: the lint job
 * whose config matched none of the `.cjs` files it claimed to cover, the
 * `pnpm -r typecheck` that skipped the package without the script, the test
 * job that was absent on stacked PRs while the rollup still read green.
 */
export function checkTree(root) {
  const absRoot = resolve(root);
  const files = walk(absRoot);
  const anchorCache = new Map();
  const anchorsOf = (file) => {
    if (!anchorCache.has(file)) {
      anchorCache.set(file, headingAnchors(readFileSync(file, 'utf8')));
    }
    return anchorCache.get(file);
  };

  const problems = [];
  let linksChecked = 0;

  for (const file of files) {
    const rel = relative(absRoot, file).split(sep).join('/');
    const lines = maskNonLinkSpans(readFileSync(file, 'utf8'));

    lines.forEach((line, i) => {
      // `[text](target)` — the leading `!` of an image embed is excluded, so
      // a missing screenshot is not this job's business.
      for (const m of line.matchAll(/(!?)\[[^\]]*\]\(([^)\s]+)\)/g)) {
        const [, bang, target] = m;
        if (bang) continue;
        // Skip anything that is not an in-repo path. This is a PATTERN, not
        // an allowlist of four schemes: the previous allowlist sent every
        // other scheme (`vscode://`, `slack://`) and every protocol-relative
        // URL (`//example.com/x`) down the relative-path branch, where they
        // were reported as `missing-file`. A false red on a docs job is how
        // a check gets muted, which is the outcome this whole PR argues
        // against — so an unrecognised scheme is skipped, not guessed at.
        if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) continue;

        linksChecked++;
        const hashAt = target.indexOf('#');
        const pathPart = hashAt === -1 ? target : target.slice(0, hashAt);
        const anchor = hashAt === -1 ? '' : target.slice(hashAt + 1);

        // A leading `/` is repo-root-relative in every renderer that matters
        // (GitHub included), NOT filesystem-root. Resolving it against `/`
        // would report a confusing `missing-file` — or, on a machine where
        // that path happens to exist, silently read anchors from a file
        // outside the checkout.
        const decoded = tryDecode(pathPart);
        const targetFile = !pathPart
          ? file
          : decoded.startsWith('/')
            ? resolve(absRoot, `.${decoded}`)
            : resolve(dirname(file), decoded);

        if (pathPart && !existsSync(targetFile)) {
          problems.push({ kind: 'missing-file', file: rel, line: i + 1, target });
          continue;
        }
        if (!anchor) continue;
        // Only markdown exposes heading anchors; a fragment into anything
        // else is not something this can adjudicate.
        if (!targetFile.toLowerCase().endsWith('.md')) continue;
        if (!anchorsOf(targetFile).has(tryDecode(anchor))) {
          problems.push({ kind: 'dead-anchor', file: rel, line: i + 1, target });
        }
      }
    });
  }

  // Kept OUT of `problems`, deliberately. `problems` means "a link is
  // broken"; this means "the run proved nothing". Merging them would make a
  // fixture that legitimately contains no links indistinguishable from a
  // walk that has stopped finding files, which is the very distinction this
  // flag exists to draw.
  const scannedNothing = files.length === 0 || linksChecked === 0;

  return {
    ok: problems.length === 0 && !scannedNothing,
    problems,
    scannedNothing,
    files: files.map((f) => relative(absRoot, f).split(sep).join('/')),
    filesScanned: files.length,
    linksChecked,
  };
}

// CLI. `import.meta.main` is Node 24+, so this compares paths to stay on 20.
//
// It MUST go through fileURLToPath. `new URL(import.meta.url).pathname` is
// percent-ENCODED, so a checkout under a path containing a space or any
// non-ASCII character ("/Users/me/My Repos/sync-sit", anything OneDrive
// syncs) produced "/Users/me/My%20Repos/..." — never equal to argv[1], so
// this block did not run and `node scripts/check-markdown-links.mjs` printed
// nothing and exited 0. A silent pass, in the script whose entire purpose is
// that silence means "checked". It was not reachable on the CI runner path,
// which is exactly why only a developer would ever have hit it, and they
// could not have told it from a clean run. `markdown-links.test.ts` spawns
// this file from a directory with a space to keep it fixed.
const thisFile = fileURLToPath(import.meta.url);
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === thisFile;

if (invokedDirectly) {
  const root = process.argv[2] ?? resolve(dirname(thisFile), '..');
  const result = checkTree(root);

  for (const p of result.problems) {
    console.error(`${p.file}:${p.line}  ${p.kind}: ${p.target}`);
  }

  if (result.scannedNothing) {
    console.error(
      `FAIL: the scan covered nothing — ${result.filesScanned} markdown file(s), ` +
        `${result.linksChecked} in-repo link(s) under ${root}. A link check that ` +
        `finds no links is not a pass; it means the walk or the root is wrong.`,
    );
  }

  console.log(
    `checked ${result.linksChecked} in-repo links across ${result.filesScanned} markdown files; ` +
      `${result.problems.length} problem(s)`,
  );
  // `process.exitCode`, NOT `process.exit()`. Node's stdout and stderr are
  // asynchronous when they are pipes — exactly how CI and `spawnSync` capture
  // them — so exiting immediately after writing can truncate the output. With
  // a long `problems` list, the case where the output matters most, the run
  // would exit 1 having printed only some of the offenders. Setting the code
  // lets the process drain and exit naturally; there are no open handles to
  // keep it alive, so the status is otherwise identical.
  //
  // A check whose diagnostics can silently go missing while its exit code
  // stays correct is a smaller version of the failure this script exists to
  // catch.
  process.exitCode = result.ok ? 0 : 1;
}
