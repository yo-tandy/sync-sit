import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CONSENT_VERSION } from '@ejm/shared-core';

/**
 * `acknowledgeConsent` (issue #488 decision 1), against a mocked `users` doc:
 * the stale-client refusal, the idempotent no-write on a current record, and
 * the write + audit on a stale one. The emulator suite
 * (`tests/integration/account/acknowledge-consent.test.ts`) covers the same
 * paths against real Firestore; this file exists so the refusal ordering
 * (validate -> compare -> read) is pinned without an emulator.
 */
const h = vi.hoisted(() => ({
  userDoc: undefined as Record<string, unknown> | undefined,
  updates: [] as Record<string, unknown>[],
  audits: [] as { userId: string; action: string; details?: Record<string, unknown> }[],
}));

vi.mock('../../config/firebase.js', () => ({
  db: {
    collection: (name: string) => {
      if (name !== 'users') throw new Error(`unexpected collection ${name}`);
      return {
        doc: (id: string) => ({
          id,
          get: async () => ({ exists: h.userDoc !== undefined, data: () => h.userDoc }),
          update: async (data: Record<string, unknown>) => {
            h.updates.push(data);
          },
        }),
      };
    },
  },
}));
vi.mock('../../config/cors.js', () => ({ getCorsOrigin: () => true }));
vi.mock('../../admin/writeAuditLog.js', () => ({
  writeUserActivity: async (userId: string, action: string, details?: Record<string, unknown>) => {
    h.audits.push({ userId, action, details });
  },
}));

import { acknowledgeConsent } from '../acknowledgeConsent.js';

function call(data: unknown, uid: string | null = 'u1') {
  return acknowledgeConsent.run({
    auth: uid ? { uid, token: {} } : undefined,
    data,
    rawRequest: {},
  } as never);
}

beforeEach(() => {
  h.userDoc = { uid: 'u1', consentVersion: '0.9' };
  h.updates.length = 0;
  h.audits.length = 0;
});

describe('acknowledgeConsent', () => {
  it('rejects unauthenticated callers before touching anything', async () => {
    await expect(call({ consentVersion: CONSENT_VERSION }, null)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    expect(h.updates).toEqual([]);
  });

  it('rejects a missing or malformed version (invalid-argument)', async () => {
    await expect(call({})).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(call({ consentVersion: 'latest' })).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(h.updates).toEqual([]);
  });

  it("refuses a client that presented a version other than the live one: consent/stale-client, nothing written", async () => {
    await expect(call({ consentVersion: '0.9' })).rejects.toMatchObject({
      code: 'failed-precondition',
      details: { code: 'consent/stale-client', current: CONSENT_VERSION },
    });
    expect(h.updates).toEqual([]);
    expect(h.audits).toEqual([]);
  });

  it('not-found when the caller has no users doc', async () => {
    h.userDoc = undefined;
    await expect(call({ consentVersion: CONSENT_VERSION })).rejects.toMatchObject({ code: 'not-found' });
  });

  it('stamps the live version + consentAt on a stale record and audits the previous value', async () => {
    const result = await call({ consentVersion: CONSENT_VERSION });
    expect(result).toEqual({ success: true, consentVersion: CONSENT_VERSION, alreadyCurrent: false });
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0]).toMatchObject({ consentVersion: CONSENT_VERSION });
    expect(h.updates[0].consentAt).toBeInstanceOf(Date);
    expect(h.updates[0].updatedAt).toBeInstanceOf(Date);
    expect(h.audits).toEqual([
      {
        userId: 'u1',
        action: 'acknowledge_consent',
        details: { previousConsentVersion: '0.9', consentVersion: CONSENT_VERSION },
      },
    ]);
  });

  it('audits a null previous version for an account that never had the field', async () => {
    // Such an account is current today (INITIAL_CONSENT_VERSION) so nothing
    // is written; pin the shape through an explicit non-current current by
    // making the stored value stale instead.
    h.userDoc = { uid: 'u1', consentVersion: '2024-01-01' };
    await call({ consentVersion: CONSENT_VERSION });
    expect(h.audits[0].details).toMatchObject({ previousConsentVersion: '2024-01-01' });
  });

  it('is idempotent on a record that is already current -- or on one of its alias labels', async () => {
    for (const stored of [CONSENT_VERSION, '2025-12-01', '2026-08-28', undefined]) {
      h.userDoc = stored === undefined ? { uid: 'u1' } : { uid: 'u1', consentVersion: stored };
      h.updates.length = 0;
      h.audits.length = 0;
      const result = await call({ consentVersion: CONSENT_VERSION });
      expect(result).toEqual({ success: true, consentVersion: CONSENT_VERSION, alreadyCurrent: true });
      expect(h.updates).toEqual([]);
      expect(h.audits).toEqual([]);
    }
  });
});
