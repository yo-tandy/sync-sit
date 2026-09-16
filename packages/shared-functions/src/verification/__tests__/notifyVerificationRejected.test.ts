import { describe, it, expect, vi, beforeEach } from 'vitest';

const docs: Record<string, Record<string, unknown> | undefined> = {};
vi.mock('../../config/firebase.js', () => ({
  db: {
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: async () => {
          const data = docs[`${name}/${id}`];
          return { exists: !!data, data: () => data };
        },
      }),
    }),
  },
}));
const sendMock = vi.fn();
vi.mock('../../config/email.js', () => ({
  sendVerificationRejectedEmail: (...args: unknown[]) => sendMock(...args),
}));

import { notifyVerificationRejected } from '../notifyVerificationRejected.js';

describe('notifyVerificationRejected', () => {
  beforeEach(() => {
    for (const k of Object.keys(docs)) delete docs[k];
    sendMock.mockReset().mockResolvedValue(true);
    docs['families/fam1'] = { parentIds: ['p1', 'p2'] };
    docs['users/p1'] = { email: 'p1@example.org', language: 'fr' };
    docs['users/p2'] = { email: 'p2@example.org', language: 'en' };
  });

  it('emails the uploader first, then the other parents, each in their own language, without duplicates', async () => {
    const result = await notifyVerificationRejected({
      familyId: 'fam1',
      uploadedByUserId: 'p2',
      type: 'identity',
      reason: 'Blurry',
    });
    expect(result.recipients).toEqual(['p2', 'p1']);
    expect(result.sent).toBe(2);
    expect(sendMock.mock.calls.map((c) => c[0])).toEqual(['p2@example.org', 'p1@example.org']);
    expect(sendMock.mock.calls[0][1]).toMatchObject({ type: 'identity', reason: 'Blurry', language: 'en' });
    expect(sendMock.mock.calls[1][1]).toMatchObject({ language: 'fr' });
  });

  it('skips a parent with no email and keeps going', async () => {
    docs['users/p1'] = { language: 'fr' };
    const result = await notifyVerificationRejected({ familyId: 'fam1', uploadedByUserId: null, type: 'ejm_enrollment', reason: 'x' });
    expect(result.recipients).toEqual(['p1', 'p2']);
    expect(result.sent).toBe(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('a failure for one recipient never throws or blocks the others', async () => {
    sendMock.mockRejectedValueOnce(new Error('provider down'));
    const result = await notifyVerificationRejected({ familyId: 'fam1', uploadedByUserId: 'p1', type: 'identity', reason: 'x' });
    expect(result.sent).toBe(1);
  });
});
