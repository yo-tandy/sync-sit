# Per-App Sender Identity for Transactional Email (issue #156)

**Goal:** No Sync/Study user receives security-relevant mail from a brand
they don't recognize. Option taken: the CHEAP one from the issue -- a
`Sync/Study` display name on the same verified Resend domain (Resend
validates the domain, not the RFC 5322 display name). A dedicated study
domain remains available later by editing one map.

**What changed (all in shared-functions/config/email.ts + the two verify
callables):**
- `NOTIFICATION_BRANDING` (already per-app for notification mail) gains
  per-app `tagline`s and is now the ONE sender table for every email
  class; exported for pins.
- `sendAccountExistsEmail` -- the security-relevant notice from issue
  #148 -- sends from the app-true sender instead of always Sync/Sit.
- `sendVerificationEmail` takes the same normalized app hint the
  account-exists path already uses (threaded from verifyEjmEmail /
  verifyParentEmail); the duplicated primary/fallback HTML collapsed into
  an exported `buildVerificationEmail` builder, branded per app (name,
  color, tagline, subject).
- `sendAdminNotification` stays Sync/Sit (internal mail to the admin);
  the now-unused FROM_EMAIL_FALLBACK deleted.

**Not taken:** a per-app FROM domain -- requires verifying a study domain
with Resend (owner/ops); the map has the seam ready.

**Tests:** builder pins (sit branded end-to-end; study carries NO
Sync/Sit branding and vice versa; default = sit matching the callables'
normalize default) + sender-row pins (same verified domain, app-true
display names). Existing account-exists and notification-branding suites
untouched and green.
