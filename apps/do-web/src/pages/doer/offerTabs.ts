import type { OfferStatus } from '@ejm/do-core';

/**
 * Tab mapping and link eligibility for the doer's "My offers" list.
 *
 * These live beside `MyOffersPage` rather than inside it so the page file
 * exports only its component: a module that mixes components with plain
 * helpers defeats Fast Refresh (react-refresh/only-export-components), and
 * the tests pin these two functions directly.
 */
export type Tab = 'pending' | 'awaitingParent' | 'accepted' | 'declined' | 'withdrawn';

export const TABS: Tab[] = ['pending', 'awaitingParent', 'accepted', 'declined', 'withdrawn'];

/** Which tab an offer status lands in. `expired` (task cancelled/expired
 * underneath, or a pending_guardian sibling flipped by an acceptance)
 * shares the declined tab — a terminal not-your-doing outcome — with its
 * own "task closed" badge, since §9.2 names five tabs, not six. */
export function tabOf(status: OfferStatus): Tab {
  switch (status) {
    case 'pending':
      return 'pending';
    case 'pending_guardian':
      return 'awaitingParent';
    case 'accepted':
      return 'accepted';
    case 'declined':
    case 'expired':
      return 'declined';
    case 'withdrawn':
      return 'withdrawn';
  }
}

/** A LIVE offer's task is readable by §7.2 (pending/pending_guardian ⇒
 * the task is open; accepted ⇒ it is the caller's own assignment), so
 * those link. TERMINAL offers never link — the task may no longer be
 * readable (declined-because-sibling-accepted, expired, swept), and a
 * dead offer is a summary line, never a broken link (§4.2). */
export function isLinkable(status: OfferStatus): boolean {
  return status === 'pending' || status === 'pending_guardian' || status === 'accepted';
}
