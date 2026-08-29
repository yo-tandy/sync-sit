import { describe, it, expect, beforeEach, vi } from 'vitest';

// Send-plumbing pins for the sync-do notification module (plan §13 PR9):
// per-recipient language selection, NotifPrefs gating on the EXISTING
// categories (no per-app prefs — issue #168 Phase-2 is not pre-empted),
// app='do' threading to both transports, honest emailSent/pushSent audit
// fields, and the post-commit swallow. Collaborators mocked — the emulator
// cannot fault-inject transports, and apps/functions' testable units are
// pinned here (the runner this PR adds, mirroring study-functions).

const h = vi.hoisted(() => ({
  users: {} as Record<string, Record<string, unknown> | undefined>,
  families: {} as Record<string, Record<string, unknown> | undefined>,
  added: [] as Record<string, unknown>[],
  sendNotificationEmail: vi.fn<(...a: unknown[]) => Promise<boolean>>(() => Promise.resolve(true)),
  sendPushNotification: vi.fn<(...a: unknown[]) => Promise<boolean>>(() => Promise.resolve(true)),
}));

vi.mock('../../config/firebase.js', () => ({
  db: {
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: () =>
          Promise.resolve({
            data: () => (name === 'users' ? h.users[id] : h.families[id]),
          }),
      }),
      add: (doc: Record<string, unknown>) => {
        h.added.push(doc);
        return Promise.resolve({ id: `n${h.added.length}` });
      },
    }),
  },
}));
vi.mock('../../config/email.js', () => ({
  sendNotificationEmail: (...a: unknown[]) => h.sendNotificationEmail(...a),
}));
vi.mock('../../config/push.js', () => ({
  sendPushNotification: (...a: unknown[]) => h.sendPushNotification(...a),
}));

import { notifyDoFamilyParents, notifyDoSafely, sendDoNotificationToUser } from '../notify.js';
import type { DoLang } from '../notifyContent.js';

function contentFor(lang: DoLang) {
  return {
    subject: `subject-${lang}`,
    emailBody: `<p>body-${lang}</p>`,
    title: `title-${lang}`,
    body: `push-${lang}`,
  };
}

describe('sendDoNotificationToUser', () => {
  beforeEach(() => {
    h.users = {
      u1: { email: 'u1@ejm.org', language: 'fr', notifPrefs: {} },
    };
    h.families = {};
    h.added = [];
    h.sendNotificationEmail.mockClear().mockResolvedValue(true);
    h.sendPushNotification.mockClear().mockResolvedValue(true);
  });

  it("selects the recipient's language and brands both transports 'do'", async () => {
    await sendDoNotificationToUser({
      recipientUserId: 'u1',
      type: 'task_offer_received',
      prefCategory: 'newRequest',
      content: contentFor,
      data: { taskId: 't1' },
    });
    expect(h.sendNotificationEmail).toHaveBeenCalledWith(
      'u1@ejm.org',
      'subject-fr',
      '<p>body-fr</p>',
      'do',
    );
    expect(h.sendPushNotification).toHaveBeenCalledWith(
      'u1',
      'title-fr',
      'push-fr',
      { taskId: 't1', type: 'task_offer_received' },
      'do',
    );
    expect(h.added).toHaveLength(1);
    expect(h.added[0]).toMatchObject({
      recipientUserId: 'u1',
      type: 'task_offer_received',
      title: 'title-fr',
      body: 'push-fr',
      emailSent: true,
      pushSent: true,
      read: false,
    });
  });

  it('defaults to EN when language is absent', async () => {
    h.users.u1 = { email: 'u1@ejm.org', notifPrefs: {} };
    await sendDoNotificationToUser({
      recipientUserId: 'u1',
      type: 'task_updated',
      prefCategory: 'newRequest',
      content: contentFor,
    });
    expect(h.sendNotificationEmail.mock.calls[0][1]).toBe('subject-en');
  });

  it('honors the pref category: email off suppresses email, push off suppresses push — the doc records false', async () => {
    h.users.u1 = {
      email: 'u1@ejm.org',
      language: 'en',
      notifPrefs: { cancelled: { email: false, push: false } },
    };
    await sendDoNotificationToUser({
      recipientUserId: 'u1',
      type: 'task_cancelled',
      prefCategory: 'cancelled',
      content: contentFor,
    });
    expect(h.sendNotificationEmail).not.toHaveBeenCalled();
    expect(h.sendPushNotification).not.toHaveBeenCalled();
    expect(h.added[0]).toMatchObject({ emailSent: false, pushSent: false });
  });

  it('prefCategory null (the digest) bypasses NotifPrefs entirely — notifyNewTasks is its own opt-in', async () => {
    h.users.u1 = {
      email: 'u1@ejm.org',
      language: 'en',
      notifPrefs: {
        newRequest: { email: false, push: false },
        confirmed: { email: false, push: false },
        cancelled: { email: false, push: false },
      },
    };
    await sendDoNotificationToUser({
      recipientUserId: 'u1',
      type: 'new_task_matching',
      prefCategory: null,
      content: contentFor,
    });
    expect(h.sendNotificationEmail).toHaveBeenCalledTimes(1);
    expect(h.sendPushNotification).toHaveBeenCalledTimes(1);
  });

  it('records honest audit fields when the transports report failure', async () => {
    h.sendNotificationEmail.mockResolvedValue(false);
    h.sendPushNotification.mockResolvedValue(false);
    await sendDoNotificationToUser({
      recipientUserId: 'u1',
      type: 'task_marked_done',
      prefCategory: 'confirmed',
      content: contentFor,
    });
    expect(h.added[0]).toMatchObject({ emailSent: false, pushSent: false });
  });

  it('missing recipient doc: no sends, no notification doc', async () => {
    await sendDoNotificationToUser({
      recipientUserId: 'ghost',
      type: 'task_updated',
      prefCategory: 'newRequest',
      content: contentFor,
    });
    expect(h.added).toHaveLength(0);
    expect(h.sendNotificationEmail).not.toHaveBeenCalled();
  });

  it('uses caller-supplied recipientData without refetching', async () => {
    await sendDoNotificationToUser({
      recipientUserId: 'u2',
      recipientData: { email: 'u2@ejm.org', language: 'fr', notifPrefs: {} },
      type: 'task_offer_accepted',
      prefCategory: 'confirmed',
      content: contentFor,
    });
    expect(h.sendNotificationEmail.mock.calls[0][0]).toBe('u2@ejm.org');
    expect(h.added[0]).toMatchObject({ recipientUserId: 'u2' });
  });
});

describe('notifyDoFamilyParents', () => {
  beforeEach(() => {
    h.users = {
      p1: { email: 'p1@x.org', language: 'en', notifPrefs: {} },
      p2: { email: 'p2@x.org', language: 'fr', notifPrefs: {} },
    };
    h.families = { fam1: { parentIds: ['p1', 'p2'] } };
    h.added = [];
    h.sendNotificationEmail.mockClear().mockResolvedValue(true);
    h.sendPushNotification.mockClear().mockResolvedValue(true);
  });

  it('notifies every parent in the parent language — per-recipient localization', async () => {
    await notifyDoFamilyParents('fam1', {
      type: 'task_offer_received',
      prefCategory: 'newRequest',
      content: contentFor,
    });
    expect(h.added).toHaveLength(2);
    const subjects = h.sendNotificationEmail.mock.calls.map((c) => c[1]);
    expect(subjects).toContain('subject-en');
    expect(subjects).toContain('subject-fr');
  });

  it('missing family: no sends, no throw', async () => {
    await expect(
      notifyDoFamilyParents('ghost-family', {
        type: 'task_offer_received',
        prefCategory: 'newRequest',
        content: contentFor,
      }),
    ).resolves.toBeUndefined();
    expect(h.added).toHaveLength(0);
  });
});

describe('notifyDoSafely (post-commit invariant)', () => {
  it('swallows a rejecting notifier with console.error — nothing after commit may reject the callable', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      notifyDoSafely('test-label', async () => {
        throw new Error('transport down');
      }),
    ).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('test-label'),
      expect.any(Error),
    );
    errSpy.mockRestore();
  });
});
