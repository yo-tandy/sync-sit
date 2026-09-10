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
});
