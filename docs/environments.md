# Environments and their configuration

Everything that differs between production and any other environment, in one
place. Written for whoever stands up the next environment, because `.env*` is
gitignored and a runbook that points at an untracked file is no runbook.

Today there is exactly **one** environment: production, the Firebase project
`sync-sit`. A staging environment is being added; this document is what it will
be configured from.

## The two halves

Configuration is split by *when* it is read, and the halves behave differently.

| | Server (functions) | Client (web apps) |
|---|---|---|
| Read at | **Deploy time**, from the process environment | **Build time**, inlined by Vite |
| Source | `.env` / `.env.<projectId>` in `apps/functions/` | `env:` block in the deploy workflow |
| Changing it needs | a functions deploy | a rebuild **and** a hosting deploy |
| Missing value | falls back to the production host | falls back to the production host |

The fallback direction matters: **absent configuration means production.** That
is right for the production deploy, which sets nothing, and it is the trap for
every other environment — forget a variable and that environment quietly links
people into real data rather than failing loudly.

## Server: app hosts

Set in `apps/functions/.env.<projectId>`. Firebase loads `.env` and then
`.env.<projectId>` from the functions directory at deploy time.

| Variable | Production value (the fallback) | Used for |
|---|---|---|
| `SIT_APP_URL` | `https://sync-sit.com` | every sit email CTA, push link, kid-invite link |
| `STUDY_APP_URL` | `https://sync-study-app.web.app` | study email CTAs |
| `DO_APP_URL` | `https://sync-do-app.web.app` | do email CTAs |

Defined in `packages/shared-functions/src/config/email.ts`. See
`apps/functions/.env.example`.

**Not configurable, and deliberately so:** `FROM_EMAIL`, `SUPPORT_EMAIL`,
`ADMIN_EMAIL`. Those are addresses rather than links; pointing them at another
domain needs that domain verified at Resend with SPF and DKIM, or the mail
lands in spam. A non-production environment therefore sends *from* the
production sender — acceptable, because the sender is cosmetic, whereas a link
that lands a tester on real data is not.

## Client: build-time variables

Vite inlines these at build time, so changing one means rebuilding, not just
redeploying.

**Set today** in the `env:` block of each build step in
`.github/workflows/release.yml`:

| Variable | Notes |
|---|---|
| `VITE_FIREBASE_API_KEY` | Public client config, not a secret |
| `VITE_FIREBASE_AUTH_DOMAIN` | |
| `VITE_FIREBASE_PROJECT_ID` | |
| `VITE_FIREBASE_STORAGE_BUCKET` | |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | |
| `VITE_FIREBASE_APP_ID` | Currently the sit app id for all three apps |
| `VITE_FIREBASE_VAPID_KEY` | Web push; project-wide |

**Read by the apps but set by nothing** — production runs on the hardcoded
fallbacks in `appSwitch.ts`, so these two exist as an override mechanism that
has never been exercised:

| Variable | Read by | Fallback |
|---|---|---|
| `VITE_SIT_APP_URL` | study-web, do-web | `https://sync-sit.com` |
| `VITE_STUDY_APP_URL` | web, do-web | `https://sync-study-app.web.app` |

**A new environment must add both to its workflow's `env:` blocks.** This is
the client-side face of the same trap: leave them unset and staging's app
switcher sends people to production. Being untested in production is a reason
to check them deliberately on the first staging deploy, not a reason to assume
they work.

There is no `VITE_DO_APP_URL`: sit and study do not link to sync-do yet — that
is issue #304, still owner-gated.

## Standing up a new environment

1. Create the Firebase project and link billing (owner: it is a billing
   decision).
2. Enable Firestore, Auth, Storage and Cloud Functions.
3. Create the three hosting sites and add them to `.firebaserc` targets.
4. Create a Workload Identity pool + service account for CI, with the same
   roles the production deploy SA holds — including
   `roles/firebasestorage.admin` and GCS `storage.buckets.get`, both of which
   were learned the hard way (#282, #286).
5. Write `apps/functions/.env.<projectId>` from `.env.example`, pointing the
   three hosts at *that* environment's own hosting URLs.
6. Add a deploy workflow whose build steps set the `VITE_*` block for that
   project — **including `VITE_SIT_APP_URL` and `VITE_STUDY_APP_URL`, which
   production does not set.** Copying production's block verbatim is exactly
   the mistake: it is correct for production precisely because the fallbacks
   are production.
7. Seed data. Never copy production data into a non-production environment:
   it is real families' personal data and copying it makes every environment a
   breach surface.

Step 5 is the one that is easy to skip and expensive to skip, because nothing
fails when you do — see the fallback direction above.

## Related

- [releasing.md](releasing.md) — how production is deployed (tag-triggered).
- Plan §18.9 — the domain consolidation this configuration was centralised for.
