import { describe, it, expect, beforeEach, vi } from 'vitest';

// Convention pin for the email-HTML escaping sweep (issue #188): every
// user-controlled string interpolated into a notification email's HTML body
// goes through escapeHtml; RFC 5322 subject lines stay RAW (a subject is
// never HTML-decoded, so escaping there would render literal entities).
// sendKidInviteEmail is the representative shared-functions sender: firstName
// and familyName come from parent-typed invite input. Firestore and the
// transport are mocked; escapeHtml stays the real implementation.

const h = vi.hoisted(() => ({
  sendCalls: [] as { to: string; subject: string; html: string }[],
}));

vi.mock('../../config/firebase.js', () => ({
  db: { collection: () => ({ doc: () => ({ get: async () => ({ data: () => undefined }) }) }) },
}));

vi.mock('../../config/email.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../config/email.js')>();
  return {
    ...actual,
    sendNotificationEmail: async (to: string, subject: string, html: string) => {
      h.sendCalls.push({ to, subject, html });
      return true;
    },
  };
});

import { sendKidInviteEmail } from '../shared.js';

describe('sendKidInviteEmail escaping (issue #188 convention)', () => {
  beforeEach(() => {
    h.sendCalls.length = 0;
  });

  it('escapes the parent-controlled firstName and familyName in the HTML body', async () => {
    await sendKidInviteEmail('kid@example.com', '<b>Ev&il</b>', 'O\'Brien & <Fam>', 'tok-abc');
    expect(h.sendCalls).toHaveLength(1);
    const { html } = h.sendCalls[0];
    expect(html).toContain('&lt;b&gt;Ev&amp;il&lt;/b&gt;');
    expect(html).toContain('O&#39;Brien &amp; &lt;Fam&gt;');
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('<Fam>');
  });

  it('keeps a plain name readable and the system-built invite link raw', async () => {
    await sendKidInviteEmail('kid@example.com', 'Yael', 'Cohen', 'tok-abc');
    const { subject, html } = h.sendCalls[0];
    // Subject is a literal here — the convention's raw-subject side is pinned
    // at the study sender layer (endorsementNotifications.test.ts).
    expect(subject).toBe('Your parents invited you to Sync/Sit');
    expect(html).toContain('Hi Yael,');
    expect(html).toContain('the Cohen family');
    // The link is built from a constant + a server-generated token: never escaped.
    expect(html).toContain('https://sync-sit.web.app/kid-invite?token=tok-abc');
  });
});
