import { describe, it, expect } from 'vitest';
import {
  codeIdentityClass,
  assertCodeIdentityClass,
  EJM_CODE_STAMP,
  PARENT_CODE_STAMP,
} from '../verificationCodeClass.js';

// Unit pins for the pure identity-class logic (issue #322). The Firestore
// wiring — which callable stamps what, and which consumer requires what — is
// covered by tests/integration/auth/verification-code-class.test.ts; these
// pin the grading table itself, including the two fallbacks the docstring
// promises. The unrecognized-value fallback in particular outlives the
// transitional one: it is the permanent fail-closed invariant, so a refactor
// to `codeData?.identityClass ?? 'mailbox'` must not pass silently.

const doc = (identityClass?: unknown) =>
  ({ code: '123456', ...(identityClass === undefined ? {} : { identityClass }) }) as
    FirebaseFirestore.DocumentData;

describe('codeIdentityClass', () => {
  it("reads the 'ejm' stamp", () => {
    expect(codeIdentityClass(doc('ejm'))).toBe('ejm');
  });

  it("reads the 'mailbox' stamp", () => {
    expect(codeIdentityClass(doc('mailbox'))).toBe('mailbox');
  });

  it('treats a doc with NO stamp as the weakest class (the transitional pre-#322 doc)', () => {
    expect(codeIdentityClass(doc())).toBe('mailbox');
  });

  it('treats an absent doc as the weakest class', () => {
    expect(codeIdentityClass(undefined)).toBe('mailbox');
  });

  it('fails CLOSED on an unrecognized value — an arbitrary stored string is never a class', () => {
    for (const junk of ['staff', 'EJM', 'ejm ', '', true, 1, null, { ejm: true }, ['ejm']]) {
      expect(codeIdentityClass(doc(junk))).toBe('mailbox');
    }
  });
});

describe('assertCodeIdentityClass', () => {
  it("'ejm' satisfies an ejm requirement", () => {
    expect(() => assertCodeIdentityClass(doc('ejm'), 'ejm')).not.toThrow();
  });

  it("'ejm' also satisfies a mailbox requirement (an EJM code was emailed to that address too)", () => {
    expect(() => assertCodeIdentityClass(doc('ejm'), 'mailbox')).not.toThrow();
  });

  it("'mailbox' satisfies a mailbox requirement", () => {
    expect(() => assertCodeIdentityClass(doc('mailbox'), 'mailbox')).not.toThrow();
  });

  it("'mailbox' does NOT satisfy an ejm requirement — the #322 attack, at the table level", () => {
    expect(() => assertCodeIdentityClass(doc('mailbox'), 'ejm')).toThrow();
  });

  it('an unstamped doc does NOT satisfy an ejm requirement, and DOES satisfy a mailbox one', () => {
    expect(() => assertCodeIdentityClass(doc(), 'ejm')).toThrow();
    expect(() => assertCodeIdentityClass(doc(), 'mailbox')).not.toThrow();
  });

  it('an unrecognized value does not satisfy an ejm requirement either', () => {
    expect(() => assertCodeIdentityClass(doc('staff'), 'ejm')).toThrow();
  });

  it('refuses with failed-precondition and the machine-readable reason marker', () => {
    let caught: { code?: string; details?: unknown } | null = null;
    try {
      assertCodeIdentityClass(doc('mailbox'), 'ejm');
    } catch (err) {
      caught = err as { code?: string; details?: unknown };
    }
    // Server-side HttpsError.code is the bare status (the 'functions/' prefix
    // is added client-side by the callable SDK).
    expect(caught?.code).toBe('failed-precondition');
    expect(caught?.details).toEqual({ reason: 'code_identity_class' });
  });
});

describe('the writers stamps', () => {
  it('pair each issuing callable with what its codes prove', () => {
    expect(EJM_CODE_STAMP).toEqual({ issuer: 'verifyEjmEmail', identityClass: 'ejm' });
    expect(PARENT_CODE_STAMP).toEqual({ issuer: 'verifyParentEmail', identityClass: 'mailbox' });
    // The stamps are what the consumers grade, so the round trip matters.
    expect(codeIdentityClass(EJM_CODE_STAMP as FirebaseFirestore.DocumentData)).toBe('ejm');
    expect(codeIdentityClass(PARENT_CODE_STAMP as FirebaseFirestore.DocumentData)).toBe('mailbox');
  });
});
