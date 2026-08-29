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
 *     does not use them; if that changes, extend this rather than assuming
 *     the silence means they were checked.
 *
 * Usage: node scripts/check-markdown-links.mjs [root]
 * Exit 0 when clean, 1 when anything is broken OR when the scan covered
 * nothing (see `nothing-scanned`).
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative, sep } from 'node:path';

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.claude', 'coverage']);

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

/** Every anchor a rendered markdown document exposes, in document order. */
export function headingAnchors(text) {
  const anchors = new Set();
  const seen = new Map();
  let inFence = false;

  for (const line of text.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

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
  let inFence = false;
  return text.split('\n').map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return '';
    }
    if (inFence) return '';
    return line.replace(/`[^`]*`/g, '');
  });
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) walk(full, out);
    else if (entry.toLowerCase().endsWith('.md')) out.push(full);
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
        if (/^(https?:|mailto:|tel:|ftp:|#!)/i.test(target)) continue;

        linksChecked++;
        const hashAt = target.indexOf('#');
        const pathPart = hashAt === -1 ? target : target.slice(0, hashAt);
        const anchor = hashAt === -1 ? '' : target.slice(hashAt + 1);
        const targetFile = pathPart ? resolve(dirname(file), decodeURIComponent(pathPart)) : file;

        if (pathPart && !existsSync(targetFile)) {
          problems.push({ kind: 'missing-file', file: rel, line: i + 1, target });
          continue;
        }
        if (!anchor) continue;
        // Only markdown exposes heading anchors; a fragment into anything
        // else is not something this can adjudicate.
        if (!targetFile.toLowerCase().endsWith('.md')) continue;
        if (!anchorsOf(targetFile).has(decodeURIComponent(anchor))) {
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

// CLI. `import.meta.main` is Node 24+; compare paths so this works on 20.
const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);

if (invokedDirectly) {
  const root = process.argv[2] ?? resolve(dirname(new URL(import.meta.url).pathname), '..');
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
  process.exit(result.ok ? 0 : 1);
}
