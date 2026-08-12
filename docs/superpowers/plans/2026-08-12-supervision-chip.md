# Supervision Visibility Chip (UX F14 / issue #128) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A supervised kid currently learns their account is supervised only deep in Account settings. Give the state ambient visibility: a small persistent shield chip in the provider portal's app bar (study tutor + sit babysitter), linking to the transparency page — trust is the feature, keep it visible.

## Task 1: SupervisionChip component (shared per app or shared-ui — decide by reading how the app bars source components; prefer shared-ui since both apps need it and it has the ShieldIcon)

Renders ONLY when the signed-in user's own doc has `governedBy` (read from the app's auth store userDoc — no new Firestore reads). Small pill: shield icon + short label (i18n `supervision.chipLabel`: "Supervised" / "Supervisé"), `aria-label` with the fuller phrase, links to `/supervision-info`. Visual: subtle (brand-50 bg, brand-700 text — the new ramp), 44px hit target per the fresh a11y convention (h-11 hit box if the visible pill is smaller). Place in the app-bar row for the tutor portal (study AppBar) and babysitter portal (sit AppBar) — NOT parent/family bars.

## Task 2: wiring + tests (TDD)

- study AppBar: chip renders for governed tutor userDoc, absent otherwise (both pinned); href pinned; sit AppBar same.
- i18n EN + real FR both apps (or shared strings if the component lands in shared-ui — check how shared-ui components handle i18n: they receive strings as props (LanguageSelector pattern) — follow that: component takes label/href props, apps pass translated strings).
- a11y: aria-label pinned; hit-target classes pinned (match #136's conventions).

## Task 3: gates

Root typecheck/build; both web suites/lint/build (study ZERO, sit 1/7 baseline); full integration+rules once (client-only proof, report baseline ~810/82).

## Self-review notes
- `governedBy` present ⇔ ACTIVE supervision (the mirror's invariant) — no status logic needed client-side.
- Don't render in parent portals or public pages.
- The chip must not crowd the app-bar title on a 320px viewport — keep the label short; icon-only below `sm` is acceptable if needed (then the aria-label carries the meaning).
