import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { classifyChannelList } = require('../has-preview-channel.js');

/**
 * Exit-code contract for the cleanup workflow (issue #316 / PR #323):
 * 0 present, 1 absent, 2 invalid-list -- and 2 must cover every failure
 * shape, because the workflow fails loudly on it rather than skipping.
 */
const ok = (channels: { name: string }[]) =>
  JSON.stringify({ status: 'success', result: { channels } });
const ch = (site: string, id: string) => ({
  name: `projects/sync-sit/sites/${site}/channels/${id}`,
});

describe('classifyChannelList', () => {
  it('0: channel present', () => {
    expect(classifyChannelList(ok([ch('sync-sit', 'live'), ch('sync-sit', 'pr-42')]), 'pr-42')).toBe(0);
  });

  it('1: valid list, channel absent (and no suffix false-positives: pr-4 != pr-42)', () => {
    expect(classifyChannelList(ok([ch('sync-sit', 'live'), ch('sync-sit', 'pr-42')]), 'pr-4')).toBe(1);
    expect(classifyChannelList(ok([]), 'pr-42')).toBe(1);
  });

  it('2: CLI error payload ({status:"error"})', () => {
    expect(classifyChannelList(JSON.stringify({ status: 'error', error: 'boom' }), 'pr-42')).toBe(2);
  });

  it('2: empty stdin, garbage, and shape-mismatch payloads', () => {
    expect(classifyChannelList('', 'pr-42')).toBe(2);
    expect(classifyChannelList('not json', 'pr-42')).toBe(2);
    expect(classifyChannelList(JSON.stringify({ status: 'success', result: {} }), 'pr-42')).toBe(2);
    expect(classifyChannelList(JSON.stringify({ status: 'success' }), 'pr-42')).toBe(2);
  });
});
