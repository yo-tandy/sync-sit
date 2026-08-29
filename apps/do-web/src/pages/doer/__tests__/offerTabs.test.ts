import { describe, expect, it } from 'vitest';
import type { OfferStatus } from '@ejm/do-core';
import { TABS, isLinkable, tabOf } from '../offerTabs';

// These two functions encode §9.2 product decisions that a page-render test
// only exercises indirectly: which of the FIVE named tabs each of the SIX
// offer statuses lands in, and which statuses may link back to a task the
// §7.2 read rule still lets the doer read. Pinned directly so a change to
// either has to be deliberate.

const ALL_STATUSES: OfferStatus[] = [
  'pending',
  'pending_guardian',
  'accepted',
  'declined',
  'withdrawn',
  'expired',
];

describe('tabOf', () => {
  it('maps every offer status into one of the five §9.2 tabs', () => {
    for (const status of ALL_STATUSES) {
      expect(TABS).toContain(tabOf(status));
    }
  });

  it('routes expired into the declined tab — a terminal not-your-doing outcome', () => {
    // §9.2 names five tabs, not six: `expired` (task cancelled or swept
    // underneath, or a pending_guardian sibling flipped by an acceptance)
    // shares declined, carrying its own "task closed" badge.
    expect(tabOf('expired')).toBe('declined');
    expect(tabOf('declined')).toBe('declined');
  });

  it('gives pending_guardian its own awaiting-parent tab', () => {
    expect(tabOf('pending_guardian')).toBe('awaitingParent');
    expect(tabOf('pending')).toBe('pending');
  });
});

describe('isLinkable', () => {
  it('links only the statuses whose task the doer can still read (§7.2)', () => {
    // pending / pending_guardian ⇒ the task is open; accepted ⇒ it is the
    // caller's own assignment. Both are readable under the board rule.
    expect(isLinkable('pending')).toBe(true);
    expect(isLinkable('pending_guardian')).toBe(true);
    expect(isLinkable('accepted')).toBe(true);
  });

  it('never links a terminal offer — a dead offer is a summary line, not a broken link (§4.2)', () => {
    expect(isLinkable('declined')).toBe(false);
    expect(isLinkable('withdrawn')).toBe(false);
    expect(isLinkable('expired')).toBe(false);
  });
});
