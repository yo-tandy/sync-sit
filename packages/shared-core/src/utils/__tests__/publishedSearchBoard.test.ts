import { describe, it, expect } from 'vitest';
import { isActivePublishedSearch, isNewPublishedSearch } from '../publishedSearchBoard.js';

const ts = (ms: number) => ({ toMillis: () => ms });
const NOW = 1_000_000;

describe('isActivePublishedSearch', () => {
  it('is active strictly after now, inactive at and before now', () => {
    expect(isActivePublishedSearch({ expiresAt: ts(NOW + 1) }, NOW)).toBe(true);
    expect(isActivePublishedSearch({ expiresAt: ts(NOW) }, NOW)).toBe(false);
    expect(isActivePublishedSearch({ expiresAt: ts(NOW - 1) }, NOW)).toBe(false);
  });

  it('degrades closed on malformed/absent expiresAt', () => {
    expect(isActivePublishedSearch({}, NOW)).toBe(false);
    expect(isActivePublishedSearch({ expiresAt: null }, NOW)).toBe(false);
    expect(isActivePublishedSearch({ expiresAt: {} }, NOW)).toBe(false);
    expect(isActivePublishedSearch({ expiresAt: { toMillis: () => NaN } }, NOW)).toBe(false);
  });
});

describe('isNewPublishedSearch', () => {
  it('is New strictly after seenAt — createdAt == seenAt is NOT new (issue #207 boundary)', () => {
    expect(isNewPublishedSearch({ createdAt: ts(NOW + 1) }, NOW)).toBe(true);
    expect(isNewPublishedSearch({ createdAt: ts(NOW) }, NOW)).toBe(false);
    expect(isNewPublishedSearch({ createdAt: ts(NOW - 1) }, NOW)).toBe(false);
  });

  it('treats a never-visited provider (seenAt null) as all-New', () => {
    expect(isNewPublishedSearch({ createdAt: ts(1) }, null)).toBe(true);
  });

  it('degrades closed on malformed/absent createdAt', () => {
    expect(isNewPublishedSearch({}, null)).toBe(false);
    expect(isNewPublishedSearch({ createdAt: {} }, NOW)).toBe(false);
  });
});
