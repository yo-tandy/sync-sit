# Admin-Panel Configuration (issue #250, owner-approved proposal)

> **For agentic workers:** implemented on this branch; plan recorded for review context.

**Goal:** Operational parameters move from code constants to an
admin-editable Firestore doc, read by the server through a cached getter
with code defaults as fallback -- the panel can never brick a callable.

**Owner decision (issue thread):** the proposal's main table is approved.
The flagged rows stay in code: RETENTION_DAYS (GDPR commitment),
MIN_BABYSITTER_AGE (legal), support/from emails (env concern).
INVITE_LINK_EXPIRY_MINUTES was dropped during implementation: the constant
has zero consumers (dead code) -- moving it would create a knob wired to
nothing.

**Architecture:**
- `adminConfig/values` -- one flat Firestore doc, fields = config keys.
- `packages/shared-functions/src/config/adminConfig.ts`:
  `ADMIN_CONFIG_DEFS` (key -> {default, min, max, description}) and
  `getConfigValue(key)` -- in-memory cache (TTL `ADMIN_CONFIG_TTL_MS` env,
  default 60s; tests set 0), fail-open: read errors, absent doc, absent
  key, non-integer or OUT-OF-BOUNDS stored values all resolve to the code
  default (a console-edited rogue value cannot escape the bounds).
- `updateAdminConfig` callable (verifyAdmin + writeAuditLog): partial
  updates, every provided key validated (known, integer, within bounds);
  merge-writes the doc. `getAdminConfig` (verifyAdmin) returns defs +
  stored values for the panel.
- `firestore.rules`: `adminConfig/{doc}` readable by any SIGNED-IN user
  (pastVisibilityDays is consumed client-side; the values are caps and
  windows, not secrets), writes denied (callable-only).
- Client: `getClientConfigValue` (apps/web/src/lib/adminConfigClient.ts;
  one shared read, identical fallback semantics incl. sync-throw, unit
  tested) resolved BEFORE the dashboard hooks subscribe, so the first
  bucketing already uses the configured pastVisibilityDays.
- `availabilityMaxRangeDays`: the zod schema keeps an ABSOLUTE ceiling
  (90); the configured value is enforced dynamically in
  getTutorAvailability (schemas are built at module load and must not
  capture a mutable config read).

**Keys (14):** boardContactsPerDay(5,1..50), boardContactWindowHours
(24,1..168), declineCooldownDays(7,0..90), publishedSearchTtlDays(7,1..60),
publishedSearchMaxActive(3,1..20), bookingNoticeHours(24,0..168),
recurringHorizonWeeks(8,1..52), kidInviteValidityDays(7,1..90),
verificationCodeCooldownS(60,30..600), dailySendCap(10,1..100),
bypassSendCap(6,1..100), verifyCodeMaxAttempts(5,3..10),
pastVisibilityDays(7,1..90), availabilityMaxRangeDays(28,7..90).

**Wired sites:** sit contactPublishedSearch (cooldown + board cap/window),
study sendFamilyContactRequest (board cap/window), study declineCooldown,
sit publishSearch + study publishTutorSearch (TTL + max active), study
NOTICE_HOURS sites (getTutorAvailability, singleDateAvailability,
bookSession, modifySession, proposeSession, respondToSession,
recurringWindow), RECURRING_HORIZON_WEEKS sites (bookSession,
respondToSession, extendRecurring), shared guardian kid invites (create +
manage), shared auth sendCooldown / sendRateLimit / verifyCode, sit web
dashboards (pastVisibilityDays via hook).

**Tests:** unit-style integration for the getter fallback matrix; callable
pins (admin gate, unknown key, non-integer, out-of-bounds, partial merge,
audit entry); one END-TO-END effect pin per app (board cap lowered to 1 ->
second contact rejected) under ADMIN_CONFIG_TTL_MS=0; panel component
tests (render defs, save payload, bounds hint).

**Admin panel:** ConfigurationPage in apps/web admin section -- one row
per key (description, default, bounds, current input), save via
updateAdminConfig, i18n en/fr.

**Round 1 (PR #266):** definition table moved to shared-core (one table
for server getter, validator, panel, and client -- no drift); config
resolved before the dashboard hooks subscribe (a post-hoc `let` was never
applied on a quiet dashboard); null-revert path (empty panel field
deletes the field; audit records to: null); unknown stored keys neither
render nor wedge the panel; extendRecurring wired (it was enforcing the
hardcoded 24h) and the loop-condition awaits hoisted; unreachable
.catch fallbacks removed (getConfigValue cannot reject); dead
SEND_COOLDOWN_MS deleted; verificationCodeCooldownS floor raised to 60
(today's fixed value -- the panel cannot weaken the resend posture);
rules narrowed to /adminConfig/values and re-homed below the
notifications block; client reader unit-tested.

**Round 2 (PR #266):** the mirrors follow the knobs -- the tutor
RecurringConflictPreview reads recurringHorizonWeeks + bookingNoticeHours
through a study-web twin of the client reader (the preview must predict
exactly what respondToSession materializes), and the cleanup cron's note
redaction reads pastVisibilityDays (raising the dashboard window defers
redaction, keeping the remove affordance reachable for the note's whole
visible life). Dashboard hooks subscribe immediately and RE-BUCKET the
remembered snapshot when the config arrives (no serial round trip before
first paint; still covers the quiet dashboard). Cooldown error copy
interpolates the configured days; ~14 orphaned constants and unused
imports swept; the rules block re-homed below inviteLinks (brace-counted
this time).

**Round 3 (PR #266):** availabilityMaxRangeDays' floor raised to 28 --
BookSessionPage ships fixed 14-day pages and a 28-day weekly window, so
the sanctioned range itself must not include client-breaking values (the
verificationCodeCooldownS precedent); unknown-key rejection is
prototype-safe (Object.hasOwn -- 'constructor' resolved truthy through a
plain index) at the callable AND the panel; the client reader is ONE
factory in shared-ui instantiated per app (six-case matrix tested once);
the cron reads through its injected db via the pure resolveConfigValue;
TTL comparison is >= so ADMIN_CONFIG_TTL_MS=0 truly always refetches;
board-cap copy interpolates the configured window; the panel help text no
longer hardcodes 60s; surviving legacy constants (send caps,
PAST_VISIBILITY_DAYS, KID_INVITE_VALIDITY_DAYS) are LINKED to the table
(= ADMIN_CONFIG_DEFS.*.default) and their exact-value pins repointed;
dead DECLINE_COOLDOWN_MS / PUBLISHED_SEARCH_* removed.
