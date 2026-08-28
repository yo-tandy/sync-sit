import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Regression guards for the shared :focus-visible treatment (issue #325,
 * PR #327 round 3) -- both invariants below were broken during the PR and
 * caught only by review, so they get text-level pins per the repo's
 * themeWiring/brandTokens convention:
 * 1. The rule MUST live inside @layer base. Unlayered, it silently
 *    outranks every Tailwind utility (focus-visible:*, outline-none,
 *    shadow-*), which was the round-1 defect.
 * 2. No selector-matched shared primitive may carry outline-none -- under
 *    the layer, that utility wins and the control loses its ring, which
 *    was the round-2 defect on Select.
 */
const sharedUi = resolve(__dirname, '../../../../../packages/shared-ui/src');
const css = readFileSync(resolve(sharedUi, 'theme/base.css'), 'utf8');

describe('shared focus-visible rule (issue #325)', () => {
  it('the ring rule lives INSIDE @layer base', () => {
    const layerStart = css.indexOf('@layer base {');
    expect(layerStart).toBeGreaterThan(-1);
    // Anchor on the SELECTOR (the doc comment above the layer also says
    // "focus-visible", which a bare indexOf would match first).
    const ruleStart = css.indexOf('):focus-visible');
    expect(ruleStart).toBeGreaterThan(layerStart);
    // The rule's block closes before the layer does: count braces from the
    // layer open to the rule -- crude but catches the rule escaping the
    // layer entirely (the round-1 shape).
    const between = css.slice(layerStart, ruleStart);
    const depth = (between.match(/{/g) || []).length - (between.match(/}/g) || []).length;
    expect(depth).toBeGreaterThanOrEqual(1);
  });

  it('the inset container opt-in lives in the same layer', () => {
    expect(css).toContain('.focus-ring-inset');
    expect(css.indexOf('.focus-ring-inset')).toBeGreaterThan(css.indexOf('@layer base {'));
  });

  it('selector-matched shared primitives carry no outline-none', () => {
    // The primitives the base selector matches (buttons, selects). Text
    // fields legitimately keep outline-none and are NOT listed here.
    for (const rel of ['components/Select.tsx', 'components/Button.tsx']) {
      const src = readFileSync(resolve(sharedUi, rel), 'utf8');
      expect(src, `${rel} must not defeat the shared focus ring`).not.toContain('outline-none');
    }
  });
});
