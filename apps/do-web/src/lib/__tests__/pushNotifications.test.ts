import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Push registration pins (sync-do plan §13 PR9, issue #297): the do client
// writes its FCM token to the SIBLING `fcmTokensDo` array — never the legacy
// `fcmTokens` array (sit's) or `fcmTokensStudy`. Mirrors the study suite.

// The `doc` mock below collapses a Firestore reference to just its path, so
// `{ path: string }` is the reference type `updateDoc` actually receives here.
const h = vi.hoisted(() => ({
  initMessaging: vi.fn(),
  getToken: vi.fn(),
  deleteToken: vi.fn<(messaging: unknown) => Promise<boolean>>(() => Promise.resolve(true)),
  updateDoc: vi.fn<(ref: { path: string }, data: Record<string, unknown>) => Promise<void>>(() =>
    Promise.resolve(),
  ),
  requestPermission: vi.fn(() => Promise.resolve('granted' as NotificationPermission)),
}));

vi.mock('@/config/firebase', () => ({
  db: {},
  messaging: null,
  initMessaging: (...args: unknown[]) => h.initMessaging(...args),
}));

vi.mock('firebase/messaging', () => ({
  getToken: (...args: unknown[]) => h.getToken(...args),
  deleteToken: (...args: [messaging: unknown]) => h.deleteToken(...args),
  onMessage: vi.fn(() => () => {}),
}));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  updateDoc: (...args: [ref: { path: string }, data: Record<string, unknown>]) =>
    h.updateDoc(...args),
  arrayUnion: (v: string) => ({ op: 'arrayUnion', value: v }),
  arrayRemove: (v: string) => ({ op: 'arrayRemove', value: v }),
}));

// The lib captures VITE_FIREBASE_VAPID_KEY at module scope (mirroring
// sit/study), so it must be (re)imported AFTER stubbing the env — hence
// dynamic imports.
async function loadLib(vapid = 'test-vapid-key') {
  vi.resetModules();
  vi.stubEnv('VITE_FIREBASE_VAPID_KEY', vapid);
  return await import('../pushNotifications');
}

describe('do push token registration', () => {
  beforeEach(() => {
    h.initMessaging.mockReset().mockResolvedValue({ fake: 'messaging' });
    h.getToken.mockReset().mockResolvedValue('do-token-abc');
    h.deleteToken.mockClear();
    h.updateDoc.mockClear();
    h.requestPermission.mockClear();
    vi.stubGlobal('Notification', {
      permission: 'default',
      requestPermission: h.requestPermission,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('registration writes the token as an arrayUnion on fcmTokensDo (never fcmTokens/fcmTokensStudy)', async () => {
    const lib = await loadLib();
    const token = await lib.requestPushPermission('u1');
    expect(token).toBe('do-token-abc');
    expect(h.updateDoc).toHaveBeenCalledTimes(1);
    const [ref, payload] = h.updateDoc.mock.calls[0];
    expect(ref.path).toBe('users/u1');
    expect(Object.keys(payload)).toEqual(['fcmTokensDo']);
    expect(payload.fcmTokensDo).toEqual({ op: 'arrayUnion', value: 'do-token-abc' });
  });

  it('returns null without writing when permission is denied', async () => {
    const lib = await loadLib();
    h.requestPermission.mockResolvedValueOnce('denied' as NotificationPermission);
    const token = await lib.requestPushPermission('u1');
    expect(token).toBeNull();
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  it('returns null without initializing messaging when no VAPID key is configured', async () => {
    const lib = await loadLib('');
    const token = await lib.requestPushPermission('u1');
    expect(token).toBeNull();
    expect(h.initMessaging).not.toHaveBeenCalled();
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  it('removal writes an arrayRemove on fcmTokensDo and deletes the FCM token', async () => {
    const lib = await loadLib();
    // The user in this test HAS opted in: permission granted, SW available.
    vi.stubGlobal('Notification', { permission: 'granted', requestPermission: h.requestPermission });
    vi.stubGlobal('navigator', { ...navigator, serviceWorker: {} });
    await lib.removePushToken('u1');
    expect(h.updateDoc).toHaveBeenCalledTimes(1);
    const [ref, payload] = h.updateDoc.mock.calls[0];
    expect(ref.path).toBe('users/u1');
    expect(Object.keys(payload)).toEqual(['fcmTokensDo']);
    expect(payload.fcmTokensDo).toEqual({ op: 'arrayRemove', value: 'do-token-abc' });
    expect(h.deleteToken).toHaveBeenCalled();
  });

  it('removal is a no-op for a user who never opted into push', async () => {
    // removePushToken runs on EVERY logout (authStore). Without this guard,
    // getToken would REQUEST notification permission — a native prompt at
    // the moment of sign-out — and register the service worker the lazy
    // initMessaging exists to defer (PR #192 review).
    const lib = await loadLib();
    vi.stubGlobal('Notification', { permission: 'default', requestPermission: h.requestPermission });
    vi.stubGlobal('navigator', { ...navigator, serviceWorker: {} });
    await lib.removePushToken('u1');
    expect(h.initMessaging).not.toHaveBeenCalled();
    expect(h.getToken).not.toHaveBeenCalled();
    expect(h.requestPermission).not.toHaveBeenCalled();
    expect(h.updateDoc).not.toHaveBeenCalled();
  });

  it('isPushSupported reflects the Notification + serviceWorker capabilities', async () => {
    const lib = await loadLib();
    // The stubbed Notification global exists, but jsdom has no serviceWorker.
    expect(lib.isPushSupported()).toBe(false);
  });
});
