import { describe, it, expect } from 'vitest';
import {
  latestRequestStatusByTutor,
  resolveRequestStatus,
  type RequestDocLike,
} from '../requestStatus.js';

/**
 * The shared request-status projection (extracted from searchTutors for
 * lookupTutor, issue #235). These pin the behaviors both callables rely on:
 * latest-wins ordering, the tutor-initiated 'incoming' remap, exclusion of
 * closed tutor-initiated requests, and the actionable-status whitelist.
 */

function docLike(data: Record<string, unknown>): RequestDocLike {
  return { data: () => data } as RequestDocLike;
}

function req(
  tutorUserId: string,
  status: string,
  createdAtMs: number,
  initiatedBy?: string,
): RequestDocLike {
  return docLike({
    tutorUserId,
    status,
    createdAt: { toMillis: () => createdAtMs },
    ...(initiatedBy ? { initiatedBy } : {}),
  });
}

describe('latestRequestStatusByTutor', () => {
  it('keeps the latest request per tutor (latest wins)', () => {
    const map = latestRequestStatusByTutor([
      req('t1', 'declined', 1000),
      req('t1', 'pending', 2000),
      req('t2', 'accepted', 500),
    ]);
    expect(map.get('t1')).toEqual({ status: 'pending', createdAtMs: 2000 });
    expect(map.get('t2')).toEqual({ status: 'accepted', createdAtMs: 500 });
  });

  it('remaps a tutor-initiated pending to incoming (issue #207 PR4)', () => {
    const map = latestRequestStatusByTutor([req('t1', 'pending', 1000, 'tutor')]);
    expect(map.get('t1')?.status).toBe('incoming');
  });

  it('excludes closed tutor-initiated requests (not this family\'s history)', () => {
    // A tutor-initiated request the family declined must not shadow the
    // family's own older request — it is skipped entirely.
    const map = latestRequestStatusByTutor([
      req('t1', 'declined', 2000, 'tutor'),
      req('t1', 'accepted', 1000),
    ]);
    expect(map.get('t1')?.status).toBe('accepted');
  });

  it('keeps a tutor-initiated ACCEPTED request (direction stops mattering)', () => {
    const map = latestRequestStatusByTutor([req('t1', 'accepted', 1000, 'tutor')]);
    expect(map.get('t1')?.status).toBe('accepted');
  });

  it('falls back through toDate and to 0 for exotic createdAt shapes', () => {
    const viaToDate = docLike({
      tutorUserId: 't1',
      status: 'pending',
      createdAt: { toDate: () => new Date(3000) },
    });
    const noTimestamp = docLike({ tutorUserId: 't1', status: 'declined' });
    // The toDate doc (3000ms) must beat the timestampless doc (0ms).
    const map = latestRequestStatusByTutor([noTimestamp, viaToDate]);
    expect(map.get('t1')).toEqual({ status: 'pending', createdAtMs: 3000 });
  });

  it('ignores docs with no tutorUserId', () => {
    const map = latestRequestStatusByTutor([docLike({ status: 'pending' })]);
    expect(map.size).toBe(0);
  });
});

describe('resolveRequestStatus', () => {
  it('passes through the actionable statuses', () => {
    for (const status of ['pending', 'accepted', 'declined', 'incoming']) {
      expect(resolveRequestStatus({ status })).toBe(status);
    }
  });

  it('maps cancelled to none (a withdrawn request is a fresh start)', () => {
    expect(resolveRequestStatus({ status: 'cancelled' })).toBe('none');
  });

  it('maps unknown stored values and absence to none', () => {
    expect(resolveRequestStatus({ status: 'garbage' })).toBe('none');
    expect(resolveRequestStatus(undefined)).toBe('none');
  });
});
