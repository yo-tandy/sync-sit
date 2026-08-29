import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Static PWA asset pins, mirroring study-web's suite (issues #162/#168; icon
// sizes per sit's #197 manifest work). These files are copied verbatim into
// dist by Vite, so their content is asserted here at the source.

const root = resolve(import.meta.dirname, '../..');

describe('PWA static assets', () => {
  it('ships a manifest with standalone display and do branding', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'public/manifest.webmanifest'), 'utf8'));
    expect(manifest.name).toBe('Sync/Do');
    expect(manifest.display).toBe('standalone');
    expect(manifest.start_url).toBe('/');
    // brand-600 (§9.0): the AA-measured primary green, same token the
    // siblings use for their theme_color.
    expect(manifest.theme_color).toBe('#0d8204');
    const icons = manifest.icons as { src: string; sizes: string; purpose?: string }[];
    expect(icons.map((i) => [i.src, i.sizes])).toEqual([
      ['/icon-192.png', '192x192'],
      ['/icon-512.png', '512x512'],
    ]);
    expect(icons[1].purpose).toBe('any');
  });

  it('ships the icon files the manifest and index.html point at', () => {
    for (const f of ['public/icon-192.png', 'public/icon-512.png', 'public/logo.png']) {
      expect(existsSync(resolve(root, f)), f).toBe(true);
    }
  });

  it('index.html links the manifest and carries the PWA meta tags', () => {
    const html = readFileSync(resolve(root, 'index.html'), 'utf8');
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('/manifest.webmanifest');
    expect(html).toContain('apple-touch-icon');
    expect(html).toContain('apple-mobile-web-app-capable');
    expect(html).toContain('Sync/Do');
    expect(html).toContain('content="#0d8204"');
  });

  it('ships the FCM service worker (plan §13 PR9), on the shared web-app registration like study', () => {
    const sw = readFileSync(resolve(root, 'public/firebase-messaging-sw.js'), 'utf8');
    // Same public registration values the siblings' SWs hardcode (Vite env
    // is unavailable in a static SW) — the per-app token split lives in
    // Firestore (fcmTokensDo), not in this registration.
    expect(sw).toContain("projectId: 'sync-sit'");
    expect(sw).toContain('onBackgroundMessage');
    expect(sw).toContain('notificationclick');
  });
});
