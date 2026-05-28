# Tier-A Smoke Results — chrome-control MCP run

**PR:** #45 — sync-study Phase 1 (`@ejm/shared-core` + `@ejm/shared-ui` extraction)
**HEAD at run time:** `70f9a24` (Playwright specs already committed by agent-8-tester predecessor)
**Branch:** `feature/sync-study-tester-phase1-smoke`
**Date:** 2026-05-21
**Runner:** agent-8c-tester via `chrome-control` MCP (AppleScript-driven JS in the user's visible Chrome window)
**Approach:** independent validation alongside the Playwright run; covers Tier-A surfaces S-1, S-5, S-6, S-7. S-2/S-3/S-4 deferred (Dialog cascade per S-1 FAIL policy); S-8 deferred per predecessor.

**Companion spec/runbook:** `tests-e2e/chrome-control-smoke.ts` — typed `Surface[]` manifest with every MCP call + JS snippet used in this run, replay-able by a future agent.

---

## Overall verdict — **RED**

S-1 is a hard merge-block due to a Tailwind utility-compilation gap that cascades into S-2/S-3/S-4 (and surfaces 4 additional Dialog regressions). S-5, S-6, S-7 are non-blocking — they pass for everything chrome-control can reliably observe.

| Surface | Verdict | Notes |
|---|---|---|
| S-1 Admin Dialog scrim | **FAIL** | Tailwind utility compilation gap. Full diagnostic below. |
| S-2 EndorsementDialog | **DEFERRED** | Dialog cascade |
| S-3 Modify-appointment | **DEFERRED** | Dialog cascade |
| S-4 PhotoLightbox | **DEFERRED** | Dialog cascade |
| S-5 SchedulePage WeeklyTimeline | **PASS (render)** | Grid + labels + seeded availability all render. Drag-persist = MANUAL. |
| S-6 PhoneInput | **PARTIAL PASS** | +33 oracle verified. +44 branch not verifiable via chrome-control synthetic events; covered by Playwright + vitest oracle. |
| S-7 AddressAutocomplete | **PASS** | Type → suggest → pick → input fills. BAN free API. Firestore latLng round-trip = MANUAL. |
| S-8 Enrollment happy path | **DEFERRED** | Verification-code path needs emulator UI driving — out of scope. |

---

## S-1: Admin Dialog scrim — **FAIL** (root cause identified)

### Topline

The scrim element IS in the DOM with the right className (`fixed inset-0 bg-black/50`), but the Tailwind utilities `inset-0` and `bg-black/50` are **not present in the compiled CSS bundle**. The element falls back to `position: fixed` with no positioning + transparent background, giving it a **0×0 bounding rect** at a random offset.

This is **NOT** a colour/token issue. It is a **Tailwind v4 content-scan / utility-generation regression** caused by the Phase 1 shared-ui extraction.

### Evidence — scrim element

Selector: `.fixed.inset-0.bg-black/50` (classList confirms all three classes present)

```
position:        fixed          ✓ applied
top:             413.617px      ✗ should be 0
left:            102.242px      ✗ should be 0
right:           600.758px      ✗ should be 0
bottom:          520.383px      ✗ should be 0
width:           0px            ✗ should be viewport-wide
height:          0px            ✗ should be viewport-tall
backgroundColor: rgba(0,0,0,0)  ✗ should be rgba(0,0,0,0.5)
opacity:         1
visibility:      visible
display:         block
zIndex:          auto
transform:       none
clipPath:        none
pointerEvents:   auto
```

Bounding rect: `{x: 102.24, y: 413.62, width: 0, height: 0}` — zero surface area, so backdrop-click is also dead.

### Evidence — parent wrapper

Selector: `<div class="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto p-4">`

```
fixed              ✓ position: fixed
inset-0            ✗ top:51px, left:0, right:498.508px, bottom:157.758px (NOT 0)
z-50               ✓ zIndex: 50
flex               ✓ display: flex
items-center       ✓ alignItems: center
justify-center     ✓ justifyContent: center
overflow-y-auto    ✓ overflowY: auto
p-4                ✓ padding: 17px (~1rem)
```

Bounding rect: `{width:204.49, height:725.24, top:51, left:0}` — parent shrinks to content size instead of filling viewport. Viewport: `703×934`.

### Evidence — Dialog panel (inner content)

Selector: `<div class="relative my-auto w-full max-w-sm rounded-xl bg-white p-6">`

```
relative           ✓ position: relative
w-full             ✓ width: 170.49px (matches parent)
max-w-sm           ✓ maxWidth: 408px
rounded-xl         ✓ borderRadius: 21.25px
bg-white           ✓ backgroundColor: rgb(255,255,255)
my-auto            ✗ marginTop/Bottom: 0px / 0px (NOT auto)
p-6                ✗ padding: 0px (NOT 24px)
```

### Pattern: which utilities work, which don't

| Utility | Works? | Probable source-coverage |
|---|---|---|
| `fixed`, `z-50`, `flex`, `items-center`, `justify-center`, `overflow-y-auto`, `p-4`, `bg-white`, `rounded-xl`, `w-full`, `max-w-sm`, `relative` | ✓ | Used widely in apps/web |
| `inset-0`, `bg-black/50`, `my-auto`, `p-6` | ✗ | Likely only used inside the extracted shared-ui Dialog component |

**The broken utilities all map to classes that appear only inside `packages/shared-ui` source — classic Tailwind content-glob omission.**

### Why agent-2's planned fix likely won't help

agent-2's defensive `bg-black/50` → `bg-[rgb(0_0_0/0.5)]` swap addresses the assumption that arbitrary-value `/opacity` syntax is the failure point. The actual problem is that the utility class string `bg-black/50` is not being scanned by Tailwind's JIT and the rule for it isn't being generated in the CSS bundle. The same problem affects `inset-0`, `my-auto`, and `p-6`, none of which use the `/opacity` syntax. Even if the swap recovers the scrim colour, the scrim will still be 0×0 (because `inset-0` isn't compiled) and the panel will still have wrong padding/margins.

### Suggested root-cause investigation

Check the apps/web Tailwind config (`tailwind.config.ts` or `apps/web/tailwind.config.*` or `apps/web/vite.config.*` for the `@tailwindcss/vite` plugin's content config):

1. Does the `content` glob include `packages/shared-ui/src/**/*.{ts,tsx}`?
2. If yes, is Tailwind picking it up at build time? Check the generated CSS bundle for `.inset-0`, `.bg-black\/50`, `.my-auto`, `.p-6` selectors.
3. If `packages/shared-ui` is built to JS first and imported as a built dependency, Tailwind also needs to scan the **built output** or have the source as content.
4. Tailwind v4: the `@source "../shared-ui/src/**/*";` directive in the consuming CSS may be needed.

### Additional Dialog regressions surfaced during S-1 probing

These are independent of the Tailwind issue and exist in the underlying Dialog component:

1. **ESC does not close the menu.** Dispatched a synthetic `keydown`+`keyup` Escape event; scrim and dialog remained mounted, `bodyOverflow` stayed `hidden`. No keydown listener on the Dialog.
2. **Re-clicking the hamburger does not toggle close.** The button is open-only.
3. **No close-X / Cancel control inside the menu.** Searched for any button matching `close|fermer|×|✕|x` — zero matches.
4. **Backdrop-click dismiss is also dead** — downstream effect of the 0×0 scrim; once `inset-0` is fixed, this should recover.
5. **`[role="dialog"]` is absent** — zero elements with that role. A11y regression on top of the visual one.

Findings 1–3 + 5 are independent of the Tailwind fix. Finding 4 should recover with the Tailwind fix.

To clean up the user's browser state after diagnosis, I navigated back to `/admin` to unmount everything. `bodyOverflow` restored to `visible`.

---

## S-2 — DEFERRED

Per the S-1-fail cascade policy: any other Dialog-based surface will exhibit the same scrim regression until the Tailwind content-glob is fixed. Re-runnable once agent-2's fix lands.

## S-3 — DEFERRED

Same cascade. Also: the predecessor's Playwright spec marks this `test.fixme()` for a separate reason (deterministic confirmed-appointment seed missing).

## S-4 — DEFERRED

Same cascade. PhotoLightbox uses the Dialog pattern, will exhibit the same scrim regression.

---

## S-5: SchedulePage WeeklyTimeline — **PASS (render)**

Test account: `lea.bernard@ejm.org` / `test1234`. Route: `/babysitter/schedule`.

### Verified (chrome-control)

- ✓ Page header reads "My Schedule / Regular Availability".
- ✓ All 7 day-of-week labels present in document: `Mon Tue Wed Thu Fri Sat Sun`.
- ✓ Time-of-day scale renders: `6h 8h 10h 12h 14h 16h 18h 20h 22h 0h`.
- ✓ Seeded availability ranges visible: `10:00-23:00`, `10:00-20:00`, `14:00-22:00`, `17:00-22:00`, `17:00-23:00` (multiple weekdays).
- ✓ Legend "Available / Unavailable" present.
- ✓ Helper text "Drag to add · Tap to edit" present.
- ✓ "Save Schedule" button present (so explicit-save is wired).
- ✓ Holiday section also renders (Same as regular / Different schedule / Not available).

### Not verified

- **Drag-select 4 consecutive slots and persist** — MANUAL. Synthesising a multi-cell mousedown/mousemove/mouseup drag through chrome-control would mutate Lea's schedule, and there is no clean revert path (no "discard changes" affordance found). This needs a human operator OR the Playwright spec.
- **Firestore round-trip** (`schedules/{lea-uid}.weekly.tue` indices 32-35 == `true`) — MANUAL. Per the plan, we do not drive the emulator UI tab.
- **EN ⇄ FR translation** — INDETERMINATE. The LanguageSelector is NOT exposed in the babysitter shell on this view (probed `<button>`, `<a>`, `<select>` for `EN|FR|Français|English|🌐|lang|locale` — zero matches). Either there's a sub-menu I didn't traverse, or it's role-gated. Predecessor's Playwright spec also doesn't toggle language for this surface.

### Verdict

S-5 PASS on render and seeded-state. Drag-persist and i18n need a separate path (Playwright OR human).

---

## S-6: PhoneInput — **PARTIAL PASS**

Test account: `marie.dupont@test.com` / `test1234`. Route: `/family/account`. Marie's seeded phone is `612345678` under `+33` (i.e. France-formatted, leading-0 already stripped per oracle).

DOM: `<select>` with 29 country-code options (default `+33`) + `<input type="tel" placeholder="6 12 34 56 78">`.

### Verified (chrome-control)

- ✓ Initial DOM: country select default `+33`, tel input seeded `612345678`.
- ✓ **Clear:** `reactSetValue(tel, '')` → tel value becomes `""` (empty).
- ✓ **Leading-0 strip under +33:** `reactSetValue(tel, '06')` → tel renders `"6"`. Matches the L6 vitest oracle.

### Blocked

- ✗ **Country-code switch +33 → +44 via synthetic events.** React's controlled `<select>` reconciles back to its prop value between MCP calls. Tried: `Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, '+44')` + `sel.dispatchEvent(new Event('change', {bubbles:true}))`. The DOM `sel.value` is `"+44"` inside the same IIFE, but the next MCP call reads `"+33"` — React's controlled-input loop snaps it back. `_valueTracker` is absent on the select element so the input-tracker trick doesn't apply.

  **This is a chrome-control synthetic-event limitation, NOT a PhoneInput bug.** The L6 vitest oracle covers the +44 leading-0-no-strip branch directly. The predecessor's Playwright spec `tests-e2e/s6-phone-input.spec.ts` uses `page.selectOption` which drives the native select correctly — that spec is already on disk and authoritative for +44.

- ⚠ **EN ⇄ FR translation:** INDETERMINATE — LanguageSelector not exposed in the family shell on this view either.

### Cleanup

Restored: `tel.value = '612345678'`, `select.value = '+33'`. No form save → no Firestore mutation.

### Verdict

PARTIAL PASS. The +33 branch matches the oracle; the +44 branch needs Playwright (already covered).

---

## S-7: AddressAutocomplete — **PASS**

Test account: `marie.dupont@test.com`. Route: `/family/settings`. Marie's seeded address is `15 Rue de Passy, 75016 Paris`. Address provider: **BAN** (`adresse.data.gouv.fr`) — a French government free API, no key needed in dev. The provider attribution is visible in-page: "📍 Powered by adresse.data.gouv.fr".

### Verified (chrome-control)

1. ✓ Input found by placeholder `Start typing an address...`, seeded value present.
2. ✓ Cleared via `reactSetValue('')`, typed `"10 rue marc"`.
3. ✓ After debounce, dropdown renders with 5 suggestions:
   - `10 Rue Marc · 59330 Hautmont`
   - `10 Rue Marc Sangnier · 35200 Rennes`
   - `10 Rue Marc Arcis · 31200 Toulouse`
   - `10 Rue Marc Sangnier · 44200 Nantes`
   - `10 Rue Marc Séguin · 75018 Paris`
4. ✓ Suggestion DOM: each suggestion is a `<button class="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50">` inside a `<div class="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg">` sibling of the input (NOT a Portal). All Tailwind utilities on this dropdown render correctly — corroborates the "broken utilities are Dialog-specific" hypothesis from S-1.
5. ✓ Clicked the Paris suggestion (`10 Rue Marc Séguin · 75018 Paris`).
6. ✓ Input value updated to `"10 Rue Marc Séguin 75018 Paris"`. Dropdown dismissed.

### Not verified (MANUAL)

- ✗ **Firestore round-trip:** `families/{familyId}.address` (string) + `latLng: {lat, lng}` (numbers). Confirming the picked suggestion's `latLng` was pushed to the parent form and would persist on Save requires either driving Save (mutates Marie's data) or driving the emulator UI tab (disruptive per plan). MANUAL for the operator.

### Cleanup

Restored: `addrInput.value = "15 Rue de Passy, 75016 Paris"`. No form save → no Firestore mutation.

### Verdict

PASS for type → suggest → pick → input fill. Firestore persistence MANUAL.

---

## S-8 — DEFERRED

Per the predecessor's call: the verification-code path needs reading a 6-digit code from the Firestore emulator UI's `verificationCodes/{email}` document (or the function logs). chrome-control would have to drive the emulator UI tab, which the plan explicitly avoids. Predecessor's Playwright specs `s8a-enrollment-account.spec.ts` and `s8b-enrollment-profile.spec.ts` mark this `test.fixme()` with a "emulator verificationCodes fixture not yet written" reason — same blocker. Re-runnable when that fixture lands.

---

## Known gaps / out-of-scope for this run

These need manual operator follow-up OR the parallel Playwright run:

1. **Firestore round-trips** for S-2 (endorsement doc), S-3 (`modified=true`), S-5 (weekly slots), S-7 (`latLng`). Not driven from chrome-control by design.
2. **Storage round-trip** for S-8 (profile-photo upload to `profile-photos/{uid}.ext`). Same reasoning.
3. **EN ⇄ FR translation toggle** across authenticated shells. LanguageSelector appears on the unauthenticated landing TopNav and inside the admin hamburger menu — but I could not locate it in the babysitter or family shells. Either it's role-gated to admin / landing, or it's an icon-only button I didn't recognise. Worth a dedicated audit (separate from this smoke).
4. **Screenshot evidence.** Not feasible without injecting html2canvas or using a browser extension API. All evidence in this run is structured-data (`getComputedStyle`, `getBoundingClientRect`, `outerHTML` excerpts, `get_page_content` text). For visual evidence, see the Playwright run's `test-results/s1-dialog-scrim.png`.
5. **+44 PhoneInput branch:** the L6 vitest oracle covers it; Playwright covers it; chrome-control synthetics cannot reliably reach React-controlled `<select>` state.

---

## Methodology notes (for future replays)

**Spec file as runbook:** `tests-e2e/chrome-control-smoke.ts` encodes every step as a typed `Surface[]` (discriminated union of MCP calls + JS snippets + expected assertions). The replay protocol is: `Read` the file, iterate the `SURFACES` array, and for each `Step` issue exactly one chrome-control MCP call.

**One pre-flight gate:** `Chrome → View → Developer → Allow JavaScript from Apple Events` must be checked. Without it, `execute_javascript` returns "Google Chrome is not running" while `list_tabs` / `get_current_tab` succeed. (This was the initial blocker on first attempt — user enabled the toggle once and it stuck.)

**Active-tab discipline:** chrome-control's `execute_javascript` runs against the FRONT tab in Chrome, not a tab specified by id. If the user switches tabs while the script runs, JS fires into the wrong document and returns "Google Chrome is not running" (the AppleScript bridge refuses non-eligible tabs). Mitigation: `switch_to_tab` before each call OR ask the user to keep the localhost tab in front during runs.

**No async returns:** AppleScript-injected `execute_javascript` fires the IIFE but does not await promises before returning. Pattern: split async flows (e.g. "wait for nav") into action-snippet + probe-snippet across two MCP calls.

**React controlled inputs:** the prototype-setter trick (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, val)` + `dispatchEvent('input')`) works reliably for `<input>` / `<textarea>`. It does NOT work for `<select>` — React reconciles the controlled value back between MCP calls. Use Playwright `selectOption` for select-driven flows.

**Disruption posture:** all runs reused the user's existing localhost:5173 tab; no new tabs were opened in Chrome. Marie's address and phone were restored to seeded values before signing out. No Firestore writes were performed by chrome-control.
