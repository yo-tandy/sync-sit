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
- `firestore.rules`: `adminConfig/values` denies ALL client access
  (round 7 -- the panel reads via getAdminConfig, servers bypass rules);
  the client-exposed keys are mirrored to the world-readable
  `adminConfig/client` (round 6), maintained by updateAdminConfig; all
  writes denied everywhere (callable-only).
- Client: `createAdminConfigReader` (shared-ui; ONE factory, six-case
  fallback matrix tested once) instantiated per app; the dashboard hooks
  subscribe immediately and RE-BUCKET the remembered snapshot when the
  configured pastVisibilityDays arrives.
- `availabilityMaxRangeDays`: the zod schema keeps an ABSOLUTE ceiling
  (90); the configured value is enforced dynamically in
  getTutorAvailability (schemas are built at module load and must not
  capture a mutable config read).

**Keys (14):** boardContactsPerDay(5,1..50), boardContactWindowHours
(24,1..168), declineCooldownDays(7,0..90), publishedSearchTtlDays(7,1..60),
publishedSearchMaxActive(3,1..20), bookingNoticeHours(24,0..168),
recurringHorizonWeeks(8,1..52), kidInviteValidityDays(7,1..90),
verificationCodeCooldownS(60,60..600), dailySendCap(10,1..100),
bypassSendCap(6,1..100), verifyCodeMaxAttempts(5,3..10),
pastVisibilityDays(7,1..90), availabilityMaxRangeDays(28,28..90).

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

**Round 4 (PR #266):** the resend-cooldown clients follow the knob --
StepVerify takes resendCooldownS (all three enrollment consumers and
JoinFamilyPage read it via useClientConfigValue), closing the silent
dead-end where the server's anti-enumeration decoy success masked a
longer configured window behind a 60s button; VERIFICATION_CODE_COOLDOWN_S
linked to the table; notice-window error copy interpolates the configured
hours (book/propose/modify); admin_config_updated added to the audit-log
filter options; a DECLARED-but-blank ADMIN_CONFIG_TTL_MS reads as unset
(Number('') is 0 -- would have silently disabled prod caching); the
redaction-deferral invariant and the preview's configured-horizon read
are pinned; README's admin list gains Configuration; the plan's
Architecture section now describes the round-3 designs.

**Round 5 (PR #266):** StepParentVerify (the one resend UI still hardcoded
at 60s) takes the configured resendCooldownS; both it and StepVerify gain
a sync effect extending a running countdown when the configured value
resolves after mount (never shortening); the round-4 behaviour is pinned
(timer pins in the shared-ui suite, page-wiring pins in both sit wizard
suites via an h.configValues reader stub); the dead demand-board error
copy is fixed on the client -- the server sends cooldownDays/windowHours
in details and en+fr strings interpolate them; pastVisibilityDays'
description discloses the note-redaction retention coupling; stranded
notice-window/ceiling docstrings re-homed onto their getConfigValue call
sites; merged-statement artifacts split; VERIFICATION_CODE_COOLDOWN_S
deleted (zero consumers); RECURRING_NOTICE_HOURS linked to the table;
the min:0 asymmetry (policy levers vs shipped-client floors) stated in
the defs table; the Keys list floors above corrected to 60..600 / 28..90.

**Round 6 (PR #266):** the auth gate on adminConfig/values silently
defeated rounds 4-5 for fresh signups -- enrollment wizards read the
resend cooldown BEFORE the account exists, the denied read fell back to
the 60s default, and every suite stubbed the reader so nothing caught it.
Fix: a world-readable `adminConfig/client` mirror holding ONLY the
clientExposed keys (verificationCodeCooldownS, pastVisibilityDays,
recurringHorizonWeeks, bookingNoticeHours -- the abuse levers never leave
the authed values doc), maintained by updateAdminConfig as a full
snapshot on every save, with the client reader factories re-bound to it;
rules pins cover unauthenticated read of the mirror and continued denial
on values. Also: the countdown sync effects made StrictMode-safe (ref
mutation hoisted out of the state updater, which React double-invokes);
StrictMode renders added to those pins; reason-mapped board copy
pluralized via i18next _one/_other with count (en+fr, both apps) and the
server template strings' unit words made count-aware; stale fixed-window
docstrings in cleanupOldData/extendRecurring updated; ADMIN_CONFIG_TTL_MS
documented for operators in the README.

**Round 7 (PR #266, comment verdict):** stale fixed-value copy reworded
number-free (tutor decline-confirm "7 days", both apps' published-search
"one week" duration lines, ParentGuidePage's "3 searches / one week" --
all now admin-configurable ranges, per the review's rewording option);
adminConfig/values locked to `allow read, write: if false` (no client
reads it any more -- the signed-in grant only served abuse-lever
enumeration; rules pin inverted); updateAdminConfig made atomic (one
WriteBatch for values + mirror + audit, post-merge state computed
locally -- a mirror failure can no longer leave a mutated values doc
with no audit row); resolveConfigValue got its direct pure-unit matrix
(tests/unit, incl. NaN/Infinity and an all-keys sweep) with
@ejm/shared-functions added to the tests package; the sit reader suite
pins the adminConfig/client BINDING (the round-6 regression shape);
JoinFamilyPage got the same mount-race sync guard as the step
components (its countdown arms at click time); useClientConfigValue
consolidated onto the factory (the per-app files had byte-identical
twins); INVITE_LINK_EXPIRY_MS deleted (zero consumers, the
VERIFICATION_CODE_COOLDOWN_S standard); four stale
PUBLISHED_SEARCH_MAX_ACTIVE comment mentions updated.

**Round 8 (PR #266, comment verdict):** the four doc spots the round-7
rules change left stale now state the shipped posture (README security
boundary + runbook line "the panel is the ONLY supported edit path" --
a console write to values is bounds-safe server-side but does not
update the client mirror; config module docstring; defs clientExposed
docstring; plan Architecture section); updateAdminConfig upgraded from
batch to TRANSACTION -- `before` is read inside the atomic scope, so
two concurrent admin saves can no longer derive the mirror from stale
state and drop each other's client-exposed keys (the round-6 divergence
class); ttlMs exported and given its pure matrix in tests/unit
(unset / blank / whitespace / '0' / integer / garbage / negative);
StepVerify's stale "60s cooldown" comment updated.
