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
  it('the ring rule keeps its CONTENT: brand outline + white backing', () => {
    // Position pins alone pass with the declarations gutted (round 6):
    // the brand token is what makes each app ring its own hue, and the
    // white backing is the entire reason the ring survives the red
    // AppBar. Extract the rule block and pin both declarations.
    const start = css.indexOf('):focus-visible');
    const block = css.slice(start, css.indexOf('}', start));
    expect(block).toContain('outline: 2px solid var(--color-brand-600)');
    expect(block).toContain('box-shadow: 0 0 0 2px var(--color-white)');
  });

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
    // allowlist with a comment) or removed. Known limits (round 7): the
    // allowlist is FILE-level while the invariant is element-level, so an
    // outline-none added to a matched element inside an allowlisted file
    // (AddressAutocomplete's suggestion buttons, PhoneInput's select)
    // passes here and relies on review; app-level call sites likewise.
    const ALLOWED = new Set([
      'forms/CodeInput.tsx',        // text inputs
      'forms/PhoneInput.tsx',       // tel text input (its select was cleaned)
      'forms/AddressAutocomplete.tsx', // text input (suggestions use the inset ring)
      'forms/LanguagePicker.tsx',   // custom-language TEXT input (round-3: not a select)
      'components/Input.tsx',
      'components/Textarea.tsx',
      'components/Dialog.tsx',      // tabIndex=-1 panel, excluded by the selector
      'pages/LoginPage.tsx',        // email + password text inputs (round 6)
    ]);
    const walk = (dir: string): string[] =>
      readdirSync(resolve(sharedUi, dir), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(`${dir}/${e.name}`) : e.name.endsWith('.tsx') ? [`${dir}/${e.name}`] : [],
      );
    // Walk the WHOLE package (round 6: a hardcoded dir list missed
    // pages/), skipping only non-component dirs with no .tsx.
    const offenders = readdirSync(resolve(sharedUi, '.'), { withFileTypes: true })
      .flatMap((e) =>
        e.isDirectory() ? walk(e.name) : e.name.endsWith('.tsx') ? [e.name] : [],
      )
      .filter((rel) => !ALLOWED.has(rel))
      .filter((rel) => readFileSync(resolve(sharedUi, rel), 'utf8').includes('outline-none'));
    expect(offenders, 'files defeating the shared focus ring').toEqual([]);
  });

  it('every clipping container is either opted into focus-ring-inset or consciously allowlisted', () => {
    // Round-7 upgrade from a fixed seven-site retention pin: DISCOVER the
    // clipping containers (overflow-hidden AND overflow-*-auto -- per CSS,
    // overflow-x-auto computes overflow-y to auto, so scroll rows clip the
    // ring vertically) line-by-line across shared-ui and all apps, and
    // require each className to carry the opt-in or its site to be
    // allowlisted with a reason. Line-scoped, so moving the class to a
    // different element in the same file no longer slips through, and a
    // NEW clipping menu in any app fails the day it lands.
    const repo = resolve(sharedUi, '../../..');
    // Sites whose focusables clear the 4px ring (padding) or that hold no
    // focusable children. Keyed file:substring so line moves don't break.
    const ALLOWED_CLIPPERS = [
      'SideNav.tsx',            // px-3 py-4 padded scroller -- ring fits
      'Dialog.tsx',             // p-4 padded backdrop scroller
      'ReportProblemPage.tsx',  // p-2 padded read-only log box
    ];
    const roots = ['packages/shared-ui/src', 'apps/web/src', 'apps/study-web/src', 'apps/do-web/src'];
    const walkAbs = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() && e.name !== '__tests__'
          ? walkAbs(`${dir}/${e.name}`)
          : e.name.endsWith('.tsx') ? [`${dir}/${e.name}`] : [],
      );
    const offenders: string[] = [];
    for (const root of roots) {
      for (const file of walkAbs(resolve(repo, root))) {
        const lines = readFileSync(file, 'utf8').split('\n');
        lines.forEach((line, i) => {
          if (!/overflow-(hidden|x-auto|y-auto|auto)/.test(line)) return;
          if (!/className/.test(line)) return;
          if (line.includes('focus-ring-inset')) return;
          // An element's OWN overflow never clips its own outline (only
          // ancestor overflow does). JSX spreads attributes across lines,
          // so join the element OPENING (from its last '<' within a
          // 6-line look-back) and skip when the overflow className belongs
          // to the interactive element itself rather than a wrapper.
          const context = lines.slice(Math.max(0, i - 6), i + 1).join(' ');
          const opening = context.slice(context.lastIndexOf('<'));
          if (/^<(button|a[ >]|select|summary)/.test(opening)) return;
          // pointer-events-none overlays are decorative and hold no
          // reachable focusables.
          if (line.includes('pointer-events-none')) return;
          const short = file.slice(file.lastIndexOf('/') + 1);
          if (ALLOWED_CLIPPERS.some((a) => a.split(':')[0] === short)) return;
          offenders.push(`${file.replace(String(resolve(repo)) + '/', '')}:${i + 1}`);
        });
      }
    }
    expect(offenders, 'clipping containers without the inset opt-in (add the class, or allowlist with a reason)').toEqual([]);
  });
});
