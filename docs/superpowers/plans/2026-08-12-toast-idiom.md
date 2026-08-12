# One Feedback Idiom (UX F7 / issue #121) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Success/error feedback is a per-page invention (3-second setTimeout banners, silent refetches, screen swaps). One `Toast` idiom in shared-ui becomes the default for save/accept/decline confirmations across both apps; full-screen confirmations stay only for flow-ending moments (invite sent, enrollment complete — untouched).

## Task 1: Toast in shared-ui (TDD)

`packages/shared-ui/src/components/Toast.tsx` + a `ToastProvider`/`useToast()` (React context — check how shared-ui handles context/hooks today; LanguageSelector shows hooks are acceptable in this package). API: `toast(message: string)` (success tone default) and `toast(message, { tone: 'error' })`. Behavior: bottom-center pill, one at a time (a new toast replaces the current), auto-dismiss ~3s, `role="status"` (success) / `role="alert"` (error), respects reduced-motion (no slide, just appear — base.css clause already collapses transitions), 44px-safe dismissable? Keep v1 non-interactive (auto-dismiss only) — simpler and matches the transient banners it replaces. Timer cleanup on unmount + on replacement (pin with fake timers). Document THE RULE in the component docstring: toasts for confirmations of in-page mutations; full-screen states only for flow-ending moments; inline errors stay inline when tied to a field.

Tests (red-first, renderHook/RTL + fake timers): renders, auto-dismisses, replacement resets timer, roles per tone, provider-less usage throws a clear error.

## Task 2: mount providers + adopt

Mount `ToastProvider` once per app (root layouts/App). Adopt on the KNOWN transient-banner + silent-success sites — audit `setTimeout` in pages (18 files) and convert the SUCCESS feedback only where it's a transient confirmation:
- study tutor AccountPage (policy saved, session-prefs saved), AreaPage (saved), SubjectsPage (saved), family FamilySettingsPage (saved) and equivalents found in the audit.
- sit: family/babysitter AccountPage saves, FamilySettingsPage, admin panels' add/remove confirmations (exemptions, pre-approved emails), HolidaysPage.
- Requests accept/decline (both apps): after the non-optimistic refetch, toast "Accepted"/"Declined" (i18n) — these are currently silent.
KEEP: inline field-tied validation errors; loadError states; full-screen flow-enders (kid-invite sent, enrollment success). Where a page's transient banner also carried an action or explanation, keep the banner (report which).
Per-site table in the report (converted | kept + reason). i18n: reuse existing "saved" strings where present; new keys only where none exist (EN + real FR).

## Task 3: gates

Root typecheck/build; both web suites/lint/build (study ZERO, sit 1/7); full integration+rules once (client-only proof; ~811/82). Representative page tests updated where banners became toasts (assert the toast text appears via role, not the old banner). Report per-site disposition + counts.

## Self-review notes
- One at a time, replace-not-queue — matches the transient banners' semantics.
- Never toast errors that need permanence (loadError stays a page state).
- Non-optimistic ordering unchanged: toast fires AFTER the callable/refetch resolves.
- HEADS-UP: PRs #137 (tutor Account/Area) and #138 (app bars) are open and touch adoption surfaces — work from your branch point; the controller rebases at merge time.
