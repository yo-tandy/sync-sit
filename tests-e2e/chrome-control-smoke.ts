/**
 * Tier-A smoke runbook — driven via the `chrome-control` MCP from inside Claude Code.
 *
 * This file is a TYPED RUNBOOK, NOT an executable test. The runtime is
 *   Claude Code + chrome-control MCP (10 AppleScript-backed tools)
 * — there is no Node / Vitest / Playwright runner. Future replays work by:
 *   1. `Read`-ing this file,
 *   2. Iterating the `SURFACES` array,
 *   3. For each `Step`, issuing exactly one MCP call (`open_url`,
 *      `execute_javascript`, `get_page_content`, or `get_current_tab`)
 *      whose payload comes from the `Step.call` field,
 *   4. Comparing the MCP response against `Step.expected` to verdict PASS/FAIL.
 *
 * The Playwright specs at `tests-e2e/s*-*.spec.ts` are an independent,
 * parallel validation path; this file is NOT a replacement, it is a
 * second source of truth driven differently (AppleScript-injected JS
 * in the user's real Chrome window, vs. headless Chromium).
 *
 * Pre-requisite on first run:
 *   Chrome → View → Developer → "Allow JavaScript from Apple Events" (checked).
 *
 * Disruption posture:
 *   - Reuse the existing localhost:5173 tab when one exists; do NOT
 *     open new tabs unless absolutely necessary.
 *   - Batch DOM probes inside single `execute_javascript` IIFEs that
 *     return structured JSON `{pass, observed}` to minimise MCP
 *     round-trips through AppleScript.
 *   - NEVER drive the user's emulator-UI tab (port 4000) — Firestore
 *     round-trips are MANUAL operator follow-up.
 */

// ─── Types ─────────────────────────────────────────────────────────────────

export type MCPCall =
  | { tool: 'open_url'; url: string; new_tab?: boolean }
  | { tool: 'execute_javascript'; code: string; note: string }
  | { tool: 'get_page_content' }
  | { tool: 'get_current_tab' }
  | { tool: 'switch_to_tab'; tab_id: number };

export interface Step {
  /** Human-readable description of what this step does. */
  description: string;
  /** Exactly one MCP call. */
  call: MCPCall;
  /** Human-readable assertion against the MCP response. */
  expected: string;
}

export interface Surface {
  id: 'S-1' | 'S-2' | 'S-3' | 'S-4' | 'S-5' | 'S-6' | 'S-7' | 'S-8';
  title: string;
  priority: 'P0';
  precondition?: string;
  steps: Step[];
}

// ─── Shared JS snippets (strings — fed to execute_javascript) ──────────────

/**
 * React-aware setter for controlled inputs. React tracks the native
 * value via a hidden descriptor; calling `input.value = x` directly
 * skips React's onChange. The pattern below works on both <input> and
 * <textarea>.
 */
export const REACT_SET_VALUE_SNIPPET = `
  function reactSetValue(el, value) {
    const proto = el.tagName === 'TEXTAREA'
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
`;

/**
 * Fill the login form and submit. Returns `{ok, finalPath, durationMs, error?}`.
 * The login page selectors come from a pre-flight probe: the form has
 * `input[type=email]` + `input[type=password]` and a submit button.
 */
export function signInSnippet(email: string, password: string): string {
  return `(async () => {
    ${REACT_SET_VALUE_SNIPPET}
    const t0 = performance.now();
    try {
      const emailInput = document.querySelector('input[type="email"]');
      const passwordInput = document.querySelector('input[type="password"]');
      if (!emailInput || !passwordInput) {
        return JSON.stringify({ ok: false, error: 'login inputs not found', pathname: location.pathname });
      }
      reactSetValue(emailInput, ${JSON.stringify(email)});
      reactSetValue(passwordInput, ${JSON.stringify(password)});
      const submitBtn = Array.from(document.querySelectorAll('button'))
        .find(b => /^(log in|sign in|login)$/i.test((b.textContent || '').trim()))
        || document.querySelector('button[type="submit"]');
      if (!submitBtn) {
        return JSON.stringify({ ok: false, error: 'submit button not found', pathname: location.pathname });
      }
      submitBtn.click();
      // Wait up to 12s for pathname to change off /login.
      const startPath = location.pathname;
      const deadline = Date.now() + 12000;
      while (Date.now() < deadline) {
        if (location.pathname !== startPath) {
          return JSON.stringify({
            ok: true,
            finalPath: location.pathname,
            durationMs: Math.round(performance.now() - t0)
          });
        }
        await new Promise(r => setTimeout(r, 150));
      }
      return JSON.stringify({
        ok: false,
        error: 'timeout — pathname did not change',
        finalPath: location.pathname,
        durationMs: Math.round(performance.now() - t0),
        visibleErrorText: (document.querySelector('[role="alert"], .text-red-500, .text-red-600, [class*="error"]')?.textContent || '').trim().slice(0, 200)
      });
    } catch (e) {
      return JSON.stringify({ ok: false, error: String(e), pathname: location.pathname });
    }
  })()`;
}

/**
 * Click the admin hamburger button. The admin TopNav uses bg-red-600
 * as its branding wrapper; the hamburger is the button inside.
 * Returns `{found, label, ariaExpanded}`.
 */
export const CLICK_HAMBURGER_SNIPPET = `(() => {
  const candidates = [
    ...document.querySelectorAll('.bg-red-600 button'),
    ...document.querySelectorAll('button[aria-label*="menu" i]'),
    ...document.querySelectorAll('button[aria-label*="hamburger" i]'),
    ...Array.from(document.querySelectorAll('button')).filter(b => b.closest('.bg-red-600'))
  ];
  const seen = new Set();
  const buttons = candidates.filter(b => { if (seen.has(b)) return false; seen.add(b); return true; });
  if (buttons.length === 0) {
    return JSON.stringify({ found: false, reason: 'no .bg-red-600 button on page', pathname: location.pathname });
  }
  // Prefer the one with a 3-line / hamburger SVG or aria-label.
  const btn = buttons.find(b => /menu|hamburger/i.test(b.getAttribute('aria-label') || '')) || buttons[0];
  const before = {
    ariaExpanded: btn.getAttribute('aria-expanded'),
    scrimCountBefore: document.querySelectorAll('.fixed.inset-0').length
  };
  btn.click();
  return JSON.stringify({
    found: true,
    label: (btn.getAttribute('aria-label') || btn.textContent || '').trim().slice(0, 80),
    candidateCount: buttons.length,
    before,
    after: {
      ariaExpanded: btn.getAttribute('aria-expanded'),
      scrimCountAfter: document.querySelectorAll('.fixed.inset-0').length
    }
  });
})()`;

/**
 * Enhanced scrim diagnostic per team-lead's S-1 hypothesis refinement:
 * the Playwright run reported the scrim is in DOM with the bg-black/50
 * class, but `toBeVisible()` resolves it as hidden. So the regression
 * is layout/visibility, NOT colour/token. This dump captures the
 * complete visibility picture so agent-2 can find the real root cause.
 */
export function diagnosticScrimDumpSnippet(scrimSelector: string): string {
  return `(() => {
    function pickStyles(cs) {
      return {
        backgroundColor: cs.backgroundColor,
        opacity: cs.opacity,
        visibility: cs.visibility,
        display: cs.display,
        zIndex: cs.zIndex,
        position: cs.position,
        top: cs.top,
        left: cs.left,
        right: cs.right,
        bottom: cs.bottom,
        width: cs.width,
        height: cs.height,
        transform: cs.transform,
        clip: cs.clip,
        clipPath: cs.clipPath,
        overflow: cs.overflow,
        pointerEvents: cs.pointerEvents,
        isolation: cs.isolation,
        mixBlendMode: cs.mixBlendMode,
        filter: cs.filter
      };
    }
    const all = Array.from(document.querySelectorAll(${JSON.stringify(scrimSelector)}));
    if (all.length === 0) {
      // Broaden search: any .fixed.inset-0 element regardless of bg class.
      const broad = Array.from(document.querySelectorAll('.fixed.inset-0'));
      return JSON.stringify({
        found: false,
        reason: 'primary scrim selector matched 0 elements',
        broadFallbackCount: broad.length,
        broadOuterHtmlExcerpts: broad.slice(0, 3).map(e => (e.outerHTML || '').slice(0, 200)),
        bodyOverflow: document.body.style.overflow,
        bodyChildrenTopLevel: Array.from(document.body.children).map(c => ({
          tag: c.tagName.toLowerCase(),
          cls: (c.className || '').toString().slice(0, 120)
        })).slice(0, 12)
      });
    }
    // If multiple candidates, pick the one with the largest bounding rect.
    const ranked = all.map(el => ({
      el,
      rect: el.getBoundingClientRect()
    })).sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height));
    const target = ranked[0].el;
    const rect = ranked[0].rect;
    const cs = getComputedStyle(target);
    const parent = target.parentElement;
    const pCs = parent ? getComputedStyle(parent) : null;
    const pRect = parent ? parent.getBoundingClientRect() : null;
    return JSON.stringify({
      found: true,
      candidateCount: all.length,
      scrim: {
        computedStyle: pickStyles(cs),
        boundingRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom },
        outerHtmlExcerpt: (target.outerHTML || '').slice(0, 200),
        classList: Array.from(target.classList || []),
        offsetParentTag: target.offsetParent ? target.offsetParent.tagName.toLowerCase() : null,
        isConnected: target.isConnected,
        hidden: target.hidden,
        ariaHidden: target.getAttribute('aria-hidden')
      },
      parent: parent ? {
        tag: parent.tagName.toLowerCase(),
        classList: Array.from(parent.classList || []).slice(0, 12),
        computedStyle: pickStyles(pCs),
        boundingRect: pRect ? { width: pRect.width, height: pRect.height, top: pRect.top, left: pRect.left } : null
      } : null,
      viewport: { innerWidth: window.innerWidth, innerHeight: window.innerHeight, scrollY: window.scrollY },
      dialogContent: {
        roleDialogCount: document.querySelectorAll('[role="dialog"]').length,
        roleDialogVisibleText: Array.from(document.querySelectorAll('[role="dialog"]'))
          .map(d => (d.textContent || '').trim().slice(0, 240))
      }
    });
  })()`;
}

/**
 * Dispatch an Escape keypress on document. Returns whether the scrim
 * element is still present afterwards.
 */
export const ESC_KEY_SNIPPET = `(async () => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
  document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
  await new Promise(r => setTimeout(r, 300));
  return JSON.stringify({
    scrimStillPresent: document.querySelectorAll('.fixed.inset-0').length,
    roleDialogCount: document.querySelectorAll('[role="dialog"]').length,
    bodyOverflow: document.body.style.overflow
  });
})()`;

/**
 * Click the LanguageSelector and confirm <html lang> flipped.
 */
export const TOGGLE_LANGUAGE_SNIPPET = `(async () => {
  const initial = document.documentElement.lang;
  // Common LanguageSelector shapes: a button with FR/EN text, or a select.
  const langBtn = Array.from(document.querySelectorAll('button')).find(b => {
    const t = (b.textContent || '').trim();
    return /^(EN|FR|🇫🇷|🇬🇧|🇺🇸)$/i.test(t) || /lang/i.test(b.getAttribute('aria-label') || '');
  });
  if (langBtn) { langBtn.click(); }
  await new Promise(r => setTimeout(r, 400));
  return JSON.stringify({
    initialLang: initial,
    finalLang: document.documentElement.lang,
    changed: initial !== document.documentElement.lang,
    foundButton: !!langBtn
  });
})()`;

// ─── Surface S-1: Admin Dialog scrim (HIGHEST PRIORITY DIAGNOSTIC) ─────────

export const SURFACE_S1: Surface = {
  id: 'S-1',
  title: 'Admin dashboard hamburger menu — Dialog scrim diagnostic',
  priority: 'P0',
  precondition:
    'Dev server running at http://localhost:5173/; admin@syncsit.test seeded; logged out (or on /login).',
  steps: [
    {
      description: 'Reuse current tab; navigate to app root (will redirect to /login).',
      call: { tool: 'open_url', url: 'http://localhost:5173/', new_tab: false },
      expected: 'tab url contains localhost:5173; React root mounted'
    },
    {
      description: 'Pre-flight probe: confirm login form is rendered.',
      call: {
        tool: 'execute_javascript',
        code: `JSON.stringify({ pathname: location.pathname, hasEmail: !!document.querySelector('input[type=\"email\"]'), hasPassword: !!document.querySelector('input[type=\"password\"]'), rootChildren: document.getElementById('root')?.children.length ?? 0 })`,
        note: 'pre-flight'
      },
      expected: '{pathname:"/login",hasEmail:true,hasPassword:true,rootChildren≥1}'
    },
    {
      description: 'Sign in as admin@syncsit.test / test1234.',
      call: {
        tool: 'execute_javascript',
        code: signInSnippet('admin@syncsit.test', 'test1234'),
        note: 'signIn admin'
      },
      expected: '{ok:true,finalPath:"/admin" or "/admin/..."}'
    },
    {
      description: 'Click the admin hamburger button (button inside .bg-red-600).',
      call: { tool: 'execute_javascript', code: CLICK_HAMBURGER_SNIPPET, note: 'click hamburger' },
      expected: '{found:true,after.scrimCountAfter ≥ before.scrimCountBefore + 1}'
    },
    {
      description:
        'DIAGNOSTIC DUMP — scrim computed style + parent style + bounding rect + outerHTML + dialog content. Single IIFE.',
      call: {
        tool: 'execute_javascript',
        code: diagnosticScrimDumpSnippet('.fixed.inset-0.bg-black\\/50'),
        note: 'S-1 scrim diagnostic'
      },
      expected:
        'found:true + full computed-style + bounding rect with non-zero width/height = PASS; zero rect or visibility:hidden or display:none = root-cause hint for agent-2'
    },
    {
      description: 'Capture document.body text to confirm Dialog content is in DOM.',
      call: { tool: 'get_page_content' },
      expected: 'page text includes menu items (sign out / navigation links)'
    },
    {
      description: 'Dispatch Escape keypress and verify scrim element removed.',
      call: { tool: 'execute_javascript', code: ESC_KEY_SNIPPET, note: 'ESC close' },
      expected: '{scrimStillPresent:0, roleDialogCount:0}'
    }
  ]
};

// ─── Surface S-5: SchedulePage WeeklyTimeline ─────────────────────────────

export const SURFACE_S5: Surface = {
  id: 'S-5',
  title: 'SchedulePage WeeklyTimeline — render + persisted availability',
  priority: 'P0',
  precondition: 'Logged out (or signed out from previous run); lea.bernard@ejm.org seeded.',
  steps: [
    {
      description: 'Sign in as lea.bernard@ejm.org.',
      call: { tool: 'execute_javascript', code: signInSnippet('lea.bernard@ejm.org', 'test1234'), note: 'signIn lea' },
      expected: '{ok:true,finalPath:"/babysitter"}'
    },
    {
      description: 'Navigate to /babysitter/schedule.',
      call: { tool: 'open_url', url: 'http://localhost:5173/babysitter/schedule', new_tab: false },
      expected: 'url loads'
    },
    {
      description: 'Probe grid: 7 day-of-week labels + time-of-day scale + seeded availability cells.',
      call: {
        tool: 'execute_javascript',
        code: `JSON.stringify({pathname: location.pathname, hasMon: /\\bMon\\b/.test(document.body.innerText), hasSun: /\\bSun\\b/.test(document.body.innerText), hasTimeMarkers: /6h.*8h.*10h.*12h/s.test(document.body.innerText), hasAvailabilityText: /Available.*Unavailable/s.test(document.body.innerText), seededRanges: (document.body.innerText.match(/\\d{2}:\\d{2}/g) || []).slice(0, 10), saveButton: !!Array.from(document.querySelectorAll('button')).find(b => /^Save Schedule$/i.test((b.textContent||'').trim())), grid: !!document.querySelector('[role=\"grid\"], .grid')})`,
        note: 'schedule grid probe'
      },
      expected:
        '{hasMon:true,hasSun:true,hasTimeMarkers:true,hasAvailabilityText:true,seededRanges.length>0,saveButton:true,grid:true}'
    }
    // NOTE: drag-select persistence test is MANUAL. Synthesising a multi-cell
    // drag through synthetic pointer events mutates Lea's schedule with no
    // safe revert path — chrome-control should not perform it.
  ]
};

// ─── Surface S-6: PhoneInput (L6 oracle live counterpart) ──────────────────

export const SURFACE_S6: Surface = {
  id: 'S-6',
  title: 'PhoneInput — L6 oracle live counterpart at /family/account',
  priority: 'P0',
  precondition: 'Logged out; marie.dupont@test.com seeded; her phone is "612345678" under +33.',
  steps: [
    {
      description: 'Sign in as marie.dupont@test.com.',
      call: { tool: 'execute_javascript', code: signInSnippet('marie.dupont@test.com', 'test1234'), note: 'signIn marie' },
      expected: '{ok:true,finalPath:"/family"}'
    },
    {
      description: 'Navigate to /family/account.',
      call: { tool: 'open_url', url: 'http://localhost:5173/family/account', new_tab: false },
      expected: 'url loads, input[type=tel] present, select with country codes present'
    },
    {
      description:
        'Run +33 oracle: save originals, clear, type "06", expect leading-0 strip → value "6".',
      call: {
        tool: 'execute_javascript',
        code: `(() => {
          ${REACT_SET_VALUE_SNIPPET}
          const sel = document.querySelector('select');
          const tel = document.querySelector('input[type="tel"]');
          window.__origSel = sel.value;
          window.__origTel = tel.value;
          const results = [];
          reactSetValue(tel, '');
          results.push({step: 'clear', selValue: sel.value, telValue: tel.value});
          reactSetValue(tel, '06');
          results.push({step: 'type 06 under +33', selValue: sel.value, telValue: tel.value, expected: '6'});
          return JSON.stringify({origSel: window.__origSel, origTel: window.__origTel, results});
        })()`,
        note: 'S-6 +33 oracle'
      },
      expected: 'last step telValue === "6"'
    },
    {
      description:
        'Attempt +44 country switch via React-prototype select setter. (KNOWN LIMITATION: React controlled <select> reverts synthetic-event changes; +44 oracle cannot be verified through chrome-control alone — defer to Playwright spec s6 which uses page.selectOption.)',
      call: {
        tool: 'execute_javascript',
        code: `(() => {
          const sel = document.querySelector('select');
          const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
          setter.call(sel, '+44');
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          return JSON.stringify({immediateValue: sel.value, immediateIndex: sel.selectedIndex, hasValueTracker: !!sel._valueTracker, optionCount: sel.options.length});
        })()`,
        note: 'S-6 +44 attempt — documented as inconclusive'
      },
      expected: 'observation only; React reconciles back to +33 between MCP calls'
    },
    {
      description: 'Restore Marie\'s original phone value (no save → no mutation).',
      call: {
        tool: 'execute_javascript',
        code: `(() => {
          ${REACT_SET_VALUE_SNIPPET}
          const tel = document.querySelector('input[type="tel"]');
          reactSetValue(tel, '612345678');
          tel.blur();
          return JSON.stringify({restoredTel: tel.value, selValue: document.querySelector('select').value});
        })()`,
        note: 'restore'
      },
      expected: '{restoredTel:"612345678",selValue:"+33"}'
    }
  ]
};

// ─── Surface S-7: AddressAutocomplete ──────────────────────────────────────

export const SURFACE_S7: Surface = {
  id: 'S-7',
  title: 'AddressAutocomplete — BAN suggestions at /family/settings',
  priority: 'P0',
  precondition: 'Signed in as marie.dupont@test.com; her family address is "15 Rue de Passy, 75016 Paris".',
  steps: [
    {
      description: 'Navigate to /family/settings (address provider is BAN — adresse.data.gouv.fr, no key needed in dev).',
      call: { tool: 'open_url', url: 'http://localhost:5173/family/settings', new_tab: false },
      expected: 'url loads, input[placeholder="Start typing an address..."] present'
    },
    {
      description: 'Save original address, clear, type "10 rue marc" (3-letter partial that yields multi-result suggestions).',
      call: {
        tool: 'execute_javascript',
        code: `(() => {
          ${REACT_SET_VALUE_SNIPPET}
          const addrInput = document.querySelector('input[placeholder="Start typing an address..."]');
          window.__originalAddress = addrInput.value;
          addrInput.focus();
          reactSetValue(addrInput, '');
          reactSetValue(addrInput, '10 rue marc');
          return JSON.stringify({original: window.__originalAddress, typed: addrInput.value, focused: document.activeElement === addrInput});
        })()`,
        note: 'S-7 type partial'
      },
      expected: 'typed === "10 rue marc"; debounce + fetch fires; subsequent probe finds suggestions'
    },
    {
      description: 'Probe for the suggestion dropdown — a sibling <div class="absolute ... z-20 ... bg-white shadow-lg"> rendered next to the input, NOT a Portal.',
      call: {
        tool: 'execute_javascript',
        code: `JSON.stringify({suggestionButtons: Array.from(document.querySelectorAll('button')).filter(b => /\\d{5}\\s\\w/.test((b.textContent||'').trim())).map(b => (b.textContent||'').trim().slice(0, 80))})`,
        note: 'S-7 probe suggestions'
      },
      expected: 'suggestionButtons.length ≥ 1, each contains "📍" + street + postal code'
    },
    {
      description: 'Click a specific suggestion ("10 Rue Marc Séguin · 75018 Paris") and verify input fills.',
      call: {
        tool: 'execute_javascript',
        code: `(() => {
          const addrInput = document.querySelector('input[placeholder="Start typing an address..."]');
          const beforeValue = addrInput.value;
          const btn = Array.from(document.querySelectorAll('button')).find(b => /Marc Séguin/.test((b.textContent||'').trim()) && /75018/.test((b.textContent||'').trim()));
          if (!btn) return JSON.stringify({notFound: true});
          btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          btn.click();
          return JSON.stringify({clicked: true, beforeValue, btnText: (btn.textContent||'').trim().slice(0, 80)});
        })()`,
        note: 'S-7 click suggestion'
      },
      expected: 'clicked:true; subsequent probe shows input.value === full picked address'
    },
    {
      description: 'Verify input updated and dropdown dismissed (probed in next MCP call to let React commit).',
      call: {
        tool: 'execute_javascript',
        code: `JSON.stringify({inputValue: document.querySelector('input[placeholder="Start typing an address..."]').value, suggestionsStillVisible: !!Array.from(document.querySelectorAll('button')).find(b => /Marc Séguin/.test((b.textContent||'').trim()))})`,
        note: 'S-7 verify pick'
      },
      expected: '{inputValue:"10 Rue Marc Séguin 75018 Paris",suggestionsStillVisible:false}'
    },
    {
      description: 'Restore original address (no save → no mutation).',
      call: {
        tool: 'execute_javascript',
        code: `(() => {
          ${REACT_SET_VALUE_SNIPPET}
          const addrInput = document.querySelector('input[placeholder="Start typing an address..."]');
          reactSetValue(addrInput, window.__originalAddress || '15 Rue de Passy, 75016 Paris');
          addrInput.blur();
          return JSON.stringify({restoredTo: addrInput.value});
        })()`,
        note: 'restore'
      },
      expected: '{restoredTo:"15 Rue de Passy, 75016 Paris"}'
    }
  ]
};

// ─── SURFACES export ───────────────────────────────────────────────────────
// S-2/S-3/S-4 deferred — Dialog cascade per S-1 FAIL policy.
// S-8 deferred — verification-code path requires emulator UI interaction.

export const SURFACES: Surface[] = [SURFACE_S1, SURFACE_S5, SURFACE_S6, SURFACE_S7];
