import { describe, it, expect, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { renderWithProviders, i18n } from '@/__tests__/test-utils';
import { PrivacyPage, TermsPage } from '@ejm/shared-ui';
import { MIN_BABYSITTER_AGE } from '@ejm/shared-core';

/**
 * The shared legal copy (issue #308). Both pages are rendered by ALL THREE
 * apps with only {{brand}} / {{supportEmail}} interpolated, so the copy has to
 * be true of the suite rather than of babysitting alone — that was the defect:
 * sync-study and sync-do served "student babysitters", "aged 15 to 18" and a
 * §8 liability clause that named only babysitting.
 *
 * Two layers here, deliberately:
 *
 *  1. RENDERED assertions — the load-bearing claims a counsel review would
 *     look for, pinned in BOTH locales so a future edit cannot quietly fix
 *     one language and leave the other saying something different.
 *  2. A SOURCE-LEVEL parity check over the `Section[]` arrays. PR #59's design
 *     (docs/shared-modules-roadmap.md §B) keeps the copy as inline EN/FR field
 *     pairs rather than i18n keys, so there is no i18n-parity test covering
 *     it. This is that guard: equal section counts, sequential numbering that
 *     agrees across locales, and matching bullet/paragraph structure per
 *     section. It is what makes "EN and FR both" mechanically checkable.
 */

const PAGES = {
  PrivacyPage: '../../../../../packages/shared-ui/src/pages/PrivacyPage.tsx',
  TermsPage: '../../../../../packages/shared-ui/src/pages/TermsPage.tsx',
} as const;

function sourceOf(page: keyof typeof PAGES): string {
  return readFileSync(new URL(PAGES[page], import.meta.url), 'utf8');
}

interface ParsedSection {
  titleEn: string;
  titleFr: string;
  en: string;
  fr: string;
}

/**
 * Resolve a run of concatenated single-quoted literals back into the string the
 * page actually renders. The copy is written as `'line one\n' + '- bullet\n'`,
 * so counting `\n- ` in the RAW source finds nothing — each bullet opens its
 * own literal. Joining first is what makes the structural comparison real; an
 * earlier version of this guard skipped it and passed against a deleted bullet.
 */
function joinLiterals(chunk: string): string {
  // Only single-quoted literals are recognised. A future edit reaching for a
  // double-quoted or template literal would be silently skipped, truncating
  // that section on both sides and weakening every comparison below without
  // failing anything — so refuse to parse instead of quietly under-reporting.
  const body = chunk.slice(chunk.indexOf(':') + 1);
  const withoutSingles = body.replace(/'(?:[^'\\]|\\.)*'/g, '');
  expect({ unsupportedLiteral: /["`]/.test(withoutSingles) }).toEqual({
    unsupportedLiteral: false,
  });

  return [...chunk.matchAll(/'((?:[^'\\]|\\.)*)'/g)]
    .map((m) => m[1])
    .join('')
    .replace(/\\n/g, '\n')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\');
}

/** Parse the page's `Section[]` array into resolved EN/FR pairs. */
function sectionsOf(page: keyof typeof PAGES): ParsedSection[] {
  const src = sourceOf(page);
  const start = src.indexOf('const sections: Section[] = [');
  const end = src.indexOf('\n];', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  return src
    .slice(start, end)
    .split('\n  {\n')
    .slice(1)
    .map((block) => {
      const iEn = block.indexOf('contentEn:');
      const iFr = block.indexOf('contentFr:');
      expect(iEn).toBeGreaterThan(-1);
      expect(iFr).toBeGreaterThan(iEn);
      return {
        titleEn: joinLiterals(block.slice(block.indexOf('titleEn:'), block.indexOf('titleFr:'))),
        titleFr: joinLiterals(block.slice(block.indexOf('titleFr:'), iEn)),
        en: joinLiterals(block.slice(iEn, iFr)),
        fr: joinLiterals(block.slice(iFr)),
      };
    });
}

/**
 * Structure of a rendered section: bullet lines, paragraph breaks, placeholders
 * — and every number it contains.
 *
 * The numbers are the point. Skeleton parity alone passes a section that says
 * "retained for 6 months" in English and "conservées pendant 3 mois" in French,
 * which is the divergence bilingual legal copy actually suffers from. Every
 * digit run in this copy is a legal quantity — the age floor, the retention
 * windows, the GDPR article numbers, the section cross-references — and none of
 * them may differ between locales. Compared as a sorted multiset, so a repeated
 * figure dropped from one language still fails.
 */
function shape(text: string) {
  return {
    bullets: (text.match(/^- /gm) || []).length,
    breaks: (text.match(/\n\n/g) || []).length,
    hasSupportEmail: text.includes('{{supportEmail}}'),
    hasBrand: text.includes('{{brand}}'),
    numbers: (text.match(/\d+/g) || []).sort(),
  };
}

/** Whole-document text, newlines collapsed so assertions can span wrapped copy. */
function bodyText(): string {
  return (document.body.textContent ?? '').replace(/\s+/g, ' ');
}

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('shared legal copy — service description (issue #308)', () => {
  it('describes the three Sync services, not babysitting alone (EN)', async () => {
    await i18n.changeLanguage('en');
    renderWithProviders(<PrivacyPage brand="Sync/Study" supportEmail="help@example.com" />);
    const text = bodyText();

    expect(text).toContain('Sync/Sit — babysitting');
    expect(text).toContain('Sync/Study — tutoring');
    expect(text).toContain('Sync/Do — help with everyday tasks');
    // The seven sync-do categories, from packages/do-core/src/constants/categories.ts.
    for (const category of [
      'gardening and plant care',
      'packing, moving and clearing boxes',
      'flat-pack furniture assembly',
      'help at parties',
      'IT and device help',
      'errands',
      'pet care and house checks',
    ]) {
      expect(text).toContain(category);
    }
    // Decision 13: overnight house-sitting was cut from the taxonomy.
    expect(text).toContain('no overnight stays');
  });

  it('describes the three Sync services, not babysitting alone (FR)', async () => {
    await i18n.changeLanguage('fr');
    renderWithProviders(<PrivacyPage brand="Sync/Study" supportEmail="help@example.com" />);
    const text = bodyText();

    expect(text).toContain("Sync/Sit — garde d'enfants");
    expect(text).toContain('Sync/Study — soutien scolaire');
    expect(text).toContain('Sync/Do — coups de main du quotidien');
    expect(text).toContain('sans hébergement de nuit');
  });

  it('never calls the provider a babysitter in the generic copy', () => {
    for (const page of ['PrivacyPage', 'TermsPage'] as const) {
      const src = sourceOf(page);
      // "babysitter(s)" survives only where it names the sit ROLE alongside its
      // siblings, or the sit SERVICE. It must never stand in for the provider.
      expect(src).not.toContain('student babysitters');
      expect(src).not.toContain('élèves babysitters');
      // The defect was "babysitters ... aged 15 to 18" as the description of
      // every provider on every app. The bare age range is legitimate where it
      // describes sit's and study's actual enrollment window (Terms §3), so
      // this pins the combination rather than the phrase.
      expect(src).not.toMatch(/[Bb]abysitters[^.]*aged 15 to 18/);
      expect(src).not.toMatch(/babysitters[^.]*âgés de 15 à 18/);
    }
  });
});

describe('shared legal copy — personal data categories', () => {
  it('names the request/task content the sit-era list never mentioned (EN)', async () => {
    await i18n.changeLanguage('en');
    renderWithProviders(<PrivacyPage brand="Sync/Do" supportEmail="help@example.com" />);
    const text = bodyText();

    expect(text).toContain('Request and task content');
    expect(text).toContain('photos a family uploads');
    expect(text).toContain('free-text message a service provider sends with an offer');
    // Photos are re-encoded server-side (apps/functions/src/do/stripTaskPhoto.ts).
    expect(text).toContain('EXIF location data');
    // Tutoring-shaped provider data, not just "babysitter availability".
    expect(text).toContain('subjects and levels taught');
    expect(text).toContain('Notes:');
  });

  it('names the request/task content the sit-era list never mentioned (FR)', async () => {
    await i18n.changeLanguage('fr');
    renderWithProviders(<PrivacyPage brand="Sync/Do" supportEmail="help@example.com" />);
    const text = bodyText();

    expect(text).toContain('Contenu des demandes et des missions');
    expect(text).toContain('données de géolocalisation EXIF');
    expect(text).toContain('matières et niveaux enseignés');
  });

  it('warns that a sync-do task is visible to the whole board, not one student', async () => {
    await i18n.changeLanguage('en');
    renderWithProviders(<PrivacyPage brand="Sync/Do" supportEmail="help@example.com" />);
    expect(bodyText()).toContain('visible to every enrolled student');
  });
});

describe('shared legal copy — the address, and who it reaches (PR #412 review)', () => {
  // The first draft of this rewrite claimed the address is "never shown to
  // other users". It is: doGetAssignedContact serves it to the assigned doer
  // post-acceptance, and sit's own accept dialog tells the family so
  // (apps/web/src/i18n/en.ts:560). These pin the scoped claim so the absolute
  // form cannot come back.
  it('scopes the withholding to the pre-acceptance surfaces (EN)', async () => {
    await i18n.changeLanguage('en');
    renderWithProviders(<PrivacyPage brand="Sync/Do" supportEmail="help@example.com" />);
    const text = bodyText();

    expect(text).toContain('your address is not shown in search results');
    expect(text).toContain('shared with a service provider only once you accept them');
    expect(text).not.toContain('address is never shown to other users');
  });

  it('scopes the withholding to the pre-acceptance surfaces (FR)', async () => {
    await i18n.changeLanguage('fr');
    renderWithProviders(<PrivacyPage brand="Sync/Do" supportEmail="help@example.com" />);
    const text = bodyText();

    expect(text).toContain("votre adresse n'apparaît ni dans les résultats de recherche");
    expect(text).not.toContain("votre adresse n'est jamais affichée aux autres utilisateurs");
  });

  it('lists the counterparty as a recipient, with the per-app storage difference', async () => {
    await i18n.changeLanguage('en');
    renderWithProviders(<PrivacyPage brand="Sync/Sit" supportEmail="help@example.com" />);
    const text = bodyText();

    expect(text).toContain('The other party to an engagement you accept');
    // Both halves of the two-way reveal.
    expect(text).toContain(
      "the family's address and its parents' names, email, phone and WhatsApp number",
    );
    expect(text).toContain(
      "the service provider's name, email, phone and WhatsApp number",
    );
    // Decision 16 holds for sync-do only — sit's appointment doc really does
    // carry `address` (packages/sit-core/src/types/appointment.ts:78), so the
    // "served live, never stored" claim must not be stated suite-wide.
    expect(text).toContain('never stored on the offer');
    expect(text).toContain('recorded on the appointment itself');
  });

  it('states the real bound on the contact reveal, not "once the engagement is over"', async () => {
    // getAssignedContact.ts:104 admits `assigned` OR `completed`; only the
    // cancelled branch is time-bounded (DO_CONTACT_GRACE_DAYS = 7). The reveal
    // therefore keeps working on a completed task until the 180-day sweep.
    await i18n.changeLanguage('en');
    renderWithProviders(<PrivacyPage brand="Sync/Do" supportEmail="help@example.com" />);
    const text = bodyText();

    expect(text).toContain('stays available while the task is assigned and after it is completed');
    expect(text).not.toContain('stops being available once the engagement is over');
  });

  it('scopes the booking-note rule per app, and lists pending requests as unbounded', async () => {
    // The "left every screen" rule is sit's note redaction. Study's session
    // notes are fields on the session and leave only with it; a PENDING sit
    // appointment is never redacted at all (cleanupOldData:529-534).
    await i18n.changeLanguage('en');
    renderWithProviders(<PrivacyPage brand="Sync/Study" supportEmail="help@example.com" />);
    const text = bodyText();

    expect(text).toContain('On Sync/Study, session notes are part of the session record');
    expect(text).toContain('a pending babysitting request and any note written on it');
  });

  it('does not claim photos are unreachable by URL, only that the links are short-lived', async () => {
    // getTaskPhotoUrl.ts:15 issues 15-minute signed URLs, which are
    // unauthenticated for their TTL — "never served by a public URL" overstated it.
    await i18n.changeLanguage('en');
    renderWithProviders(<PrivacyPage brand="Sync/Do" supportEmail="help@example.com" />);
    const text = bodyText();

    expect(text).toContain('never given a permanent public address');
    expect(text).toContain('short-lived links, valid for fifteen minutes');
    expect(text).not.toContain('never served by a public URL');
  });

  it('does not overstate the helper retention bound (EN + FR)', async () => {
    await i18n.changeLanguage('en');
    renderWithProviders(<PrivacyPage brand="Sync/Do" supportEmail="help@example.com" />);
    let text = bodyText();
    // sweepTasks.ts:67-75 KNOWN RETENTION GAP: an assigned task abandoned by
    // both sides is swept by nothing, so "at the latest 6 months" was false.
    expect(text).not.toContain('at the latest');
    expect(text).toContain('If a task is assigned but neither side ever closes it');

    // Two renders in one test: without this, bodyText() below spans BOTH the
    // EN and FR DOM and the negative assertions would pass on the EN copy
    // still mounted. The global afterEach(cleanup) only covers bleed BETWEEN
    // tests (cf. CoParentSettings.test.tsx:119,156).
    cleanup();
    await i18n.changeLanguage('fr');
    renderWithProviders(<PrivacyPage brand="Sync/Do" supportEmail="help@example.com" />);
    text = bodyText();
    expect(text).not.toContain('au plus tard');
    expect(text).toContain("ni l'une ni l'autre des parties ne la clôture");
  });
});

describe('shared legal copy — age and consent', () => {
  it('states the real floor and carve-out, with no upper bound (privacy, EN)', async () => {
    await i18n.changeLanguage('en');
    renderWithProviders(<PrivacyPage brand="Sync/Sit" supportEmail="help@example.com" />);
    const text = bodyText();

    // The self-enrollment floor, pinned against the constant rather than the
    // prose: this must fail when the age policy moves, not when the sentence
    // is reworded.
    expect(text).toContain(
      `A student who signs up on their own must be at least ${MIN_BABYSITTER_AGE}`,
    );
    // The governed carve-out — supervision is the protection, at any age.
    expect(text).toContain(
      `A student under ${MIN_BABYSITTER_AGE} can take part only through a supervised account`,
    );
    // The upper bound is a PER-APP difference, not the absence the first draft
    // claimed: study-web StepProfile.tsx:79 and web StepProfile.tsx:48 both
    // gate `age >= 15 && age < 19`, and checkEnrollmentAge returns
    // 'age_mismatch' outside ±1 school year (waivable via enrollmentExemptions).
    // Only do-web (`governed || age >= 15`) has no ceiling.
    expect(text).toContain('There is no single upper age limit, because the apps differ');
    expect(text).toContain('consistent with their EJM school year');
    expect(text).toContain('an administrator can grant an exemption');
    expect(text).toContain('On Sync/Do there is no upper limit');
    expect(text).not.toContain('We do not set an upper age limit');
    // Guardian consent for flagged sync-do sub-categories.
    expect(text).toContain('approve that specific offer before the family sees it');
  });

  it('states the real floor and carve-out, with no upper bound (terms, EN)', async () => {
    await i18n.changeLanguage('en');
    renderWithProviders(<TermsPage brand="Sync/Do" supportEmail="help@example.com" />);
    const text = bodyText();

    expect(text).toContain(
      `Must be at least ${MIN_BABYSITTER_AGE} years of age to sign up on their own`,
    );
    // §3 is the OPERATIVE eligibility list, so the per-app ceiling has to be a
    // bullet here — a 19-year-old terminale repeater with a valid @ejm.org
    // address reads this list, and enrollment will refuse them.
    expect(text).toContain(
      'On Sync/Sit and Sync/Study, must have a date of birth consistent with their EJM school year',
    );
    expect(text).toContain('aged 15 to 18 at enrollment');
    expect(text).toContain('Sync/Do sets no upper age limit');
    expect(text).not.toContain('We do not set an upper age limit');
  });

  it('states the real floor and carve-out (terms, FR)', async () => {
    await i18n.changeLanguage('fr');
    renderWithProviders(<TermsPage brand="Sync/Do" supportEmail="help@example.com" />);
    const text = bodyText();

    expect(text).toContain(
      `Être âgé(e) d'au moins ${MIN_BABYSITTER_AGE} ans pour s'inscrire de sa propre initiative`,
    );
    expect(text).toContain("cohérente avec son année scolaire à l'EJM");
    expect(text).toContain("Sync/Do ne fixe aucune limite d'âge supérieure");
    expect(text).not.toContain("Nous ne fixons aucune limite d'âge supérieure");
  });
});

describe('shared legal copy — the +1 helper (sync-do §11.3)', () => {
  it('gives the helper a section of their own in the privacy policy (EN)', async () => {
    await i18n.changeLanguage('en');
    renderWithProviders(<PrivacyPage brand="Sync/Do" supportEmail="help@example.com" />);
    const text = bodyText();

    expect(text).toContain('10. People Named by Others');
    expect(text).toContain('first name, last name and age');
    // The helper has no account, so no in-app rights tool reaches them.
    expect(text).toContain('has no Sync account');
    // §11.3: recorded on the OFFER, never copied onto the task.
    expect(text).toContain('stored on the offer only');
    expect(text).toContain('never appear on the task board');
    // The one route they do have.
    expect(text).toContain('If you have been named as a helper');
  });

  it('gives the helper a section of their own in the privacy policy (FR)', async () => {
    await i18n.changeLanguage('fr');
    renderWithProviders(<PrivacyPage brand="Sync/Do" supportEmail="help@example.com" />);
    const text = bodyText();

    expect(text).toContain('10. Personnes désignées par des tiers');
    expect(text).toContain('prénom, nom et âge');
    expect(text).toContain('uniquement sur la proposition');
  });

  it('binds the student who declares one, in the terms', async () => {
    await i18n.changeLanguage('en');
    renderWithProviders(<TermsPage brand="Sync/Do" supportEmail="help@example.com" />);
    const text = bodyText();

    expect(text).toContain("only with the helper's knowledge");
    expect(text).toContain('remain personally responsible for the task');
    expect(text).toContain('is not a verified Sync member');
  });
});

describe('shared legal copy — §8 liability (plan §11.5, decision 15)', () => {
  it('states the handshake-only stance across all three services (EN)', async () => {
    await i18n.changeLanguage('en');
    renderWithProviders(<TermsPage brand="Sync/Study" supportEmail="help@example.com" />);
    const text = bodyText();

    expect(text).toContain('performs the introduction, and nothing else');
    expect(text).toContain('the babysitting, the tutoring, the task, the payment');
    // Insurance sits on the family side.
    expect(text).toContain("Insurance is the family's responsibility.");
    // No dispute surface, deliberately (§11.5: building one would imply a duty).
    expect(text).toContain('Provides no damage-claim process, dispute queue, or mediation service');
    // The harm the sit-only wording never covered: property, animals, homes.
    expect(text).toContain('a child, an animal, a home, or any property');
    // The floor French law does not let us contract away.
    expect(text).toContain('death or personal injury caused by negligence');
  });

  it('states the handshake-only stance across all three services (FR)', async () => {
    await i18n.changeLanguage('fr');
    renderWithProviders(<TermsPage brand="Sync/Study" supportEmail="help@example.com" />);
    const text = bodyText();

    expect(text).toContain('assure la mise en relation, et rien d');
    expect(text).toContain("L'assurance incombe à la famille.");
    expect(text).toContain('ne tranche pas entre utilisateurs');
  });

  it('interpolates the brand into the liability clause rather than hard-coding one', async () => {
    await i18n.changeLanguage('en');
    renderWithProviders(<TermsPage brand="Sync/Do" supportEmail="help@example.com" />);
    const text = bodyText();
    expect(text).toContain('Sync/Do performs the introduction');
    expect(text).not.toContain('{{brand}}');
  });
});

describe('shared legal copy — EN/FR parity mechanism (PR #59 design)', () => {
  it.each(['PrivacyPage', 'TermsPage'] as const)(
    '%s: every section carries all four locale fields, numbered in step',
    (page) => {
      const sections = sectionsOf(page);
      // Pin the COUNT, not just "> 0". The copy is dense with "see section N"
      // cross-references and §10 was inserted mid-document, so a section
      // deleted from both locales would otherwise leave every other
      // assertion green while silently breaking those references.
      expect({ page, count: sections.length }).toEqual({
        page,
        count: page === 'PrivacyPage' ? 16 : 17,
      });

      sections.forEach((section, i) => {
        const n = String(i + 1);
        expect({ n, en: section.titleEn.startsWith(`${n}. `) }).toEqual({ n, en: true });
        expect({ n, fr: section.titleFr.startsWith(`${n}. `) }).toEqual({ n, fr: true });
        expect(section.en.length).toBeGreaterThan(0);
        expect(section.fr.length).toBeGreaterThan(0);
      });
    },
  );

  it.each(['PrivacyPage', 'TermsPage'] as const)(
    '%s: every "see section N" cross-reference points at a section that exists',
    (page) => {
      // This PR inserted Privacy §10 and shifted §10–15 to §11–16 while
      // threading cross-references through the copy, so a future insert is
      // exactly the edit that silently breaks them.
      const sections = sectionsOf(page);
      const dangling: string[] = [];

      sections.forEach((section, i) => {
        for (const [locale, body] of [
          ['en', section.en],
          ['fr', section.fr],
        ] as const) {
          for (const m of body.matchAll(/section (\d+)/gi)) {
            const target = Number(m[1]);
            if (target < 1 || target > sections.length) {
              dangling.push(`§${i + 1} (${locale}) → section ${target}`);
            }
          }
        }
      });

      expect(dangling).toEqual([]);
    },
  );

  it.each(['PrivacyPage', 'TermsPage'] as const)(
    '%s: EN and FR bodies share bullet, paragraph and placeholder structure',
    (page) => {
      sectionsOf(page).forEach((section, i) => {
        expect({ section: i + 1, ...shape(section.en) }).toEqual({
          section: i + 1,
          ...shape(section.fr),
        });
      });
    },
  );

  it.each(['PrivacyPage', 'TermsPage'] as const)(
    '%s: the parity guard resolves concatenated literals, so a dropped bullet fails it',
    (page) => {
      // Guards the guard: mutate one locale of one section and prove the
      // comparison notices. Without joinLiterals() this passed against a
      // deleted line, because `\n- ` never appears in the raw source.
      const bulleted = sectionsOf(page).find((s) => shape(s.fr).bullets > 0);
      expect(bulleted).toBeDefined();
      const mutated = bulleted!.fr.replace(/^- .*\n/m, '');
      expect(mutated).not.toBe(bulleted!.fr);
      expect(shape(mutated)).not.toEqual(shape(bulleted!.en));
    },
  );

  it.each(['PrivacyPage', 'TermsPage'] as const)(
    '%s: a legal quantity that disagrees across locales fails the guard',
    (page) => {
      // The divergence skeleton parity cannot see: "retained for 6 months" vs
      // "conservées pendant 3 mois" is structurally identical. Mutate a real
      // figure in one locale and prove the numbers comparison catches it.
      const numbered = sectionsOf(page).find((s) => shape(s.fr).numbers.length > 0);
      expect(numbered).toBeDefined();
      const mutated = numbered!.fr.replace(/\d+/, (d) => String(Number(d) + 1));
      expect(mutated).not.toBe(numbered!.fr);
      expect(shape(mutated).numbers).not.toEqual(shape(numbered!.en).numbers);
    },
  );
});
