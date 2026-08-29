import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
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

  it('the inset container opt-in RULE lives in the same layer', () => {
    // Anchor on the rule's selector text, not the bare class name -- the
    // explanatory comment above the rule also says .focus-ring-inset, and
    // an indexOf on that would keep passing with the rule deleted (round-5
    // review caught this pin committing the exact trap its sibling
    // documents).
    const rule = css.indexOf('.focus-ring-inset :where(');
    expect(rule).toBeGreaterThan(css.indexOf('@layer base {'));
  });

  it('NO shared-ui component carries outline-none except the known text-field/dialog set', () => {
    // Repo-wide the invariant is "no selector-MATCHED element defeats the
    // ring"; at unit-test cost we enforce it for all of shared-ui (where
    // every primitive lives) via an allowlist of the files whose
    // outline-none sits on UNMATCHED elements: text inputs/textareas and
    // the tabIndex=-1 Dialog panel. A new outline-none anywhere else in
    // shared-ui fails here and must either be justified (extend the
    // allowlist with a comment) or removed. App-level call sites are
    // review-covered; a per-line context crawl was judged too brittle.
    const ALLOWED = new Set([
      'forms/CodeInput.tsx',        // text inputs
      'forms/PhoneInput.tsx',       // tel text input (its select was cleaned)
      'forms/AddressAutocomplete.tsx', // text input (suggestions use the inset ring)
      'forms/LanguagePicker.tsx',   // custom-language TEXT input (round-3: not a select)
      'components/Input.tsx',
      'components/Textarea.tsx',
      'components/Dialog.tsx',      // tabIndex=-1 panel, excluded by the selector
    ]);
    const walk = (dir: string): string[] =>
      readdirSync(resolve(sharedUi, dir), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(`${dir}/${e.name}`) : e.name.endsWith('.tsx') ? [`${dir}/${e.name}`] : [],
      );
    const offenders = ['components', 'forms', 'enrollment', 'schedule']
      .flatMap((d) => walk(d))
      .filter((rel) => !ALLOWED.has(rel))
      .filter((rel) => readFileSync(resolve(sharedUi, rel), 'utf8').includes('outline-none'));
    expect(offenders, 'files defeating the shared focus ring').toEqual([]);
  });
});
