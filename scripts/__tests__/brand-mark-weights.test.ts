import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * The app-switch bar (#365) renders EVERY app's mark on EVERY screen, and it
 * is phone-only. That makes mark weight a mobile budget, not a nicety.
 *
 * The 256px originals are 93-104 KB each. Shipping the bar against those would
 * put ~294 KB of icon data on every screen of the app, to draw three ~24px
 * tabs. The bar-size variants exist to prevent that, and this pins them --
 * because the regression is invisible: swap a `-48` import back to the full
 * mark and everything still renders correctly, just three hundred kilobytes
 * heavier.
 *
 * Budgets are generous against current sizes (5.5-5.9 KB at 48, 18.7-20.6 KB
 * at 96) so ordinary re-exports do not trip them. Raising one should mean the
 * art changed, not that a file quietly grew.
 */
const ASSETS = resolve(__dirname, '../../packages/shared-ui/src/assets');
const APPS = ['sync-sit', 'sync-study', 'sync-do'];

const BUDGET_KB: Record<string, number> = { '48': 10, '96': 30 };

describe('brand mark weights stay inside the bar budget', () => {
  it.each(APPS.flatMap((a) => Object.keys(BUDGET_KB).map((s) => [a, s] as const)))(
    '%s at %spx is within budget',
    (app, size) => {
      const path = join(ASSETS, `${app}-mark-${size}.png`);
      const kb = statSync(path).size / 1024;
      expect(kb, `${app}-mark-${size}.png is ${kb.toFixed(1)} KB`).toBeLessThan(BUDGET_KB[size]);
    },
  );

  it('every bar-size mark is exported from shared-ui, or the bar cannot import it', () => {
    // A generated asset nobody can reach is worse than no asset: the bar would
    // silently fall back to the 256px export, which is the exact regression
    // above.
    const pkg = JSON.parse(
      readFileSync(resolve(__dirname, '../../packages/shared-ui/package.json'), 'utf8'),
    ) as { exports: Record<string, unknown> };
    for (const app of APPS) {
      for (const size of Object.keys(BUDGET_KB)) {
        expect(pkg.exports).toHaveProperty(`./brand-marks/${app}-${size}.png`);
      }
    }
  });

  it('the 256px originals are still exported — About pages and install prompts want them', () => {
    const pkg = JSON.parse(
      readFileSync(resolve(__dirname, '../../packages/shared-ui/package.json'), 'utf8'),
    ) as { exports: Record<string, unknown> };
    for (const app of APPS) {
      expect(pkg.exports).toHaveProperty(`./brand-marks/${app}.png`);
    }
  });
});
