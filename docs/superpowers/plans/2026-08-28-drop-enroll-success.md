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
