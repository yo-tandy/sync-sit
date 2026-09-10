/**
 * Pure scanner for cross-service Firebase rule constructs.
 *
 * Background (issue #449, following the #446 production outage): the
 * Firebase emulator serves cross-service lookups — `firestore.get(...)` /
 * `firestore.exists(...)` called from storage.rules into Firestore — UNCONDITIONALLY.
 * It cannot reproduce the production failure mode where that lookup errors
 * (e.g. a missing IAM grant) and the rule fails closed, denying every caller.
 * `tests/rules/storage-rules.test.ts` passed green for the entire duration of
 * that outage.
 *
 * This module does one thing: given rules-file text, find every occurrence of
 * a cross-service construct, ignoring occurrences that appear only inside a
 * `//` line comment (e.g. the warning comment in storage.rules that MENTIONS
 * `firestore.get()` in prose without invoking it). It has no knowledge of
 * test frameworks, real files, or acknowledgement policy — see
 * `cross-service-guard.test.ts` for the guard that enforces those.
 */

/** Constructs that reach across services from within a rules file. Extend
 * this list if Firebase Storage/Firestore rules grow another cross-service
 * primitive. */
export const CROSS_SERVICE_CONSTRUCTS = ['firestore.get(', 'firestore.exists('] as const;

export interface CrossServiceOccurrence {
  /** Caller-supplied label for the source (a file path, or a fixture name). */
  file: string;
  /** 1-based line number within the scanned text. */
  line: number;
  /** The full source line, trimmed, for a human-readable report. */
  snippet: string;
  /** Which construct matched on this line. */
  construct: (typeof CROSS_SERVICE_CONSTRUCTS)[number];
}

export interface CrossServiceScanResult {
  occurrences: CrossServiceOccurrence[];
  /** Total number of lines examined. A caller should treat 0 here as a
   * failure of the read (empty/missing file), never as "nothing found". */
  linesScanned: number;
}

/**
 * Strips a trailing `//` line comment from a single line of rules source,
 * respecting single- and double-quoted string literals so a `//` inside a
 * string (not currently used anywhere in these rules files, but not assumed
 * away) does not truncate real code.
 *
 * Rules-language strings do not support escape sequences for quote
 * characters, so a naive "toggle on matching quote" scan is sufficient here.
 */
export function stripLineComment(line: string): string {
  let inString = false;
  let quoteChar = '';

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inString) {
      if (ch === quoteChar) {
        inString = false;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      inString = true;
      quoteChar = ch;
      continue;
    }

    if (ch === '/' && line[i + 1] === '/') {
      return line.slice(0, i);
    }
  }

  return line;
}

/**
 * Scans rules-file text for cross-service constructs, line by line, ignoring
 * matches that occur only inside a `//` comment.
 *
 * `file` is a caller-supplied label attached to every occurrence — pass the
 * real path (or a descriptive fixture name) so a failure message is
 * actionable.
 */
export function scanForCrossServiceConstructs(text: string, file: string): CrossServiceScanResult {
  // ''.split('\n') is ['' ] — length 1, not 0 — so a truly empty read (a
  // missing/empty file) must be special-cased or it would silently report
  // "1 line scanned, 0 occurrences" and be indistinguishable from a real,
  // clean file. Callers rely on linesScanned === 0 to mean "this read did
  // not actually examine anything" — see the "scanned nothing" guard in
  // cross-service-guard.test.ts.
  const lines = text === '' ? [] : text.split('\n');
  const occurrences: CrossServiceOccurrence[] = [];

  lines.forEach((rawLine, index) => {
    const codeOnly = stripLineComment(rawLine);

    for (const construct of CROSS_SERVICE_CONSTRUCTS) {
      let searchFrom = 0;
      let matchIndex: number;
      // indexOf loop (not a global regex): construct strings are fixed
      // literals, not patterns, so no regex escaping concerns, and this
      // still finds every occurrence per line, not just the first.
      while ((matchIndex = codeOnly.indexOf(construct, searchFrom)) !== -1) {
        occurrences.push({
          file,
          line: index + 1,
          snippet: rawLine.trim(),
          construct,
        });
        searchFrom = matchIndex + construct.length;
      }
    }
  });

  return { occurrences, linesScanned: lines.length };
}
