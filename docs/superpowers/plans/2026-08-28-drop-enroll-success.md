# Drop /enroll/tutor/success (issue #242, parity Q5=b)

**Goal:** Remove study's post-enrollment success interstitial; enrollment
completion routes straight to the tutor dashboard, matching sit's babysitter
enrollment.

**What moved where:**
- `TutorEnrollment` and `CrossAppWelcomePage` navigate to `/tutor` on
  completion (no more location-state firstName -- the dashboard greeting
  reads the profile).
- The success page's only unique content was the next-steps subtitle ("add
  subjects and availability, then turn on search visibility"); the tutor
  dashboard's activation banner already carries exactly that guidance for
  any enrollmentComplete && !searchable && !canActivate tutor, so nothing
  needed migrating.
- `/enroll/tutor/success` survives as a `<Navigate to="/tutor" replace />`
  redirect so stale links/bookmarks don't 404.
- `TutorSuccessPage` deleted (component + lazyPages entry + the three
  now-unused i18n keys in both locales).

**Tests:** the enrollment + cross-app pins now assert `/tutor`; new router
pins assert the redirect exists and the page is gone.

**Round 1 (PR #257):** the interstitial was PUBLIC; `/tutor` is behind
`AuthGuard role="tutor"`, and the new-account sign-in is best-effort by
design -- so a sign-in failure (or a user-doc read blip) would have bounced
a successfully-enrolled tutor to /login or /signup with no confirmation.
The navigate is now gated on the settled session actually carrying the
tutor profile (the guard's own predicate); anything less renders an
in-wizard "account ready -- log in" state (sit's idiom: never point a
signed-out user at a guarded route). The post-signin wait resolves on the
same predicate. Both stranding paths pinned; the vacuous router pin was
replaced with an export-absence assertion; the gateNoSlots banner (the
state a fresh enrollee actually lands in) got its own pin.

**Rounds 2-3 (PR #257):** while the account-ready fallback shows, a live
store subscription auto-advances to /tutor the moment the guard predicate
passes -- checking the CURRENT state before subscribing, since zustand
only fires on subsequent changes; one recovery `refreshUserDoc` (short
backoff -- an immediate identical read returns the same miss) runs before
latching, and the copy says "could not confirm" because the wizard cannot
distinguish failure from a slow first server snapshot. The two
authenticated refresh->navigate paths (add-profile, CrossAppWelcomePage)
retry once with backoff; CrossAppWelcomePage refuses to navigate blind
when both reads miss and surfaces `enrollment.crossApp.profileLoadError`
instead (a resubmit hits profile-exists once the doc is readable). New
i18n: `enrollment.tutor.readyLogin{Title,Desc,Cta}` +
`enrollment.crossApp.profileLoadError` (en/fr).

**Round 4:** the add-profile branch gets the same both-miss protection as
the other two paths (it was the one blind navigate the hardening missed --
and a regression THIS PR introduced, since the old destination was
public): both refreshes swallowed, and a double miss latches the
account-ready state, which the auto-advance effect resolves the moment the
doc lands. CrossAppWelcomePage's profile-exists handler runs the same
doc-aware recovery instead of navigating unconditionally; the
profileLoadError copy names the button that actually exists ("Complete
sign-up"); the redundant unknown/never casts are gone (the store is fully
typed).

**Round 5:** the last unguarded `refreshUserDoc` (CrossAppWelcomePage's
main path) is swallowed -- its rejection reported a SUCCESSFUL enrollment
as genericError; the account-ready state is branch-specific: the
add-profile variant says the PROFILE could not load yet (the enrollee is
authenticated and never chose a password) and its CTA retries the read
instead of pointing at /login; the useless `\"` escape is gone; the
profile-exists both-miss branch got its pin.
