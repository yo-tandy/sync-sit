import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Push registration pins (issue #168 Phase 1): the study client writes its
// FCM token to the SIBLING `fcmTokensStudy` array — never the legacy
// `fcmTokens` array, which belongs to the sit app.

const h = vi.hoisted(() => ({
  initMessaging: vi.fn(),
  getToken: vi.fn(),
  deleteToken: vi.fn(() => Promise.resolve(true)),
  updateDoc: vi.fn(() => Promise.resolve()),
  requestPermission: vi.fn(() => Promise.resolve('granted' as NotificationPermission)),
}));

vi.mock('@/config/firebase', () => ({
  db: {},
  messaging: null,
  initMessaging: (...args: unknown[]) => h.initMessaging(...args),
}));

vi.mock('firebase/messaging', () => ({
  getToken: (...args: unknown[]) => h.getToken(...args),
  deleteToken: (...args: unknown[]) => h.deleteToken(...args),
  onMessage: vi.fn(() => () => {}),
}));

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  updateDoc: (...args: unknown[]) => h.updateDoc(...args),
  arrayUnion: (v: string) => ({ op: 'arrayUnion', value: v }),
  arrayRemove: (v: string) => ({ op: 'arrayRemove', value: v }),
}));

// The lib captures VITE_FIREBASE_VAPID_KEY at module scope (mirroring sit),
// so it must be (re)imported AFTER stubbing the env — hence dynamic imports.
async function loadLib(vapid = 'test-vapid-key') {
  vi.resetModules();
  vi.stubEnv('VITE_FIREBASE_VAPID_KEY', vapid);
  return await import('../pushNotifications');
}

describe('study push token registration', () => {
  beforeEach(() => {
    h.initMessaging.mockReset().mockResolvedValue({ fake: 'messaging' });
    h.getToken.mockReset().mockResolvedValue('study-token-abc');
    h.deleteToken.mockClear();
    h.updateDoc.mockClear();
    vi.stubGlobal('Notification', {
      permission: 'default',
      requestPermission: h.requestPermission,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('registration writes the token as an arrayUnion on fcmTokensStudy (never fcmTokens)', async () => {
    const lib = await loadLib();
    const token = await lib.requestPushPermission('u1');
    expect(token).toBe('study-token-abc');
    expect(h.updateDoc).toHaveBeenCalledTimes(1);
    const [ref, payload] = h.updateDoc.mock.calls[0] as [
      { path: string },
      Record<string, unknown>,
    ];
    expect(ref.path).toBe('users/u1');
    expect(Object.keys(payload)).toEqual(['fcmTokensStudy']);
    expect(payload.fcmTokensStudy).toEqual({ op: 'arrayUnion', value: 'study-token-abc' });
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

  it('removal writes an arrayRemove on fcmTokensStudy and deletes the FCM token', async () => {
    const lib = await loadLib();
    await lib.removePushToken('u1');
    expect(h.updateDoc).toHaveBeenCalledTimes(1);
    const [ref, payload] = h.updateDoc.mock.calls[0] as [
      { path: string },
      Record<string, unknown>,
    ];
    expect(ref.path).toBe('users/u1');
    expect(Object.keys(payload)).toEqual(['fcmTokensStudy']);
    expect(payload.fcmTokensStudy).toEqual({ op: 'arrayRemove', value: 'study-token-abc' });
    expect(h.deleteToken).toHaveBeenCalled();
  });

  it('isPushSupported reflects the Notification + serviceWorker capabilities', async () => {
    const lib = await loadLib();
    // The stubbed Notification global exists, but jsdom has no serviceWorker.
    expect(lib.isPushSupported()).toBe(false);
  });
});
