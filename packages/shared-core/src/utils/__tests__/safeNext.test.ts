import { describe, it, expect } from 'vitest';
import { safeNext } from '../safeNext.js';

const ALLOWED = ['/family/account', '/family/sessions', '/tutor/account', '/tutor/sessions'];

describe('safeNext', () => {
  it('accepts an allowed in-app path', () => {
    expect(safeNext('/family/sessions', ALLOWED)).toBe('/family/sessions');
  });

  it('accepts an allowed path with a nested subpath under the prefix', () => {
    expect(safeNext('/family/sessions/upcoming', ALLOWED)).toBe('/family/sessions/upcoming');
  });

  it('accepts an allowed path carrying a query string', () => {
    expect(safeNext('/family/sessions?tab=past', ALLOWED)).toBe('/family/sessions?tab=past');
  });

  it('rejects null/undefined/empty input', () => {
    expect(safeNext(null, ALLOWED)).toBeNull();
    expect(safeNext(undefined, ALLOWED)).toBeNull();
    expect(safeNext('', ALLOWED)).toBeNull();
  });

  it('rejects a path not in the known route table (issue #426 pin)', () => {
    // Structurally a perfectly fine relative path — just not one this app
    // offers as a handoff destination. The allowlist, not a regex, decides.
    expect(safeNext('/tutor/area', ALLOWED)).toBeNull();
  });

  // --- hostile pins from issue #426 --------------------------------------

  it('rejects a scheme-relative URL (issue #426 pin: //evil.com)', () => {
    expect(safeNext('//evil.com', ALLOWED)).toBeNull();
  });

  it('rejects an absolute URL with a scheme (issue #426 pin: https://evil.com)', () => {
    expect(safeNext('https://evil.com', ALLOWED)).toBeNull();
  });

  it('rejects a javascript: URL (issue #426 pin: javascript:alert(1))', () => {
    expect(safeNext('javascript:alert(1)', ALLOWED)).toBeNull();
  });

  it('rejects a backslash-prefixed path (issue #426 pin: /\\evil.com)', () => {
    expect(safeNext('/\\evil.com', ALLOWED)).toBeNull();
  });

  it('rejects a percent-encoded variant that decodes to a scheme-relative URL (issue #426 pin)', () => {
    // "/%2Fevil.com" looks like a single-slash path raw, but decodes to
    // "//evil.com" — must be re-validated AFTER decoding.
    expect(safeNext('/%2Fevil.com', ALLOWED)).toBeNull();
  });

  it('rejects a percent-encoded backslash (decodes to /\\evil.com)', () => {
    expect(safeNext('/%5Cevil.com', ALLOWED)).toBeNull();
  });

  it('rejects a data: URL (issue #426 pin)', () => {
    expect(safeNext('data:text/html,<script>alert(1)</script>', ALLOWED)).toBeNull();
  });

  it('rejects an embedded scheme that still starts with a single slash', () => {
    expect(safeNext('/javascript:alert(1)', ALLOWED)).toBeNull();
  });

  it('rejects a path with no leading slash', () => {
    expect(safeNext('family/sessions', ALLOWED)).toBeNull();
  });

  it('rejects a raw double-slash-encoded string with no leading slash', () => {
    expect(safeNext('%2F%2Fevil.com', ALLOWED)).toBeNull();
  });

  it('rejects a path-traversal attempt against an allowed prefix', () => {
    expect(safeNext('/family/sessions/../../evil', ALLOWED)).toBeNull();
  });

  it('rejects control characters / whitespace', () => {
    expect(safeNext('/family/sessions\n', ALLOWED)).toBeNull();
    expect(safeNext('/family/ sessions', ALLOWED)).toBeNull();
  });

  it('rejects malformed percent-escapes (does not decode cleanly)', () => {
    expect(safeNext('/family/sessions%', ALLOWED)).toBeNull();
  });

  it('rejects when the allowlist is empty', () => {
    expect(safeNext('/family/sessions', [])).toBeNull();
  });

  /*
   * Every hostile pin above happens to also mismatch ALLOWED's route
   * strings, so it is rejected even if a given structural rule is removed —
   * the allowlist backstops it. These tests pin each structural rule in
   * ISOLATION, by using an allowlist that WOULD tolerate the attack's
   * resulting pathname, so only the rule itself stands between the input
   * and a false accept. Deliberately mutation-fragile: this is what a
   * `revert the validator` check must break for each rule to count as
   * covered (see the PR's mutation-check list).
   */
  describe('structural rules in isolation (allowlist deliberately permissive)', () => {
    it('scheme-relative // is rejected even when the allowlist contains that exact string', () => {
      expect(safeNext('//evil.com', ['//evil.com'])).toBeNull();
    });

    it('a raw backslash is rejected even when the allowlist contains that exact string', () => {
      expect(safeNext('/\\evil.com', ['/\\evil.com'])).toBeNull();
    });

    it('an embedded scheme is rejected even when the allowlist contains that exact string', () => {
      expect(safeNext('/javascript:alert(1)', ['/javascript:alert(1)'])).toBeNull();
    });

    it('the DECODED form is re-validated even when the allowlist tolerates the raw form', () => {
      // Raw "/%2Fevil.com" is structurally fine and not itself scheme-
      // relative; only decoding reveals "//evil.com". The allowlist here
      // contains the DECODED (dangerous) pathname, not the raw one, so a
      // missing decode-then-revalidate step would slip through.
      expect(safeNext('/%2Fevil.com', ['//evil.com'])).toBeNull();
    });
  });
});
