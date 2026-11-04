import { defineSecret } from 'firebase-functions/params';

/**
 * The Resend API key, as a Firebase Functions SECRET PARAM (issue #497).
 *
 * WHY A PARAM AND NOT A PLAIN ENV VAR. The key used to be applied to Cloud Run
 * services out of band, by a hard-coded list of 11 service names in
 * `scripts/fix-cloud-run-permissions.sh`. Every email path added after that
 * list was written — the study and do notification senders, the digest and
 * reminder jobs, `reviewVerification` — ran without the key, so `getResend()`
 * returned null and the mail was SILENTLY DROPPED behind a `[NO-RESEND]` log
 * line. 109 of 120 services were missing it when this was found (2026-09-14).
 *
 * A list maintained by hand, in a shell script, one layer away from the code
 * that needs it, cannot track a call graph that keeps growing. Declaring it
 * here instead means every deploy binds it to exactly the functions that
 * declare it, with nothing to re-apply afterwards — which also sidesteps the
 * second half of #497: the `gcf-artifacts` cleanup policy deletes the tagged
 * build image after 24h, so a post-deploy `gcloud run services update` fails
 * with `Image …:version_1 not found` outside that window. There is no longer
 * anything to apply post-deploy.
 *
 * HOW IT REACHES THE MAILER. `getResend()` reads `process.env.RESEND_API_KEY`
 * and is unchanged: firebase-functions injects a declared secret into the
 * process environment at runtime, so the read site does not need to know this
 * param exists. Binding is purely a matter of listing it in a function's
 * `secrets` option.
 *
 * WHICH FUNCTIONS BIND IT. Every function whose call graph can reach the
 * mailer — not only the ones that obviously send mail themselves, since most
 * reach it through a notify helper (`notifyAllParents`, `do/notify`,
 * `endorsementNotifications`, `guardian/shared`). That set is enforced by
 * `__tests__/resendSecretBinding.test.ts`, which recomputes reachability from
 * the import graph and fails if a function that can reach the mailer does not
 * declare this param. Adding a new email path therefore breaks CI rather than
 * silently dropping mail in production — the failure mode that made #497 take
 * five months to notice.
 */
// `SecretParam` is not re-exported from `firebase-functions/params` (only used
// as defineSecret's return type), and `lib/params/types` has no subpath export
// — so the inferred type is unnameable across a package boundary (TS2883).
// ReturnType keeps the annotation portable without reaching into lib/.
export const RESEND_API_KEY: ReturnType<typeof defineSecret> = defineSecret('RESEND_API_KEY');
