import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { staleMembershipFields } = require('../backfill-279-orphan-pointers.cjs');

/**
 * Pure classification matrix (PR #284 rounds 5-6): each membership field is
 * judged against ITS OWN family's parentIds -- hybrid docs must lose only
 * the stale half, and a live legacy root membership must never be deleted.
 */
const famWith = (uid: string) => ({ parentIds: [uid] });
const famWithout = { parentIds: ['someone-else'] };

describe('staleMembershipFields', () => {
  it('pre-fix orphan (Plan D pointer, absent from parentIds) -> clears the pointer', () => {
    const u = { profiles: { parent: { familyId: 'A' } } };
    expect(staleMembershipFields(u, { A: famWithout }, 'me')).toEqual(['profiles.parent.familyId']);
  });

  it('consistent member -> nothing', () => {
    const u = { profiles: { parent: { familyId: 'A' } } };
    expect(staleMembershipFields(u, { A: famWith('me') }, 'me')).toEqual([]);
  });

  it('hybrid: live Plan D + stale root naming another family -> only the root goes', () => {
    const u = { familyId: 'B', profiles: { parent: { familyId: 'A' } } };
    expect(staleMembershipFields(u, { A: famWith('me'), B: famWithout }, 'me')).toEqual(['familyId']);
  });

  it('hybrid: orphaned Plan D + LIVE legacy root -> only the pointer goes, root membership survives', () => {
    const u = { familyId: 'B', profiles: { parent: { familyId: 'A' } } };
    expect(staleMembershipFields(u, { A: famWithout, B: famWith('me') }, 'me')).toEqual(['profiles.parent.familyId']);
  });

  it('missing family doc counts as stale', () => {
    const u = { profiles: { parent: { familyId: 'GONE' } } };
    expect(staleMembershipFields(u, { GONE: null }, 'me')).toEqual(['profiles.parent.familyId']);
  });

  it('no membership fields -> nothing', () => {
    expect(staleMembershipFields({ profiles: { parent: {} } }, {}, 'me')).toEqual([]);
    expect(staleMembershipFields({}, {}, 'me')).toEqual([]);
  });
});
