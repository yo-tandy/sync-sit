/**
 * Guard: a green rules-test run must never again be mistaken for evidence
 * that a cross-service rule construct works in production.
 *
 * Background: the Firebase emulator serves cross-service lookups
 * (`firestore.get(...)` / `firestore.exists(...)`, called from storage.rules
 * into Firestore) UNCONDITIONALLY. `tests/rules/storage-rules.test.ts` passed
 * green for the entire duration of the issue #446 production outage, where
 * that exact lookup failed in prod (a missing IAM grant) and every parent's
 * verification upload 403'd — because rules fail closed on an errored call.
 * See issue #446 for the outage, issue #449 for this guard, and issue #447
 * for the proposed server-side fix that would remove the dependency
 * entirely.
 *
 * This test reads the REAL storage.rules and firestore.rules, scans them
 * with the pure scanner in crossServiceGuard.ts, and fails loudly on any
 * occurrence that is not explicitly acknowledged below. It is pure file I/O:
 * no Firebase emulator, no network. It must run in the same job as the rest
 * of tests/rules/ but does not depend on the emulator lifecycle that job
 * happens to run under.
 *
 * WHEN THIS TEST FAILS:
 * A cross-service construct was added (or reintroduced — see #447) to
 * storage.rules or firestore.rules. Before adding an entry to
 * ACKNOWLEDGED_CROSS_SERVICE_RULES below:
 *   1. Prefer a design that avoids the cross-service call entirely (#447's
 *      signed-URL callable is the model: move the check into a Cloud
 *      Function where it is directly unit-testable with the Admin SDK).
 *   2. If a cross-service rule genuinely is the right design, it MUST ship
 *      paired with a production smoke check — a real authenticated request
 *      against production, run post-deploy, that fails loudly if the
 *      cross-service lookup errors. The emulator suite cannot verify this;
 *      only a real deploy can.
 *   3. Only then, add an entry here recording the file, a stable snippet
 *      identifying the construct, why it exists, and where the smoke check
 *      lives (a CI job name, script path, or issue/PR link).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { scanForCrossServiceConstructs, type CrossServiceOccurrence } from './crossServiceGuard.js';

interface AcknowledgedCrossServiceRule {
  /** Must match the `file` label passed to the scanner below (e.g. 'storage.rules'). */
  file: string;
  /** A short, stable substring of the offending line (survives reformatting
   * better than an exact line number). Matched with String.includes(). */
  snippet: string;
  /** Why this cross-service call exists and cannot be avoided. */
  justification: string;
  /** Where the production smoke check that covers this lives (script path,
   * CI job name, or an issue/PR link). Required — see the file header. */
  smokeCheck: string;
}

// Starts EMPTY as a design principle: every cross-service construct that
// ships must be justified here, on purpose, by whoever adds it, never
// pre-populated for convenience.
//
// Empty again as of issue #447: the one entry this list carried
// (callerData()'s dead-code `firestore.get()`, acknowledged as inert
// scaffolding by #449/PR #462) is gone because callerData() and
// canWriteFamilyDocs() were deleted from storage.rules outright —
// verification-documents' membership check moved server-side into
// createVerificationDocumentUploadUrl instead of being restored into a
// rule, so there was nothing left to keep the helpers FOR. An empty list
// here is the guard doing its job: it proves no cross-service construct
// remains in either rules file, not just that the one we knew about is
// still unreachable.
const ACKNOWLEDGED_CROSS_SERVICE_RULES: AcknowledgedCrossServiceRule[] = [];

const RULES_FILES: { label: string; path: string }[] = [
  { label: 'storage.rules', path: resolve(import.meta.dirname, '../../storage.rules') },
  { label: 'firestore.rules', path: resolve(import.meta.dirname, '../../firestore.rules') },
];

function isAcknowledged(occurrence: CrossServiceOccurrence): boolean {
  return ACKNOWLEDGED_CROSS_SERVICE_RULES.some(
    (ack) => ack.file === occurrence.file && occurrence.snippet.includes(ack.snippet)
  );
}

function formatFailure(unacknowledged: CrossServiceOccurrence[]): string {
  const lines = unacknowledged.map((o) => `  ${o.file}:${o.line}  ${o.snippet}`).join('\n');

  return (
    `\nUNACKNOWLEDGED CROSS-SERVICE RULE CONSTRUCT(S) DETECTED\n` +
    `========================================================\n` +
    `${lines}\n\n` +
    `WHY THIS FAILS:\n` +
    `The Firebase emulator serves cross-service lookups (firestore.get(...) /\n` +
    `firestore.exists(...), called from storage.rules into Firestore) UNCONDITIONALLY.\n` +
    `It cannot reproduce the production failure mode where that lookup errors (e.g. a\n` +
    `missing IAM grant) and the rule fails closed, denying every caller. A green\n` +
    `tests/rules/ run is NOT evidence that a cross-service rule works in production:\n` +
    `this exact blind spot let tests/rules/storage-rules.test.ts pass green for the\n` +
    `entire duration of the issue #446 production outage, while the equivalent\n` +
    `production call 403'd every parent's verification upload.\n\n` +
    `WHAT TO DO:\n` +
    `Any rule that ships a cross-service construct MUST be paired with a production\n` +
    `smoke check (a real authenticated request against production, run post-deploy) —\n` +
    `the emulator cannot verify this, only a real deploy can. Once that smoke check\n` +
    `exists, add an entry to ACKNOWLEDGED_CROSS_SERVICE_RULES in\n` +
    `tests/rules/cross-service-guard.test.ts documenting the file, a stable snippet\n` +
    `identifying the construct, the justification, and where the smoke check lives.\n\n` +
    `Background: issue #446 (the outage), issue #449 (this guard), issue #447 (the\n` +
    `proposed fix — moving the check server-side removes the dependency entirely).\n`
  );
}

describe('cross-service rule guard (#449)', () => {
  for (const { label, path } of RULES_FILES) {
    it(`${label} has no unacknowledged cross-service constructs`, () => {
      const text = readFileSync(path, 'utf8');
      const { occurrences, linesScanned } = scanForCrossServiceConstructs(text, label);

      // "Scanned nothing" guard: a failed or empty read must fail loudly,
      // never silently pass as "0 occurrences found" — an empty string would
      // trivially report zero cross-service constructs and give false
      // confidence the file was actually checked.
      expect(
        linesScanned,
        `${label}: the scanner examined 0 lines. This means the file read returned ` +
          `empty content (path resolved to nothing, or the file itself is empty) — ` +
          `treat that as a failure of this guard, not as "no cross-service constructs ` +
          `found". Check the path: ${path}`
      ).toBeGreaterThan(0);

      const unacknowledged = occurrences.filter((o) => !isAcknowledged(o));

      expect(unacknowledged, formatFailure(unacknowledged)).toHaveLength(0);
    });
  }

  it('the "scanned nothing" guard actually fails (not silently passes) on empty content', () => {
    // Proves the assertion above is load-bearing rather than vacuously true.
    // Does not touch the real rules files — this is a self-contained proof
    // that an empty read is treated as a failure, using the same assertion
    // shape as the real checks.
    const { linesScanned } = scanForCrossServiceConstructs('', 'empty-fixture.rules');

    expect(linesScanned).toBe(0);
    expect(() => {
      expect(linesScanned, 'scanned nothing').toBeGreaterThan(0);
    }).toThrow();
  });
});
