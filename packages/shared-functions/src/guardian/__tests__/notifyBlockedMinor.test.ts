import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * `notifyBlockedMinor` (issue #421, option 1b): what happens to the CHILD's
 * own notification when the last parent of their family is erased and, being
 * unable to prove 15+, they are blocked.
 *
 * Pinned here rather than in the emulator suite for the same reason
 * `guardianNotifyCounts.test.ts` gives for the #368 mirror case: the
 * emulator's mail transport short-circuits to `true` for any address, so a
 * failing send — the exact case the best-effort wrapper in `admin/deleteUser.ts`
 * exists to tolerate — cannot be staged there without a document shape
 * production never writes. Mocking the transports makes the channel results
 * an INPUT.
 *
 * The end-to-end half — that a real last-parent erasure reaches this
 * function with the right child, in the right order relative to
 * `adminAuth.updateUser(..., { disabled: true })` — lives in
 * `tests/integration/guardian/gdpr-guardian.test.ts`. The best-effort
 * SWALLOW (a throw here must not abort the erasure) is pinned in
 * `admin/__tests__/notifyBlockedMinorBestEffort.test.ts`, for the same
 * reason `notifyGuardiansOfSelfDelete`'s own swallow is pinned apart from its
 * content.
 */

const h = vi.hoisted(() => ({
  email: ((_to: string) => true) as (to: string) => boolean,
  push: ((_uid: string) => false) as (uid: string) => boolean,
  written: [] as Record<string, unknown>[],
  emailCalls: [] as { to: string; subject: string; html: string; app: unknown }[],
  pushApps: [] as unknown[],
  pushPayloads: [] as (Record<string, string> | undefined)[],
}));

vi.mock('../../config/firebase.js', () => ({
  db: {
    collection: (name: string) => {
      if (name === 'notifications') {
        return {
          add: async (doc: Record<string, unknown>) => {
            h.written.push(doc);
          },
        };
      }
      throw new Error(`unexpected collection ${name}`);
    },
  },
}));

vi.mock('../../config/email.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/email.js')>();
  return {
    ...actual,
    sendNotificationEmail: async (to: string, subject: string, html: string, app: unknown) => {
      h.emailCalls.push({ to, subject, html, app });
      return h.email(to);
    },
  };
});

vi.mock('../../config/push.js', () => ({
  sendPushNotification: async (
    uid: string,
    _title: string,
    _body: string,
    data?: Record<string, string>,
    app?: unknown,
  ) => {
    h.pushApps.push(app);
    h.pushPayloads.push(data);
    return h.push(uid);
  },
}));

import { notifyBlockedMinor, BLOCKED_MINOR_NOTIFICATION_TYPE } from '../notifyBlockedMinor.js';

describe('notifyBlockedMinor', () => {
  beforeEach(() => {
    h.email = () => true;
    h.push = () => false;
    h.written.length = 0;
    h.emailCalls.length = 0;
    h.pushApps.length = 0;
    h.pushPayloads.length = 0;
  });

  it('emails, pushes, and writes a durable notification for an English child', async () => {
    const result = await notifyBlockedMinor(
      { email: 'kid@example.com', firstName: 'Zoe', language: 'en' },
      'kid1',
      new Date('2026-09-11T00:00:00Z'),
    );
    expect(result).toEqual({ emailSent: true, pushSent: false });

    expect(h.emailCalls).toHaveLength(1);
    expect(h.emailCalls[0].to).toBe('kid@example.com');
    expect(h.emailCalls[0].html).toContain('Zoe');
    // Support path (#363's verified address), never a second invented one.
    expect(h.emailCalls[0].html).toContain('support@sync-sit.com');
    // What it means: paused, not a second erasure.
    expect(h.emailCalls[0].html.toLowerCase()).toContain('paused');

    expect(h.pushApps).toEqual(['auto']);
    expect(h.pushPayloads[0]).toEqual({ type: BLOCKED_MINOR_NOTIFICATION_TYPE });

    expect(h.written).toHaveLength(1);
    const doc = h.written[0];
    expect(doc.recipientUserId).toBe('kid1');
    expect(doc.type).toBe(BLOCKED_MINOR_NOTIFICATION_TYPE);
    expect(doc.read).toBe(false);
    expect(doc.channels).toEqual(['email', 'push']);
    expect(doc.emailSent).toBe(true);
    expect(doc.pushSent).toBe(false);
  });

  it('localises to French when the child language is fr', async () => {
    await notifyBlockedMinor(
      { email: 'kid@example.com', firstName: 'Zoe', language: 'fr' },
      'kid1',
      new Date(),
    );
    expect(h.emailCalls[0].subject).toBe('Votre compte est suspendu');
    expect(h.emailCalls[0].html).toContain('suspendu');
    expect(h.emailCalls[0].html).toContain('support@sync-sit.com');
  });

  it('defaults to English for any language other than fr, including absent', async () => {
    await notifyBlockedMinor({ email: 'a@example.com' }, 'kid1', new Date());
    expect(h.emailCalls[0].subject).toBe('Your account is paused');

    h.emailCalls.length = 0;
    await notifyBlockedMinor(
      { email: 'a@example.com', language: 'es' },
      'kid1',
      new Date(),
    );
    expect(h.emailCalls[0].subject).toBe('Your account is paused');
  });

  it('sends no email when the child has none, but still pushes and writes the doc', async () => {
    const result = await notifyBlockedMinor({ language: 'en' }, 'kid1', new Date());
    expect(result.emailSent).toBe(false);
    expect(h.emailCalls).toHaveLength(0);
    expect(h.written).toHaveLength(1);
    expect(h.written[0].emailSent).toBe(false);
  });

  it("routes the push with 'auto', not a hardcoded app", async () => {
    await notifyBlockedMinor({ email: 'a@example.com', language: 'en' }, 'kid1', new Date());
    expect(h.pushApps).toEqual(['auto']);
  });

  it('escapes the first name in the email HTML', async () => {
    await notifyBlockedMinor(
      { email: 'a@example.com', firstName: '<script>alert(1)</script>', language: 'en' },
      'kid1',
      new Date(),
    );
    expect(h.emailCalls[0].html).not.toContain('<script>');
    expect(h.emailCalls[0].html).toContain('&lt;script&gt;');
  });

  it('counts NOBODY reached when every channel fails, though the doc is still written', async () => {
    h.email = () => false;
    h.push = () => false;
    const result = await notifyBlockedMinor(
      { email: 'a@example.com', language: 'en' },
      'kid1',
      new Date(),
    );
    expect(result).toEqual({ emailSent: false, pushSent: false });
    expect(h.written[0].emailSent).toBe(false);
    expect(h.written[0].pushSent).toBe(false);
  });
});
