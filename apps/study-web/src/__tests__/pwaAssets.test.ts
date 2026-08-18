import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Static PWA asset pins (issues #162 + #168 Phase 1). These files are copied
// verbatim into dist by Vite, so their content is asserted here at the source.

const root = resolve(import.meta.dirname, '../..');

describe('PWA static assets', () => {
  it('ships a manifest with standalone display and study branding', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'public/manifest.webmanifest'), 'utf8'));
    expect(manifest.name).toBe('Sync/Study');
    // display:standalone is what makes isRunningAsPWA() true after install —
    // the whole push gating chain hangs off it.
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    // Downscaled 192/512 variants + the full logo; the 512 stays purpose
    // "any" — the artwork is full-bleed (wordmark to the edge), so Android's
    // adaptive-icon mask would clip it; letterboxed-but-intact beats clipped
    // (PR #192 review). A dedicated padded maskable asset is the upgrade path.
    // The 1.6MB logo.png is deliberately NOT listed: Android's WebAPK
    // installer downloads manifest icons (largest wins for the splash), and
    // 192+512 already satisfy Chrome's requirements.
    const icons = manifest.icons as { src: string; sizes: string; purpose?: string }[];
    expect(icons.map((i) => [i.src, i.sizes])).toEqual([
      ['/icon-192.png', '192x192'],
      ['/icon-512.png', '512x512'],
    ]);
    expect(icons[1].purpose).toBe('any');
  });

  it('index.html links the manifest and carries the PWA meta tags', () => {
    const html = readFileSync(resolve(root, 'index.html'), 'utf8');
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('/manifest.webmanifest');
    expect(html).toContain('apple-touch-icon');
    // iOS: navigator.standalone (used by isRunningAsPWA) needs this meta.
    expect(html).toContain('apple-mobile-web-app-capable');
    expect(html).toContain('Sync/Study');
  });

  it('ships the FCM service worker with the production config and a notificationclick handler', () => {
    const sw = readFileSync(resolve(root, 'public/firebase-messaging-sw.js'), 'utf8');
    // Static file — hardcodes the same public prod config the CI build injects
    // (study-web reuses the sit web-app registration; see the CI workflows).
    expect(sw).toContain("projectId: 'sync-sit'");
    expect(sw).toContain("messagingSenderId: '652129443234'");
    expect(sw).toContain('onBackgroundMessage');
    expect(sw).toContain('notificationclick');
    expect(sw).toContain("clients.openWindow('/')");
  });
});
