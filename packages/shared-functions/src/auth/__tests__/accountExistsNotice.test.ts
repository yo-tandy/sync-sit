import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unit pins for the silent existing-account handler wiring (issue #148
// round 2): the untrusted app hint must reach sendAccountExistsEmail
// NORMALIZED, the decoy code doc must be written verbatim, and the send must
// happen before the marker write (transport failure must not stamp the 24h
// guard). Firestore/email/audit are mocked — the emulator suite covers the
// real wiring end to end.

const h = vi.hoisted(() => ({
  writes: [] as { collection: string; id: string; data: Record<string, unknown> }[],
  noticeData: undefined as Record<string, unknown> | undefined,
  sendCalls: [] as { to: string; app: string }[],
  sendError: null as Error | null,
  auditCalls: [] as { userId: string; action: string }[],
}));

vi.mock('../../config/firebase.js', () => ({
  db: {
    collection: (collection: string) => ({
      doc: (id: string) => ({
        get: async () => ({
          exists: collection === 'accountExistsNotices' && h.noticeData !== undefined,
          data: () => (collection === 'accountExistsNotices' ? h.noticeData : undefined),
        }),
        set: async (data: Record<string, unknown>) => {
          h.writes.push({ collection, id, data });
        },
      }),
    }),
  },
}));

vi.mock('../../config/email.js', async (orig) => ({
  // Keep normalizeAccountExistsApp (and friends) real — the pin is that the
  // handler routes the hint THROUGH it before the send.
  ...(await orig<typeof import('../../config/email.js')>()),
  sendAccountExistsEmail: vi.fn(async (to: string, app: string) => {
    h.sendCalls.push({ to, app });
    if (h.sendError) throw h.sendError;
  }),
}));

vi.mock('../../admin/writeAuditLog.js', () => ({
  writeUserActivity: vi.fn(async (userId: string, action: string) => {
    h.auditCalls.push({ userId, action });
  }),
}));

import { handleExistingAccountSignup } from '../accountExistsNotice.js';

const DECOY = {
  code: '123456',
  email: 'owner@ejm.org',
  graduationYear: 2028,
  expiresAt: new Date('2026-08-17T10:10:00Z'),
  attempts: 0,
  createdAt: new Date('2026-08-17T10:00:00Z'),
};

beforeEach(() => {
  h.writes.length = 0;
  h.noticeData = undefined;
  h.sendCalls.length = 0;
  h.sendError = null;
  h.auditCalls.length = 0;
});

describe('handleExistingAccountSignup', () => {
  it("passes a raw 'study' hint to sendAccountExistsEmail as normalized 'study'", async () => {
    const result = await handleExistingAccountSignup('owner@ejm.org', 'study', DECOY);
    expect(result).toEqual({ success: true, message: 'Verification code sent' });
    expect(h.sendCalls).toEqual([{ to: 'owner@ejm.org', app: 'study' }]);
  });

  it("collapses a garbage hint to 'sit' before the send", async () => {
    await handleExistingAccountSignup('owner@ejm.org', '<script>alert(1)</script>', DECOY);
    expect(h.sendCalls).toEqual([{ to: 'owner@ejm.org', app: 'sit' }]);
  });

  it('writes the decoy code doc verbatim under verificationCodes/{email}', async () => {
    await handleExistingAccountSignup('owner@ejm.org', 'sit', DECOY);
    const codeWrite = h.writes.find((w) => w.collection === 'verificationCodes');
    expect(codeWrite).toEqual({ collection: 'verificationCodes', id: 'owner@ejm.org', data: DECOY });
  });

  it('skips the send inside the 24h window but still writes the decoy and returns the fresh body', async () => {
    h.noticeData = { email: 'owner@ejm.org', lastSentAt: new Date(Date.now() - 60 * 60 * 1000) };
    const result = await handleExistingAccountSignup('owner@ejm.org', 'study', DECOY);
    expect(result).toEqual({ success: true, message: 'Verification code sent' });
    expect(h.sendCalls).toEqual([]);
    expect(h.auditCalls).toEqual([]);
    expect(h.writes.map((w) => w.collection)).toEqual(['verificationCodes']);
  });

  it('a transport failure propagates WITHOUT stamping lastSentAt (send-then-mark ordering)', async () => {
    h.sendError = new Error('resend down');
    await expect(handleExistingAccountSignup('owner@ejm.org', 'sit', DECOY)).rejects.toThrow('resend down');
    // The decoy write happened, but no accountExistsNotices marker was set —
    // the next request can retry the owner's warning instead of skipping 24h.
    expect(h.writes.some((w) => w.collection === 'accountExistsNotices')).toBe(false);
    expect(h.auditCalls).toEqual([]);
  });
});
