import { describe, it, expect } from 'vitest';
import {
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
  formatPrice,
  resolveDoLang,
  type DoLang,
} from '../notifyContent.js';

// Copy pins for the nine §10 task/offer types (plan §13 PR9): EN+FR present,
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
    for (const lang of LANGS) {
      for (const c of allContents(lang)) {
        expect(c.emailBody).not.toContain('sync-do.com');
        const hrefs = [...c.emailBody.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
        for (const href of hrefs) {
          expect(href.startsWith('https://sync-do-app.web.app')).toBe(true);
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
