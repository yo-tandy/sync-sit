import { describe, it, expect } from 'vitest';
import { renderWithProviders } from '@/__tests__/test-utils';
import { SkeletonCard } from '@ejm/shared-ui';

/**
 * SkeletonCard (UX F12, issue #126): the loading placeholder for list rows.
 * Pins the contract the six converted list pages rely on: the Card idiom,
 * the bar count, the avatar variant, the reduced-motion guard, and that the
 * placeholder stays out of the accessibility tree.
 */
describe('SkeletonCard (shared-ui)', () => {
  function bars(container: HTMLElement) {
    return container.querySelectorAll('.h-3\\.5.rounded.bg-gray-200');
  }

  it('renders 3 grey bars by default inside the Card idiom', () => {
    const { container } = renderWithProviders(<SkeletonCard />);
    const card = container.querySelector('[data-testid="skeleton-card"]') as HTMLElement;
    expect(card).not.toBeNull();
    // Same frame as <Card>: rounded, bordered, RAISED-SURFACE, padded.
    // bg-ground-raised, not bg-white (#395 review round 2): the skeleton
    // stands in for a Card, so it has to resolve to the same surface token —
    // otherwise the first brand that makes raised surfaces non-white gets a
    // list that flashes as data arrives.
    expect(card.className).toContain('rounded-lg');
    expect(card.className).toContain('border-gray-200');
    expect(card.className).toContain('bg-ground-raised');
    expect(bars(container)).toHaveLength(3);
  });

  it('renders the requested number of lines', () => {
    const { container } = renderWithProviders(<SkeletonCard lines={5} />);
    expect(bars(container)).toHaveLength(5);
  });

  it('avatar variant prepends a circle; default has none', () => {
    const { container: withAvatar } = renderWithProviders(<SkeletonCard avatar />);
    expect(withAvatar.querySelector('.rounded-full.bg-gray-200')).not.toBeNull();

    const { container: without } = renderWithProviders(<SkeletonCard />);
    expect(without.querySelector('.rounded-full')).toBeNull();
  });

  it('pulses only under motion-safe (prefers-reduced-motion turns it off)', () => {
    const { container } = renderWithProviders(<SkeletonCard />);
    const card = container.querySelector('[data-testid="skeleton-card"]') as HTMLElement;
    expect(card.className).toContain('motion-safe:animate-pulse');
    // Never the unguarded utility (the guard would be dead code beside it).
    expect(card.className).not.toMatch(/(?:^|\s)animate-pulse/);
  });

  it('is hidden from assistive technology', () => {
    const { container } = renderWithProviders(<SkeletonCard />);
    const card = container.querySelector('[data-testid="skeleton-card"]') as HTMLElement;
    expect(card).toHaveAttribute('aria-hidden', 'true');
  });
});
