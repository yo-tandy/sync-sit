import { describe, it, expect } from 'vitest';
import { isRenderableDocType } from '../isRenderableDocType.js';

describe('isRenderableDocType', () => {
  it('denies text/html', () => {
    expect(isRenderableDocType('text/html')).toBe(true);
  });

  it('denies text/html with a charset suffix', () => {
    expect(isRenderableDocType('text/html; charset=utf-8')).toBe(true);
  });

  it('denies text/xml and application/xml', () => {
    expect(isRenderableDocType('text/xml')).toBe(true);
    expect(isRenderableDocType('application/xml')).toBe(true);
  });

  it('denies any +xml type, including image/svg+xml', () => {
    expect(isRenderableDocType('image/svg+xml')).toBe(true);
    expect(isRenderableDocType('application/xhtml+xml')).toBe(true);
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(isRenderableDocType('  TEXT/HTML  ')).toBe(true);
    expect(isRenderableDocType('IMAGE/SVG+XML')).toBe(true);
  });

  it('allows real photo content types', () => {
    expect(isRenderableDocType('image/jpeg')).toBe(false);
    expect(isRenderableDocType('image/png')).toBe(false);
    expect(isRenderableDocType('image/heic')).toBe(false);
    expect(isRenderableDocType('application/pdf')).toBe(false);
  });

  it('allows empty/octet-stream/null/undefined (browser File.type quirks)', () => {
    expect(isRenderableDocType('')).toBe(false);
    expect(isRenderableDocType('application/octet-stream')).toBe(false);
    expect(isRenderableDocType(null)).toBe(false);
    expect(isRenderableDocType(undefined)).toBe(false);
  });
});
