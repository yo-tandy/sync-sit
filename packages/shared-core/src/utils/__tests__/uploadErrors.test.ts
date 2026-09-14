import { describe, it, expect } from 'vitest';
import { uploadErrorKey } from '../uploadErrors.js';

describe('uploadErrorKey', () => {
  // #448/#446: a Storage rules denial must map to its own, actionable key
  // instead of collapsing into the generic upload-failed copy.
  it('maps storage/unauthorized to the permission key', () => {
    expect(uploadErrorKey({ code: 'storage/unauthorized' })).toBe('uploadErrorUnauthorized');
  });

  it.each(['storage/retry-limit-exceeded', 'storage/canceled'])(
    'maps %s to the connection-problem key',
    (code) => {
      expect(uploadErrorKey({ code })).toBe('uploadErrorConnection');
    },
  );

  it('falls back to the generic key for unrecognized or missing codes', () => {
    expect(uploadErrorKey({ code: 'storage/unknown-error' })).toBe('uploadError');
    expect(uploadErrorKey(new Error('network blip'))).toBe('uploadError');
    expect(uploadErrorKey(undefined)).toBe('uploadError');
    expect(uploadErrorKey('string error')).toBe('uploadError');
  });

  // Issue #471 follow-up: the signed-URL callable flow (FamilySettingsPage)
  // never throws a storage/* code — httpsCallable rejections carry
  // functions/* codes instead, and a failed fetch PUT carries neither
  // unless the caller attaches one.
  it.each(['functions/permission-denied', 'functions/unauthenticated'])(
    'maps %s (a rejected httpsCallable) to the permission key',
    (code) => {
      expect(uploadErrorKey({ code })).toBe('uploadErrorUnauthorized');
    },
  );

  it.each(['functions/unavailable', 'functions/deadline-exceeded'])(
    'maps %s (a rejected httpsCallable) to the connection-problem key',
    (code) => {
      expect(uploadErrorKey({ code })).toBe('uploadErrorConnection');
    },
  );

  it('maps upload/network (the signed-URL PUT failure convention) to the connection-problem key', () => {
    expect(uploadErrorKey({ code: 'upload/network' })).toBe('uploadErrorConnection');
  });

  it('does not treat an unrelated functions/* code as actionable (still generic)', () => {
    expect(uploadErrorKey({ code: 'functions/invalid-argument' })).toBe('uploadError');
    expect(uploadErrorKey({ code: 'functions/internal' })).toBe('uploadError');
  });
});
