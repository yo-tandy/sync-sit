import { describe, it, expect } from 'vitest';
import {
  buildEndorsementOutcome,
  buildEndorsementReceived,
  buildGuardianApprovalRequested,
  buildGuardianDecisionForChild,
  buildNewTaskDigest,
  buildTaskAssignedGuardian,
  buildTaskCancelledForDoer,
  buildTaskCancelledForFamily,
  buildTaskCompletedForDoer,
  buildTaskMarkedDoneForFamily,
  buildTaskOfferAccepted,
  buildTaskOfferDeclined,
  buildTaskOfferReceived,
  buildTaskUpdated,
  categoryLabel,
  fallbackDoerName,
  formatPrice,
  resolveDoLang,
  type DoLang,
} from '../notifyContent.js';

// Copy pins for the §10 notification copy — the nine task/offer types
// (plan §13 PR9) and the endorsement trio that joins them at PR11: EN+FR present,
// user-controlled strings escaped in HTML bodies (raw in subjects — RFC 5322
// headers are never HTML-decoded), and every CTA on the LIVE web.app host —
// never sync-do.com (§10 / issue #156).

const LANGS: DoLang[] = ['en', 'fr'];

const XSS = `<img src=x> & O'Brien`;
const XSS_ESCAPED = '&lt;img src=x&gt; &amp; O&#39;Brien';

describe('resolveDoLang', () => {
  it("maps 'fr' to fr and everything else to en", () => {
    expect(resolveDoLang('fr')).toBe('fr');
    expect(resolveDoLang('en')).toBe('en');
    expect(resolveDoLang(undefined)).toBe('en');
    expect(resolveDoLang('de')).toBe('en');
  });
});

describe('formatPrice', () => {
  it('formats flat and hourly for both locales', () => {
    expect(formatPrice('en', 25, 'flat')).toBe('€25');
    expect(formatPrice('en', 12, 'hourly')).toBe('€12/h');
    expect(formatPrice('fr', 25, 'flat')).toBe('25 €');
    expect(formatPrice('fr', 12, 'hourly')).toBe('12 €/h');
  });
});

describe('every builder, both languages', () => {
  function allContents(lang: DoLang) {
    return [
      buildTaskOfferReceived(lang, { doerFirstName: 'Léa', taskTitle: 'Mow the lawn', taskId: 't1', price: 20, priceBasis: 'flat' }),
      buildGuardianApprovalRequested(lang, { childFirstName: 'Léa', taskTitle: 'Mow the lawn' }),
      buildGuardianDecisionForChild(lang, { decision: 'approved', taskTitle: 'Mow the lawn', taskId: 't1' }),
      buildGuardianDecisionForChild(lang, { decision: 'denied', taskTitle: 'Mow the lawn', taskId: 't1' }),
      buildTaskOfferAccepted(lang, { familyName: 'Dupont', taskTitle: 'Mow the lawn', taskId: 't1', agreedPrice: 20, priceBasis: 'flat' }),
      buildTaskAssignedGuardian(lang, { childFirstName: 'Léa', familyName: 'Dupont', taskTitle: 'Mow the lawn', agreedPrice: 20, priceBasis: 'flat' }),
      buildTaskOfferDeclined(lang, { taskTitle: 'Mow the lawn', reason: 'family_declined' }),
      buildTaskOfferDeclined(lang, { taskTitle: 'Mow the lawn', reason: 'sibling_accepted' }),
      buildTaskCancelledForDoer(lang, { taskTitle: 'Mow the lawn', assigned: true }),
      buildTaskCancelledForDoer(lang, { taskTitle: 'Mow the lawn', assigned: false }),
      buildTaskCancelledForFamily(lang, { doerFirstName: 'Léa', taskTitle: 'Mow the lawn', taskId: 't1' }),
      buildTaskUpdated(lang, { taskTitle: 'Mow the lawn', taskId: 't1' }),
      buildTaskMarkedDoneForFamily(lang, { doerFirstName: 'Léa', taskTitle: 'Mow the lawn', taskId: 't1' }),
      buildTaskCompletedForDoer(lang, { familyName: 'Dupont', taskTitle: 'Mow the lawn' }),
      buildNewTaskDigest(lang, [
        { taskId: 't1', title: 'Mow the lawn', category: 'green_thumb', areaLabel: '16e', suggestedBudget: 30 },
        { taskId: 't2', title: 'Fix the printer', category: 'it', areaLabel: 'Boulogne', suggestedBudget: null },
      ]),
      // The §10 endorsement trio (PR11) — held to every pin above.
      buildEndorsementReceived(lang, { submitterLabel: 'Marie Dupont', taskTitle: 'Mow the lawn' }),
      buildEndorsementOutcome(lang, { action: 'accept', doerFirstName: 'Léa' }),
      buildEndorsementOutcome(lang, { action: 'decline', doerFirstName: 'Léa' }),
    ];
  }

  it('all builders return non-empty subject/emailBody/title/body in both languages', () => {
    for (const lang of LANGS) {
      for (const c of allContents(lang)) {
        expect(c.subject.length).toBeGreaterThan(0);
        expect(c.emailBody.trim().length).toBeGreaterThan(0);
        expect(c.title.length).toBeGreaterThan(0);
        expect(c.body.length).toBeGreaterThan(0);
      }
    }
  });

  it('EN and FR copy actually differ (no locale silently falling back)', () => {
    const en = allContents('en');
    const fr = allContents('fr');
    for (let i = 0; i < en.length; i++) {
      expect(en[i].emailBody).not.toBe(fr[i].emailBody);
    }
  });

  it('every CTA href builds on the live web.app host — sync-do.com never appears', () => {
    // The ONE non-web.app href allowed anywhere in do copy: the digest's
    // opt-out address, on the VERIFIED sending domain (PR #334 round-3
    // review). Named exactly, so a mailto: to any other address — or a
    // sync-do.com one, which would bounce — still fails this pin.
    const OPT_OUT_MAILTO = 'mailto:support@sync-sit.com';
    for (const lang of LANGS) {
      for (const c of allContents(lang)) {
        expect(c.emailBody).not.toContain('sync-do.com');
        const hrefs = [...c.emailBody.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
        for (const href of hrefs) {
          expect(
            href.startsWith('https://sync-do-app.web.app') || href === OPT_OUT_MAILTO,
          ).toBe(true);
        }
      }
    }
  });
});

describe('HTML escaping (issue #188 convention)', () => {
  it('escapes user-controlled strings in HTML bodies, leaves subjects raw', () => {
    const c = buildTaskOfferReceived('en', {
      doerFirstName: XSS,
      taskTitle: XSS,
      taskId: 't1',
      price: 20,
      priceBasis: 'flat',
    });
    expect(c.emailBody).toContain(XSS_ESCAPED);
    expect(c.emailBody).not.toContain('<img src=x>');
    // Subject: RFC 5322 header context, never HTML-decoded — raw.
    expect(c.subject).toContain(XSS);
    expect(c.subject).not.toContain('&lt;');
    // Push/in-app body: plain-text context — raw.
    expect(c.body).toContain(XSS);
  });

  it('escapes titles and names across the family-facing builders', () => {
    for (const c of [
      buildTaskMarkedDoneForFamily('fr', { doerFirstName: XSS, taskTitle: 'ok', taskId: 't1' }),
      buildTaskCancelledForFamily('en', { doerFirstName: XSS, taskTitle: 'ok', taskId: 't1' }),
      buildTaskAssignedGuardian('en', { childFirstName: XSS, familyName: XSS, taskTitle: 'ok', agreedPrice: 5, priceBasis: 'hourly' }),
    ]) {
      expect(c.emailBody).toContain(XSS_ESCAPED);
      expect(c.emailBody).not.toContain('<img src=x>');
    }
  });
});

describe('buildNewTaskDigest (§10 board digest)', () => {
  const tasks = [
    { taskId: 't1', title: 'Water plants', category: 'green_thumb', areaLabel: '16e', suggestedBudget: 15 },
    { taskId: 't2', title: 'Set up a NAS', category: 'it', areaLabel: 'Neuilly', suggestedBudget: null },
  ];

  it('lists every task with board-visible fields: title, category label, area, budget', () => {
    const c = buildNewTaskDigest('en', tasks);
    expect(c.subject).toBe('2 new tasks in your categories');
    expect(c.emailBody).toContain('Water plants');
    expect(c.emailBody).toContain('Green thumb');
    expect(c.emailBody).toContain('16e');
    expect(c.emailBody).toContain('suggested €15');
    expect(c.emailBody).toContain('Set up a NAS');
    expect(c.emailBody).toContain('IT help');
    expect(c.emailBody).toContain('https://sync-do-app.web.app/tasks/t1');
    expect(c.emailBody).toContain('https://sync-do-app.web.app/tasks/t2');
  });

  it('singular copy for one task, with the task named in the push body', () => {
    const c = buildNewTaskDigest('en', [tasks[0]]);
    expect(c.subject).toBe('1 new task in your categories');
    expect(c.body).toContain('Water plants');
    const fr = buildNewTaskDigest('fr', [tasks[0]]);
    expect(fr.subject).toBe('1 nouvelle tâche dans vos catégories');
    expect(fr.body).toContain('Main verte');
  });

  // The digest is the ONE recurring, batched message sync-do sends, and it
  // bypasses NotifPrefs by design — so its footer must state both why the
  // mail arrives and how to make it stop, without promising an in-app
  // control that does not exist yet (PR #334 rounds 2 and 3).
  it('footer states a REACHABLE exit in both locales, and promises no phantom control', () => {
    for (const lang of ['en', 'fr'] as const) {
      const body = buildNewTaskDigest(lang, tasks).emailBody;
      expect(body).toContain('mailto:support@sync-sit.com');
      expect(body).not.toMatch(/profile|profil/i);
    }
    expect(buildNewTaskDigest('en', tasks).emailBody).toContain('when you enrolled');
    expect(buildNewTaskDigest('fr', tasks).emailBody).toContain('lors de votre inscription');
  });

  it('escapes task titles (family free text landing in email HTML)', () => {
    const c = buildNewTaskDigest('en', [
      { taskId: 't9', title: XSS, category: 'errands', areaLabel: '15e', suggestedBudget: null },
    ]);
    expect(c.emailBody).toContain(XSS_ESCAPED);
    expect(c.emailBody).not.toContain('<img src=x>');
  });

  it('category labels cover both locales and fall back to the raw key', () => {
    expect(categoryLabel('en', 'pet_house')).toBe('Pet & house-sitting');
    expect(categoryLabel('fr', 'pet_house')).toBe("Garde d'animaux & de maison");
    expect(categoryLabel('en', 'unknown_cat')).toBe('unknown_cat');
  });
});

// A doer's `firstName` is mandatory at enrollment, so this only shows on a
// corrupted doc — but the call sites used to hardcode an English literal,
// which rendered « The student a annulé… » inside French mail (PR #334
// round-3 review).
describe('fallbackDoerName', () => {
  it('is localized in both directions', () => {
    expect(fallbackDoerName('en')).toBe('The student');
    expect(fallbackDoerName('fr')).toBe("L'étudiant(e)");
  });

  it('keeps French copy French when the name is missing', () => {
    const fr = buildTaskCancelledForFamily('fr', {
      doerFirstName: fallbackDoerName('fr'),
      taskTitle: 'Tondre la pelouse',
      taskId: 't1',
    });
    expect(fr.emailBody).not.toContain('The student');
    expect(fr.subject).not.toContain('The student');
    // Escaped in the HTML body (the #188 convention applies to the fallback
    // exactly as it does to a real name), raw in the plain-text push body.
    expect(fr.emailBody).toContain('L&#39;étudiant(e)');
    expect(fr.body).toContain("L'étudiant(e)");
  });
});

describe('the §10 endorsement trio (decision 12, PR11)', () => {
  it('escapes the submitter label and task title in the received body', () => {
    const c = buildEndorsementReceived('en', { submitterLabel: XSS, taskTitle: XSS });
    expect(c.emailBody).toContain(XSS_ESCAPED);
    expect(c.emailBody).not.toContain('<img src=x>');
    // Subject (RFC 5322) and push body (plain text) stay raw.
    expect(c.subject).toContain(XSS);
    expect(c.body).toContain(XSS);
  });

  it('names the task the endorsement came out of (what study cannot say)', () => {
    for (const lang of LANGS) {
      const c = buildEndorsementReceived(lang, {
        submitterLabel: 'Marie Dupont',
        taskTitle: 'Assemble the PAX',
      });
      expect(c.emailBody).toContain('Assemble the PAX');
      expect(c.body).toContain('Assemble the PAX');
    }
  });

  it('says the endorsement stays private until the student accepts', () => {
    expect(buildEndorsementReceived('en', { submitterLabel: 'M', taskTitle: 't' }).emailBody)
      .toMatch(/private until you accept/i);
    expect(buildEndorsementReceived('fr', { submitterLabel: 'M', taskTitle: 't' }).emailBody)
      .toMatch(/privée/i);
  });

  it('points the received CTA at the §9.2 management surface', () => {
    for (const lang of LANGS) {
      expect(
        buildEndorsementReceived(lang, { submitterLabel: 'M', taskTitle: 't' }).emailBody,
      ).toContain('https://sync-do-app.web.app/endorsements');
    }
  });

  it('escapes the doer first name in the outcome body', () => {
    for (const action of ['accept', 'decline'] as const) {
      const c = buildEndorsementOutcome('en', { action, doerFirstName: XSS });
      expect(c.emailBody).toContain(XSS_ESCAPED);
      expect(c.emailBody).not.toContain('<img src=x>');
    }
  });

  // The decline half must read as an OUTCOME, not as a rejection of the
  // family — the notifyEndorsementOutcome precedent. Pinned because the
  // obvious wording ("Léa rejected your endorsement") is the wrong one and
  // nothing else in the suite would catch it.
  it('keeps the decline copy neutral — never "rejected" / "refusé"', () => {
    for (const lang of LANGS) {
      const c = buildEndorsementOutcome(lang, { action: 'decline', doerFirstName: 'Léa' });
      const all = `${c.subject} ${c.emailBody} ${c.title} ${c.body}`.toLowerCase();
      expect(all).not.toMatch(/reject|refus|declin/);
      expect(all).toMatch(/not published|pas été publiée/);
    }
  });

  it('accept and decline copy differ, in both languages', () => {
    for (const lang of LANGS) {
      const yes = buildEndorsementOutcome(lang, { action: 'accept', doerFirstName: 'Léa' });
      const no = buildEndorsementOutcome(lang, { action: 'decline', doerFirstName: 'Léa' });
      expect(yes.emailBody).not.toBe(no.emailBody);
      expect(yes.subject).not.toBe(no.subject);
    }
  });

  // A corrupted doc with no firstName must not render "The student" inside
  // otherwise-French mail (the PR #334 round-3 fix, applied to the new copy).
  it('falls back to the LOCALIZED doer name when firstName is missing', () => {
    expect(buildEndorsementOutcome('fr', { action: 'accept', doerFirstName: null }).body)
      .toContain(fallbackDoerName('fr'));
    expect(buildEndorsementOutcome('en', { action: 'accept', doerFirstName: null }).body)
      .toContain(fallbackDoerName('en'));
  });
});
