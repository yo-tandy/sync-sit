import { describe, it, expect, beforeEach, vi } from 'vitest';

// Per-app FCM token scoping pins (issue #168 Phase 1). The emulator cannot
// deliver FCM sends, and no push integration pins exist in tests/integration,
// so the token-array selection is pinned HERE with the Firestore read mocked:
// - default (no app) and explicit 'sit' read the legacy `fcmTokens` array —
//   sit caller behavior stays byte-identical;
// - 'study' reads the sibling `fcmTokensStudy` array;
// - invalid-token cleanup removes from the SAME array it read.

const h = vi.hoisted(() => ({
  userData: {} as Record<string, unknown> | undefined,
  update: vi.fn((_payload: unknown) => Promise.resolve()),
  sendEachForMulticast: vi.fn<(msg: unknown) => Promise<unknown>>(),
}));

vi.mock('../firebase.js', () => ({
  db: {
    collection: () => ({
      doc: () => ({
        get: () => Promise.resolve({ data: () => h.userData }),
        update: (payload: unknown) => h.update(payload),
      }),
    }),
  },
  messaging: {
    sendEachForMulticast: (msg: unknown) => h.sendEachForMulticast(msg),
  },
  adminAuth: {},
}));

import { sendPushNotification } from '../push.js';

function allSuccess(count: number) {
  return {
    successCount: count,
    failureCount: 0,
    responses: Array.from({ length: count }, () => ({ success: true })),
  };
}

describe('sendPushNotification token scoping', () => {
  beforeEach(() => {
    h.userData = {
      fcmTokens: ['sit-token-1', 'sit-token-2'],
      fcmTokensStudy: ['study-token-1'],
    };
    h.update.mockClear();
    h.sendEachForMulticast.mockReset();
  });

  it("defaults to app='sit' and reads the legacy fcmTokens array", async () => {
    h.sendEachForMulticast.mockResolvedValue(allSuccess(2));
    const sent = await sendPushNotification('u1', 'T', 'B');
    expect(sent).toBe(true);
    expect(h.sendEachForMulticast).toHaveBeenCalledTimes(1);
    expect(h.sendEachForMulticast.mock.calls[0][0]).toMatchObject({
      tokens: ['sit-token-1', 'sit-token-2'],
    });
  });

  it("explicit 'sit' sends to the same legacy array as the default", async () => {
    h.sendEachForMulticast.mockResolvedValue(allSuccess(2));
    await sendPushNotification('u1', 'T', 'B', undefined, 'sit');
    expect(h.sendEachForMulticast.mock.calls[0][0]).toMatchObject({
      tokens: ['sit-token-1', 'sit-token-2'],
    });
  });

  it("'study' reads fcmTokensStudy — never the sit array", async () => {
    h.sendEachForMulticast.mockResolvedValue(allSuccess(1));
    const sent = await sendPushNotification('u1', 'T', 'B', undefined, 'study');
    expect(sent).toBe(true);
    const msg = h.sendEachForMulticast.mock.calls[0][0] as { tokens: string[] };
    expect(msg.tokens).toEqual(['study-token-1']);
  });

  it("'study' with no study tokens returns false without sending, even when sit tokens exist", async () => {
    h.userData = { fcmTokens: ['sit-token-1'] };
    const sent = await sendPushNotification('u1', 'T', 'B', undefined, 'study');
    expect(sent).toBe(false);
    expect(h.sendEachForMulticast).not.toHaveBeenCalled();
  });

  it("sit with no sit tokens returns false without sending, even when study tokens exist", async () => {
    h.userData = { fcmTokensStudy: ['study-token-1'] };
    const sent = await sendPushNotification('u1', 'T', 'B');
    expect(sent).toBe(false);
    expect(h.sendEachForMulticast).not.toHaveBeenCalled();
  });

  it('cleans up invalid study tokens from fcmTokensStudy — not fcmTokens', async () => {
    h.sendEachForMulticast.mockResolvedValue({
      successCount: 0,
      failureCount: 1,
      responses: [
        { success: false, error: { code: 'messaging/registration-token-not-registered' } },
      ],
    });
    const sent = await sendPushNotification('u1', 'T', 'B', undefined, 'study');
    expect(sent).toBe(false);
    expect(h.update).toHaveBeenCalledTimes(1);
    const payload = h.update.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual(['fcmTokensStudy']);
  });

  it('cleans up invalid sit tokens from fcmTokens (default app)', async () => {
    h.sendEachForMulticast.mockResolvedValue({
      successCount: 1,
      failureCount: 1,
      responses: [
        { success: true },
        { success: false, error: { code: 'messaging/invalid-registration-token' } },
      ],
    });
    const sent = await sendPushNotification('u1', 'T', 'B');
    expect(sent).toBe(true);
    expect(h.update).toHaveBeenCalledTimes(1);
    const payload = h.update.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual(['fcmTokens']);
  });
});
