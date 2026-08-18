import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

// Static PWA asset pins (issue #193, mirroring study's PR #192). These files
// are copied verbatim into dist by Vite, so their content is asserted here at
// the source.

const root = resolve(import.meta.dirname, '../..');

describe('PWA static assets', () => {
  it('ships a manifest with standalone display and sit branding', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'public/manifest.webmanifest'), 'utf8'));
    expect(manifest.name).toBe('Sync/Sit');
    // display:standalone is what makes isRunningAsPWA() true after install —
    // the whole push gating chain hangs off it.
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    // Downscaled 192/512 variants only; both stay purpose "any" — the artwork
    // is full-bleed, so Android's adaptive-icon mask would clip it;
    // letterboxed-but-intact beats clipped (PR #192 review). A dedicated
    // padded maskable asset is the upgrade path.
    // The 1.4MB logo.png/favicon.png are deliberately NOT listed: Android's
    // WebAPK installer downloads manifest icons (largest wins for the splash),
    // and 192+512 already satisfy Chrome's requirements.
    const icons = manifest.icons as { src: string; sizes: string; purpose?: string }[];
    expect(icons.map((i) => [i.src, i.sizes])).toEqual([
      ['/icon-192.png', '192x192'],
      ['/icon-512.png', '512x512'],
    ]);
    expect(icons[1].purpose).toBe('any');
  });

  it('the manifest icons exist and stay small', () => {
    // Guard against someone swapping in the full-resolution 1.4MB source.
    expect(statSync(resolve(root, 'public/icon-192.png')).size).toBeLessThan(200 * 1024);
    expect(statSync(resolve(root, 'public/icon-512.png')).size).toBeLessThan(500 * 1024);
  });

  it('index.html links the manifest and carries the PWA meta tags', () => {
    const html = readFileSync(resolve(root, 'index.html'), 'utf8');
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('/manifest.webmanifest');
    // iOS fetches the apple-touch-icon on add-to-home-screen; it must point at
    // the small downscaled icon, not the 1.4MB favicon.png (PR #192 review).
    expect(html).toContain('<link rel="apple-touch-icon" href="/icon-192.png" />');
    // The tab favicon too: every first page load fetched the 1.4MB
    // favicon.png before this (same fix study took in PR #192 round 4).
    expect(html).toContain('<link rel="icon" type="image/png" href="/icon-192.png" />');
    // iOS: navigator.standalone (used by isRunningAsPWA) needs this meta.
    expect(html).toContain('apple-mobile-web-app-capable');
    expect(html).toContain('Sync/Sit');
  });

  it('ships the FCM service worker with the production config and a notificationclick handler', () => {
    const sw = readFileSync(resolve(root, 'public/firebase-messaging-sw.js'), 'utf8');
    expect(sw).toContain("projectId: 'sync-sit'");
    expect(sw).toContain("messagingSenderId: '652129443234'");
    expect(sw).toContain('onBackgroundMessage');
    expect(sw).toContain('notificationclick');
    expect(sw).toContain("clients.openWindow('/')");
  });
});
