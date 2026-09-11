import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Merge-order interlock for PR #493 (self-serve "Delete my account" UI)
 * against PR #490 (#421: the last-admin erasure guard).
 *
 * #493 makes `deleteMyAccount` reachable from the account hub for every
 * signed-in member — including the platform's sole admin. The server-side
 * refusal for that case (`guardAgainstLastAdmin`, throwing
 * `failed-precondition` with `details.code === 'admin/last-admin'`) lives in
 * `packages/shared-functions/src/admin/deleteUser.ts` and lands with #490.
 * Until it is on the branch this test runs against, this pin FAILS, which
 * keeps #493's CI red — a mechanism, not a prose warning. Once #490 has
 * merged it turns green and stays as a contract pin: the client mapping in
 * `accountDeleteErrorCode` must never outlive the server guard.
 */
describe('self-serve deletion ships only with the last-admin guard (#490 → #493 interlock)', () => {
  const src = readFileSync(
    resolve(__dirname, '../../packages/shared-functions/src/admin/deleteUser.ts'),
    'utf8',
  );

  it('eraseUserAccount carries guardAgainstLastAdmin', () => {
    expect(src.length, 'deleteUser.ts read as empty').toBeGreaterThan(0);
    expect(src).toContain('guardAgainstLastAdmin');
  });

  it("the guard throws the 'admin/last-admin' code the client maps", () => {
    expect(src).toContain("'admin/last-admin'");
  });
});
