import { describe, it, expect } from 'vitest';
import { isAcceptablePhotoType, resolvePhotoContentType } from '../photoType.js';

describe('isAcceptablePhotoType', () => {
  it.each([
    ['empty (browser gave no type)', ''],
    ['application/octet-stream (generic, type undetermined)', 'application/octet-stream'],
    ['a padded generic type', '  application/octet-stream  '],
    ['whitespace-only type (effectively unknown)', '   '],
    ['image/heic', 'image/heic'],
    ['image/heif', 'image/heif'],
    ['image/jpeg', 'image/jpeg'],
    ['image/png', 'image/png'],
    ['image/webp', 'image/webp'],
    ['image/gif', 'image/gif'],
  ])('accepts %s', (_label, type) => {
    expect(isAcceptablePhotoType(type)).toBe(true);
  });

  it.each([
    ['image/svg+xml -- scriptable document', 'image/svg+xml'],
    ['application/pdf -- positively not an image', 'application/pdf'],
    ['text/html -- positively not an image', 'text/html'],
    ['application/xhtml+xml -- +xml carve-out', 'application/xhtml+xml'],
  ])('rejects %s', (_label, type) => {
    expect(isAcceptablePhotoType(type)).toBe(false);
  });

  it('is case- and whitespace-insensitive on the decision itself', () => {
    // NB: the File constructor lowercases `type` per spec (and jsdom honours
    // that), so a mixed-case pin here would pass no matter what the function
    // does -- it would read as case coverage while asserting nothing. This
    // pins the normalised-string behaviour directly instead.
    expect(isAcceptablePhotoType('  IMAGE/SVG+XML  ')).toBe(false);
    expect(isAcceptablePhotoType('APPLICATION/PDF')).toBe(false);
  });
});

describe('resolvePhotoContentType', () => {
  it('trusts a real, specific File.type over the extension', () => {
    expect(resolvePhotoContentType('photo.heic', 'image/heic')).toBe('image/heic');
    expect(resolvePhotoContentType('photo.png', 'image/png')).toBe('image/png');
  });

  it('derives from the extension when the type is empty', () => {
    expect(resolvePhotoContentType('IMG_1234.HEIC', '')).toBe('image/heic');
    expect(resolvePhotoContentType('photo.heif', '')).toBe('image/heif');
    expect(resolvePhotoContentType('photo.jpg', '')).toBe('image/jpeg');
  });

  it('derives from the extension when the type is the generic octet-stream', () => {
    expect(resolvePhotoContentType('IMG_1234.HEIC', 'application/octet-stream')).toBe('image/heic');
    expect(resolvePhotoContentType('photo.webp', '  application/octet-stream  ')).toBe('image/webp');
  });

  it('falls back to octet-stream when both the type and the extension are unrecognised', () => {
    expect(resolvePhotoContentType('mystery-file', '')).toBe('application/octet-stream');
    expect(resolvePhotoContentType('weird.xyz', 'application/octet-stream')).toBe('application/octet-stream');
  });
});
