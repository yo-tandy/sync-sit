import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Contract pin between the self-serve "Delete my account" UI (#493) and the
 * last-admin erasure guard (#421, shipped in #490).
 *
 * #493 makes `deleteMyAccount` reachable from the account hub for every
 * signed-in member — including the platform's sole admin. The server-side
 * refusal for that case (`guardAgainstLastAdmin`, throwing
 * `failed-precondition` with `details.code === 'admin/last-admin'`) lives in
 * `packages/shared-functions/src/admin/deleteUser.ts`. This started life as
 * a merge-order interlock — red on #493's branch until #490 landed on
 * `main`, a mechanism rather than a prose warning — and stays on as the
 * pin that the client mapping in `accountDeleteErrorCode` never outlives
 * the server guard it maps.
 */
describe('self-serve deletion ships only with the last-admin guard (#490 ↔ #493 contract)', () => {
  const read = (rel: string) =>
    readFileSync(resolve(__dirname, '../../packages/shared-functions/src/admin/', rel), 'utf8');
  const src = read('deleteUser.ts');
  // #500 moved the count and the throw into a module both erasure and
  // blockUser share; the guard in deleteUser.ts now delegates to it.
  const guardModule = read('lastAdmin.ts');

  it('eraseUserAccount carries guardAgainstLastAdmin', () => {
    expect(src.length, 'deleteUser.ts read as empty').toBeGreaterThan(0);
    expect(src).toContain('guardAgainstLastAdmin');
    expect(src).toContain("from './lastAdmin.js'");
  });

  it("the guard throws the 'admin/last-admin' code the client maps", () => {
    expect(guardModule).toContain("'admin/last-admin'");
  });
});
