import { describe, it, expect, beforeEach, vi } from 'vitest';

// Unit pins for the post-commit invariant of respondToTutorEndorsement:
// nothing after the transaction may reject the callable. The emulator cannot
// fault-inject a notifyAllParents/writeUserActivity failure, so the swallow
// is pinned here directly with the collaborators mocked.
const h = vi.hoisted(() => ({
  notifyAllParents: vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve()),
  writeUserActivity: vi.fn<(...args: unknown[]) => Promise<void>>(() => Promise.resolve()),
  userGet: vi.fn(() => Promise.resolve({ data: () => ({ firstName: "O'Brien & <Co>" }) })),
}));

vi.mock('@ejm/shared-functions/config/firebase.js', () => ({
  db: { collection: () => ({ doc: () => ({ get: h.userGet }) }) },
}));
vi.mock('@ejm/shared-functions/config/notifyParents.js', () => ({
  notifyAllParents: (...args: unknown[]) => h.notifyAllParents(...args),
}));
vi.mock('@ejm/shared-functions/admin/writeAuditLog.js', () => ({
  writeUserActivity: (...args: unknown[]) => h.writeUserActivity(...args),
}));

import {
  notifyEndorsementOutcome,
  recordEndorsementResponseActivity,
} from '../endorsementNotifications.js';

describe('notifyEndorsementOutcome', () => {
  beforeEach(() => {
    h.notifyAllParents.mockClear().mockImplementation(() => Promise.resolve());
    h.userGet.mockClear().mockImplementation(() =>
      Promise.resolve({ data: () => ({ firstName: "O'Brien & <Co>" }) }),
    );
    vi.restoreAllMocks();
  });

  it('accept notifies the family with study branding and the references pref category', async () => {
    await notifyEndorsementOutcome('tutor-1', 'accept', 'ref-1', 'fam-1');
    expect(h.notifyAllParents).toHaveBeenCalledTimes(1);
    const arg = h.notifyAllParents.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.familyId).toBe('fam-1');
    expect(arg.prefCategory).toBe('references');
    expect(arg.app).toBe('study');
    expect(arg.type).toBe('tutor_endorsement_published');
    expect((arg.data as Record<string, string>).referenceId).toBe('ref-1');
  });

  it('the email SUBJECT carries the raw name (RFC 5322 header, never HTML-decoded); the HTML body is escaped', async () => {
    await notifyEndorsementOutcome('tutor-1', 'accept', 'ref-1', 'fam-1');
    const arg = h.notifyAllParents.mock.calls[0][0] as Record<string, string>;
    // Subject: raw apostrophe/ampersand render raw in the inbox.
    expect(arg.emailSubject).toBe("Your endorsement for O'Brien & <Co> is published");
    expect(arg.emailSubject).not.toContain('&#39;');
    // HTML body: the tutor-controlled string is neutralized.
    expect(arg.emailBody).toContain('O&#39;Brien &amp; &lt;Co&gt;');
    expect(arg.emailBody).not.toContain('<Co>');
    // Push/in-app body is a plain-text context: raw.
    expect(arg.body).toContain("O'Brien & <Co>");
  });

  it('dismiss keeps the static neutral subject and escapes the HTML body', async () => {
    await notifyEndorsementOutcome('tutor-1', 'dismiss', 'ref-1', 'fam-1');
    const arg = h.notifyAllParents.mock.calls[0][0] as Record<string, string>;
    expect(arg.type).toBe('tutor_endorsement_declined');
    expect(arg.emailSubject).toBe('About your endorsement');
    expect(arg.emailBody).toContain('O&#39;Brien &amp; &lt;Co&gt;');
    expect(arg.body).toContain('was not published');
  });

  it('swallows a rejecting notifyAllParents with console.error (post-commit invariant)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.notifyAllParents.mockRejectedValueOnce(new Error('firestore unavailable'));
    await expect(
      notifyEndorsementOutcome('tutor-1', 'accept', 'ref-1', 'fam-1'),
    ).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('family notify failed after commit'),
      expect.any(Error),
    );
  });

  it('swallows a rejecting tutor-doc read with console.error', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.userGet.mockRejectedValueOnce(new Error('read failed'));
    await expect(
      notifyEndorsementOutcome('tutor-1', 'dismiss', 'ref-1', 'fam-1'),
    ).resolves.toBeUndefined();
    expect(h.notifyAllParents).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
  });
});

describe('recordEndorsementResponseActivity', () => {
  beforeEach(() => {
    h.writeUserActivity.mockClear().mockImplementation(() => Promise.resolve());
    vi.restoreAllMocks();
  });

  it('writes the accept/dismiss activity with the reference context', async () => {
    await recordEndorsementResponseActivity('tutor-1', 'accept', 'ref-1', 'fam-1');
    expect(h.writeUserActivity).toHaveBeenCalledWith('tutor-1', 'tutor_endorsement_accepted', {
      referenceId: 'ref-1',
      submittedByFamilyId: 'fam-1',
    });
    await recordEndorsementResponseActivity('tutor-1', 'dismiss', 'ref-1', null);
    expect(h.writeUserActivity).toHaveBeenLastCalledWith('tutor-1', 'tutor_endorsement_dismissed', {
      referenceId: 'ref-1',
      submittedByFamilyId: null,
    });
  });

  it('swallows a rejecting audit write with console.error (post-commit invariant)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.writeUserActivity.mockRejectedValueOnce(new Error('auditLogs unavailable'));
    await expect(
      recordEndorsementResponseActivity('tutor-1', 'accept', 'ref-1', 'fam-1'),
    ).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('audit write failed after commit'),
      expect.any(Error),
    );
  });
});
