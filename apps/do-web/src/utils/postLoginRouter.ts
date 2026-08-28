/**
 * Post-sign-in landing. The shell has a single authenticated surface —
 * the placeholder home — so every signed-in account lands there. Role-aware
 * routing (doer portal vs family portal vs admin) arrives when those
 * surfaces do (plan §13 PR4/PR7/PR8), mirroring how study-web's
 * postLoginRouter branches on getStudyRole.
 */
export function postLoginRouter(): string {
  return '/home';
}
