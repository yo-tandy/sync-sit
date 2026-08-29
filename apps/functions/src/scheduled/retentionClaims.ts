/**
 * The retention sweeps' schedule-claim releaser.
 *
 * The implementation MOVED to `@ejm/shared-functions/schedule/claimRelease.js`
 * (issue #408): `deleteUser` lives in `packages/shared-functions` and needs the
 * same releaser, and `packages/*` cannot import from `apps/*`. Keeping ONE
 * implementation is the whole point — a second copy of the lossless-inverse
 * wrapper is exactly how the two apps' claim paths drift apart.
 *
 * This module stays as the sweeps' import site; the `WHY THIS EXISTS` reasoning
 * PR #396 wrote now lives on `claimRelease.ts`'s docblock, extended with the two
 * new callers (`deleteUser`, `admin/deleteAppointment`).
 */
export {
  createClaimReleaser,
  SIT_PROVENANCE,
  STUDY_PROVENANCE,
  DATE_RE,
} from '@ejm/shared-functions/schedule/claimRelease.js';
