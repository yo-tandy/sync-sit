import { describe, it, expect, beforeEach, vi } from 'vitest';

// Per-app FCM token scoping pins (issue #168 Phase 1). The emulator cannot
// deliver FCM sends, and no push integration pins exist in tests/integration,
// so the token-array selection is pinned HERE with the Firestore read mocked:
// - default (no app) and explicit 'sit' read the legacy `fcmTokens` array —
//   sit caller behavior stays byte-identical;
// - 'study' reads the sibling `fcmTokensStudy` array;
// - invalid-token cleanup removes from the SAME array it read.
//
// Phase 2 (per-recipient affinity, app='auto') is pinned below: single-array
// recipients route to their installed app, dual-install recipients follow the
// caller's `world` hint (default 'sit'), token-less recipients short-circuit,
// and cleanup targets the array the resolution actually used.

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

import { derivePushWorld, sendPushNotification } from '../push.js';

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

  it("'study' reads fcmTokensStudy — never the sit array — and carries the 512px icon", async () => {
    h.sendEachForMulticast.mockResolvedValue(allSuccess(1));
    const sent = await sendPushNotification('u1', 'T', 'B', undefined, 'study');
    expect(sent).toBe(true);
    const msg = h.sendEachForMulticast.mock.calls[0][0] as {
      tokens: string[];
      webpush: { notification: { icon: string } };
    };
    expect(msg.tokens).toEqual(['study-token-1']);
    // The notification icon is the downscaled manifest variant, not the
    // 1.6MB logo.png (PR #192 review).
    expect(msg.webpush.notification.icon).toBe('https://sync-study-app.web.app/icon-512.png');
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

  it("'do' reads fcmTokensDo — never the sibling arrays — and carries the do 192px icon (sync-do §13 PR9)", async () => {
    h.userData = {
      fcmTokens: ['sit-token-1'],
      fcmTokensStudy: ['study-token-1'],
      fcmTokensDo: ['do-token-1'],
    };
    h.sendEachForMulticast.mockResolvedValue(allSuccess(1));
    const sent = await sendPushNotification('u1', 'T', 'B', undefined, 'do');
    expect(sent).toBe(true);
    const msg = h.sendEachForMulticast.mock.calls[0][0] as {
      tokens: string[];
      webpush: { notification: { icon: string }; fcmOptions: { link: string } };
    };
    expect(msg.tokens).toEqual(['do-token-1']);
    expect(msg.webpush.notification.icon).toBe('https://sync-do-app.web.app/icon-192.png');
    expect(msg.webpush.fcmOptions.link).toBe('https://sync-do-app.web.app');
  });

  it("'do' with no do tokens returns false without sending, even when sibling tokens exist", async () => {
    h.userData = { fcmTokens: ['sit-token-1'], fcmTokensStudy: ['study-token-1'] };
    const sent = await sendPushNotification('u1', 'T', 'B', undefined, 'do');
    expect(sent).toBe(false);
    expect(h.sendEachForMulticast).not.toHaveBeenCalled();
  });

  it('cleans up invalid do tokens from fcmTokensDo — not the sibling arrays', async () => {
    h.userData = { fcmTokens: ['sit-token-1'], fcmTokensDo: ['do-token-1'] };
    h.sendEachForMulticast.mockResolvedValue({
      successCount: 0,
      failureCount: 1,
      responses: [
        { success: false, error: { code: 'messaging/registration-token-not-registered' } },
      ],
    });
    const sent = await sendPushNotification('u1', 'T', 'B', undefined, 'do');
    expect(sent).toBe(false);
    expect(h.update).toHaveBeenCalledTimes(1);
    const payload = h.update.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual(['fcmTokensDo']);
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

// Per-recipient affinity routing (issue #168 Phase 2). app='auto' resolves
// the app from the RECIPIENT's token arrays, so the shared guardian callables
// and the guardian mirror reach study-only users they previously missed.
describe("sendPushNotification app='auto' affinity routing", () => {
  const SIT_ICON = 'https://sync-sit.com/icon-192.png';
  const STUDY_ICON = 'https://sync-study-app.web.app/icon-512.png';

  function lastMessage() {
    return h.sendEachForMulticast.mock.calls[0][0] as {
      tokens: string[];
      webpush: { notification: { icon: string } };
    };
  }

  beforeEach(() => {
    h.update.mockClear();
    h.sendEachForMulticast.mockReset();
  });

  it('sit-only recipient routes to fcmTokens with sit branding', async () => {
    h.userData = { fcmTokens: ['sit-token-1', 'sit-token-2'] };
    h.sendEachForMulticast.mockResolvedValue(allSuccess(2));
    const sent = await sendPushNotification('u1', 'T', 'B', undefined, 'auto');
    expect(sent).toBe(true);
    expect(lastMessage().tokens).toEqual(['sit-token-1', 'sit-token-2']);
    expect(lastMessage().webpush.notification.icon).toBe(SIT_ICON);
  });

  it('study-only recipient routes to fcmTokensStudy with study branding — the closed Phase 2 gap', async () => {
    h.userData = { fcmTokensStudy: ['study-token-1'] };
    h.sendEachForMulticast.mockResolvedValue(allSuccess(1));
    const sent = await sendPushNotification('u1', 'T', 'B', undefined, 'auto');
    expect(sent).toBe(true);
    expect(lastMessage().tokens).toEqual(['study-token-1']);
    expect(lastMessage().webpush.notification.icon).toBe(STUDY_ICON);
  });

  it("dual-install recipient follows a 'study' world hint", async () => {
    h.userData = { fcmTokens: ['sit-token-1'], fcmTokensStudy: ['study-token-1'] };
    h.sendEachForMulticast.mockResolvedValue(allSuccess(1));
    await sendPushNotification('u1', 'T', 'B', undefined, 'auto', 'study');
    expect(lastMessage().tokens).toEqual(['study-token-1']);
    expect(lastMessage().webpush.notification.icon).toBe(STUDY_ICON);
  });

  it("dual-install recipient follows a 'sit' world hint", async () => {
    h.userData = { fcmTokens: ['sit-token-1'], fcmTokensStudy: ['study-token-1'] };
    h.sendEachForMulticast.mockResolvedValue(allSuccess(1));
    await sendPushNotification('u1', 'T', 'B', undefined, 'auto', 'sit');
    expect(lastMessage().tokens).toEqual(['sit-token-1']);
    expect(lastMessage().webpush.notification.icon).toBe(SIT_ICON);
  });

  it('dual-install recipient with no hint defaults to sit — pre-Phase-2 behavior preserved', async () => {
    h.userData = { fcmTokens: ['sit-token-1'], fcmTokensStudy: ['study-token-1'] };
    h.sendEachForMulticast.mockResolvedValue(allSuccess(1));
    await sendPushNotification('u1', 'T', 'B', undefined, 'auto');
    expect(lastMessage().tokens).toEqual(['sit-token-1']);
    expect(lastMessage().webpush.notification.icon).toBe(SIT_ICON);
  });

  it('recipient with no tokens in either array returns false without sending', async () => {
    h.userData = {};
    const sent = await sendPushNotification('u1', 'T', 'B', undefined, 'auto');
    expect(sent).toBe(false);
    expect(h.sendEachForMulticast).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
  });

  const DO_ICON = 'https://sync-do-app.web.app/icon-192.png';

  it('do-only recipient routes to fcmTokensDo with do branding (three-way affinity, sync-do §13 PR9)', async () => {
    h.userData = { fcmTokensDo: ['do-token-1'] };
    h.sendEachForMulticast.mockResolvedValue(allSuccess(1));
    const sent = await sendPushNotification('u1', 'T', 'B', undefined, 'auto');
    expect(sent).toBe(true);
    expect(lastMessage().tokens).toEqual(['do-token-1']);
    expect(lastMessage().webpush.notification.icon).toBe(DO_ICON);
  });

  it("triple-install recipient follows a 'do' world hint", async () => {
    h.userData = {
      fcmTokens: ['sit-token-1'],
      fcmTokensStudy: ['study-token-1'],
      fcmTokensDo: ['do-token-1'],
    };
    h.sendEachForMulticast.mockResolvedValue(allSuccess(1));
    await sendPushNotification('u1', 'T', 'B', undefined, 'auto', 'do');
    expect(lastMessage().tokens).toEqual(['do-token-1']);
    expect(lastMessage().webpush.notification.icon).toBe(DO_ICON);
  });

  it("a 'do' world hint with NO do tokens falls back instead of short-circuiting to a false negative", async () => {
    h.userData = { fcmTokens: ['sit-token-1'], fcmTokensStudy: ['study-token-1'] };
    h.sendEachForMulticast.mockResolvedValue(allSuccess(1));
    const sent = await sendPushNotification('u1', 'T', 'B', undefined, 'auto', 'do');
    expect(sent).toBe(true);
    expect(lastMessage().tokens).toEqual(['sit-token-1']);
  });

  it('cleanup under auto writes to the array the resolution actually used', async () => {
    h.userData = { fcmTokensStudy: ['study-token-1'] };
    h.sendEachForMulticast.mockResolvedValue({
      successCount: 0,
      failureCount: 1,
      responses: [
        { success: false, error: { code: 'messaging/registration-token-not-registered' } },
      ],
    });
    const sent = await sendPushNotification('u1', 'T', 'B', undefined, 'auto');
    expect(sent).toBe(false);
    expect(h.update).toHaveBeenCalledTimes(1);
    const payload = h.update.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual(['fcmTokensStudy']);
  });
});

// The guardian mirror (apps/functions onNotificationCreated) derives its
// `world` hint from the mirrored notification's ORIGINAL type via this
// exported helper — pinned here because apps/functions has no test runner.
describe('derivePushWorld', () => {
  it('maps study_* types to the study world', () => {
    expect(derivePushWorld('study_session_request')).toBe('study');
    expect(derivePushWorld('study_contact_request')).toBe('study');
  });

  it('maps tutor_endorsement_* types to the study world', () => {
    expect(derivePushWorld('tutor_endorsement_received')).toBe('study');
  });

  it('maps the §10 do set — task_*, new_task_matching, doer_endorsement_* — to the do world', () => {
    expect(derivePushWorld('task_offer_received')).toBe('do');
    expect(derivePushWorld('task_guardian_approval')).toBe('do');
    expect(derivePushWorld('new_task_matching')).toBe('do');
    expect(derivePushWorld('doer_endorsement_received')).toBe('do');
  });

  it('maps everything else to the sit world', () => {
    expect(derivePushWorld('new_request')).toBe('sit');
    expect(derivePushWorld('supervision_revoked')).toBe('sit');
    expect(derivePushWorld('')).toBe('sit');
  });
});
