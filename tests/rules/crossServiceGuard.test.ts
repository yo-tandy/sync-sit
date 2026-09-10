/**
 * Unit tests for the pure scanner in crossServiceGuard.ts, against fixture
 * strings. No filesystem, no emulator — see cross-service-guard.test.ts for
 * the guard that reads the real rules files and enforces the acknowledgement
 * policy.
 */
import { describe, it, expect } from 'vitest';
import { scanForCrossServiceConstructs, stripLineComment } from './crossServiceGuard.js';

describe('scanForCrossServiceConstructs', () => {
  it('finds firestore.get( with the correct line number', () => {
    const text = [
      'rules_version = "2";',
      'service firebase.storage {',
      '  function callerData() {',
      '    return firestore.get(/databases/(default)/documents/users/$(request.auth.uid)).data;',
      '  }',
      '}',
    ].join('\n');

    const result = scanForCrossServiceConstructs(text, 'fixture.rules');

    expect(result.occurrences).toHaveLength(1);
    expect(result.occurrences[0]).toMatchObject({
      file: 'fixture.rules',
      line: 4,
      construct: 'firestore.get(',
    });
    expect(result.occurrences[0].snippet).toContain('firestore.get(');
    expect(result.linesScanned).toBe(6);
  });

  it('finds firestore.exists( with the correct line number', () => {
    const text = ['match /foo/{id} {', '  allow read: if firestore.exists(/databases/(default)/documents/bar/$(id));', '}'].join(
      '\n'
    );

    const result = scanForCrossServiceConstructs(text, 'fixture.rules');

    expect(result.occurrences).toHaveLength(1);
    expect(result.occurrences[0]).toMatchObject({
      file: 'fixture.rules',
      line: 2,
      construct: 'firestore.exists(',
    });
  });

  it('does not flag an occurrence that appears only inside a // comment', () => {
    // Mirrors the real warning comment in storage.rules, which mentions the
    // construct in prose without invoking it. This is the exact case the
    // scanner must not trip on.
    const text = [
      '// It read `canWriteFamilyDocs(callerData(), familyId)`, where callerData()',
      '// is a cross-service `firestore.get()` into users/{uid}. That call fails in',
      '// PRODUCTION and, because rules fail closed on an errored call, ...',
    ].join('\n');

    const result = scanForCrossServiceConstructs(text, 'fixture.rules');

    expect(result.occurrences).toHaveLength(0);
    expect(result.linesScanned).toBe(3);
  });

  it('flags real code but not a comment on the same line, when both are present', () => {
    const text = 'return firestore.get(/databases/(default)/documents/users/$(uid)).data; // cross-service, see #449';

    const result = scanForCrossServiceConstructs(text, 'fixture.rules');

    expect(result.occurrences).toHaveLength(1);
    expect(result.occurrences[0].line).toBe(1);
  });

  it('returns no occurrences for clean text, and still reports lines scanned', () => {
    const text = [
      'rules_version = "2";',
      'service firebase.storage {',
      '  match /profile-photos/{fileName} {',
      '    allow read: if request.auth != null;',
      '  }',
      '}',
    ].join('\n');

    const result = scanForCrossServiceConstructs(text, 'fixture.rules');

    expect(result.occurrences).toHaveLength(0);
    expect(result.linesScanned).toBe(6);
  });

  it('reports 0 lines scanned for a truly empty read, never 1', () => {
    // ''.split('\n') is [''] (length 1) in plain JS — the scanner must not
    // let that make an empty/failed file read look like "1 clean line was
    // examined". This is the exact case the guard test's "scanned nothing"
    // check depends on to fail loudly rather than silently pass.
    const result = scanForCrossServiceConstructs('', 'fixture.rules');

    expect(result.linesScanned).toBe(0);
    expect(result.occurrences).toHaveLength(0);
  });

  it('finds multiple occurrences across multiple lines', () => {
    const text = [
      'function a() { return firestore.get(/databases/(default)/documents/x/1).data; }',
      'function b() { return firestore.exists(/databases/(default)/documents/y/2); }',
    ].join('\n');

    const result = scanForCrossServiceConstructs(text, 'fixture.rules');

    expect(result.occurrences).toHaveLength(2);
    expect(result.occurrences.map((o) => o.line)).toEqual([1, 2]);
  });
});

describe('stripLineComment', () => {
  it('removes a trailing // comment', () => {
    expect(stripLineComment('allow read: if true; // ok')).toBe('allow read: if true; ');
  });

  it('leaves a line with no comment untouched', () => {
    expect(stripLineComment('allow read: if true;')).toBe('allow read: if true;');
  });

  it('treats an entire comment-only line as empty code', () => {
    expect(stripLineComment('// just a comment')).toBe('');
  });

  it('does not treat a // inside a quoted string as a comment marker', () => {
    // Not a pattern used in these rules files today, but the stripper should
    // not be fooled if one ever appears.
    expect(stripLineComment("t.matches('https://example.com') // real comment")).toBe(
      "t.matches('https://example.com') "
    );
  });
});
