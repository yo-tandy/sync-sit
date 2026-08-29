import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderWithProviders, i18n } from '@/__tests__/test-utils';
import { PrivacyPage, TermsPage } from '@ejm/shared-ui';

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

/** Structure of a rendered section: bullet lines and paragraph breaks. */
function shape(text: string) {
  return {
    bullets: (text.match(/^- /gm) || []).length,
    breaks: (text.match(/\n\n/g) || []).length,
    hasSupportEmail: text.includes('{{supportEmail}}'),
    hasBrand: text.includes('{{brand}}'),
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
      expect(src).not.toMatch(/aged 15 to 18/);
      expect(src).not.toMatch(/âgés de 15 à 18 ans/);
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

describe('shared legal copy — age and consent', () => {
  it('states the real floor and carve-out, with no upper bound (privacy, EN)', async () => {
    await i18n.changeLanguage('en');
    renderWithProviders(<PrivacyPage brand="Sync/Sit" supportEmail="help@example.com" />);
    const text = bodyText();

    // The under-15 self-enrollment floor (packages/shared-core/src/utils/agePolicy.ts).
    expect(text).toContain('A student who signs up on their own must be at least 15');
    // The governed carve-out — supervision is the protection, at any age.
    expect(text).toContain('A student under 15 can take part only through a supervised account');
    // No code caps a provider at 18; the old copy asserted one.
    expect(text).toContain('We do not set an upper age limit for service providers.');
    // Guardian consent for flagged sync-do sub-categories.
    expect(text).toContain('approve that specific offer before the family sees it');
  });

  it('states the real floor and carve-out, with no upper bound (terms, EN)', async () => {
    await i18n.changeLanguage('en');
    renderWithProviders(<TermsPage brand="Sync/Do" supportEmail="help@example.com" />);
    const text = bodyText();

    expect(text).toContain('Must be at least 15 years of age to sign up on their own');
    expect(text).toContain('We do not set an upper age limit for service providers.');
  });

  it('states the real floor and carve-out (terms, FR)', async () => {
    await i18n.changeLanguage('fr');
    renderWithProviders(<TermsPage brand="Sync/Do" supportEmail="help@example.com" />);
    const text = bodyText();

    expect(text).toContain("Être âgé(e) d'au moins 15 ans pour s'inscrire de sa propre initiative");
    expect(text).toContain("Nous ne fixons aucune limite d'âge supérieure pour les prestataires.");
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
    expect(text).toContain('has no account on Sync/Do');
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
      expect(sections.length).toBeGreaterThan(0);

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
});
