import { describe, it, expect, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { renderWithProviders, i18n } from '@/__tests__/test-utils';
import { PrivacyPage, TermsPage } from '@ejm/shared-ui';
import { checkEnrollmentAge } from '@ejm/shared-core';

/**
 * The self-enrollment floor, derived from the policy that ENFORCES it rather
 * than from a constant. shared-core does export a minimum-age constant, but
 * nothing else in the repo reads it, so pinning the copy to it coupled these
 * assertions to a value no gate consults. `checkEnrollmentAge` IS the gate:
 * enrollTutor, doEnrollDoer and sit's passesAgeBackstop all route through it.
 *
 * Walk up from 0 to find the age at which its 'under_15' verdict stops firing,
 * so moving the policy moves this number and fails the copy assertions below.
 */
const SELF_ENROLL_FLOOR_AGE = (() => {
  const now = new Date('2026-06-15T12:00:00Z');
  const dobForAge = (age: number) => {
    const d = new Date(now);
    d.setUTCFullYear(d.getUTCFullYear() - age);
    d.setUTCDate(d.getUTCDate() - 1); // safely past the birthday
    return d;
  };
  for (let age = 0; age <= 30; age++) {
    // graduationYear tracks the age so the ±1-class consistency check always
    // passes; only the under-age verdict can fire here.
    const verdict = checkEnrollmentAge({
      dateOfBirth: dobForAge(age),
      graduationYear: (2026 + (18 - age)) % 100,
      now,
    });
    if (verdict !== 'under_15') return age;
  }
  throw new Error('no age below 30 clears the under-15 floor');
})();

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
      // `[^.\n]`, not `[^.]`: each bullet is its own string literal, and a
      // newline-spanning class made this pass only because of the `.` in an
      // unrelated "(@ejm.org)" bullet below. Case-insensitive on both, so a
      // capitalised sentence opener cannot slip past in either language.
      expect(src).not.toMatch(/[Bb]abysitters[^.\n]*aged 15 to 18/);
      expect(src).not.toMatch(/[Bb]abysitters[^.\n]*âgés de 15 à 18/);
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

  it('warns that a sync-do task is visible to the whole board (FR)', async () => {
    await i18n.changeLanguage('fr');
    renderWithProviders(<PrivacyPage brand="Sync/Do" supportEmail="help@example.com" />);
    expect(bodyText()).toContain('visibles par tous les élèves inscrits');
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
    // Two-way on sit and do...
    expect(text).toContain('On Sync/Sit and Sync/Do the exchange is two-way');
    expect(text).toContain(
      "the family's address and its parents' names, email, phone and WhatsApp number",
    );
    expect(text).toContain(
      "the provider's name, email, phone and WhatsApp number",
    );
    // ...but ONE-WAY on study: respondToTutorContactRequest.ts:116-128 emails
    // the tutor's channels to the family, and nothing comes back —
    // StudyContactRequestDoc carries no address or parent-contact fields and
    // firestore.rules:397 keeps families/{id} unreadable by tutors.
    expect(text).toContain('On Sync/Study it is one-way');
    expect(text).toContain('no address, and no parent contact details');
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

    expect(text).toContain('staying available while the task is assigned and after it is completed');
    expect(text).not.toContain('stops being available once the engagement is over');
  });

  it('states the real bound on the contact reveal (FR)', async () => {
    await i18n.changeLanguage('fr');
    renderWithProviders(<PrivacyPage brand="Sync/Do" supportEmail="help@example.com" />);
    const text = bodyText();

    expect(text).toContain(
      'elles restent accessibles pendant que la mission est attribuée et après son achèvement',
    );
    expect(text).not.toContain("cesse d'être disponible une fois l'intervention terminée");
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

  it('scopes the booking-note rule per app, and lists pending requests as unbounded (FR)', async () => {
    await i18n.changeLanguage('fr');
    renderWithProviders(<PrivacyPage brand="Sync/Study" supportEmail="help@example.com" />);
    const text = bodyText();

    expect(text).toContain(
      "Sur Sync/Study, les notes de séance font partie de l'enregistrement de la séance",
    );
    expect(text).toContain("une demande de garde en attente ainsi que toute note qui s'y rapporte");
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

  it('does not claim photos are unreachable by URL (FR)', async () => {
    await i18n.changeLanguage('fr');
    renderWithProviders(<PrivacyPage brand="Sync/Do" supportEmail="help@example.com" />);
    const text = bodyText();

    expect(text).toContain("Elles ne reçoivent jamais d'adresse publique permanente");
    expect(text).toContain('liens de courte durée, valables quinze minutes');
    expect(text).not.toContain("ne sont jamais servies par une URL publique");
  });

  it('names the published-search audience in §5, per app (EN)', async () => {
    // firestore.rules:762-777 makes `publishedSearches` readable by ANY active,
    // fully-enrolled provider of the matching app — the rule comment is explicit
    // that this deliberately includes providers otherwise hidden from results
    // (it is not gated on `profiles.*.searchable`). A sit search carries
    // `kidAges`, `numberOfKids`, `offeredRate` and family-authored
    // `additionalInfo` (packages/shared-core/src/types/publishedSearch.ts:26-55).
    // §5 enumerated the do-board audience in detail and said nothing about this
    // one; neither the "Other users" bullet (scoped to PROFILE information) nor
    // the do-board bullet reaches it.
    await i18n.changeLanguage('en');
    renderWithProviders(<PrivacyPage brand="Sync/Sit" supportEmail="help@example.com" />);
    const text = bodyText();

    expect(text).toContain('Verified service providers, when your family publishes a request');
    expect(text).toContain('every active, fully enrolled provider');
    expect(text).toContain('including one who has chosen not to appear in search results');
    // The per-app field lists differ — PublishedStudySearch carries no kid data.
    expect(text).toContain('the number of children and their ages');
    expect(text).toContain('On Sync/Study it carries your family name, an area label, the subject');
    expect(text).toContain('Neither carries your address, and neither names a child');
  });

  it('names the published-search audience in §5, per app (FR)', async () => {
    await i18n.changeLanguage('fr');
    renderWithProviders(<PrivacyPage brand="Sync/Sit" supportEmail="help@example.com" />);
    const text = bodyText();

    expect(text).toContain('Les prestataires vérifiés, lorsque votre famille publie une demande');
    expect(text).toContain('tous les prestataires actifs et pleinement inscrits');
    expect(text).toContain("le nombre d'enfants et leur âge");
    expect(text).toContain("Ni l'une ni l'autre ne comporte votre adresse");
  });

  it('does not claim a distance is shown on the Sync/Do board (EN + FR)', async () => {
    // `TaskDoc` carries `areaLabel` and nothing else location-shaped
    // (packages/do-core/src/types/task.ts:21-31), and no distance is computed
    // anywhere in apps/do-web/src. The distance exists in sit's search results
    // (apps/web/src/pages/family/SearchPage.tsx:729-730), so the claim has to
    // be scoped to that surface rather than made suite-wide.
    await i18n.changeLanguage('en');
    renderWithProviders(<PrivacyPage brand="Sync/Do" supportEmail="help@example.com" />);
    let text = bodyText();
    expect(text).toContain('and — in search results only — an approximate distance');
    expect(text).toContain('an approximate distance in search results');
    expect(text).not.toContain('commune, plus an approximate distance');
    expect(text).not.toContain('only an area label and an approximate distance are');

    // Two renders in one test — see the helper-retention test below for why the
    // cleanup() is load-bearing on the negative assertions.
    cleanup();
    await i18n.changeLanguage('fr');
    renderWithProviders(<PrivacyPage brand="Sync/Do" supportEmail="help@example.com" />);
    text = bodyText();
    expect(text).toContain(
      'dans les résultats de recherche uniquement, une distance approximative',
    );
    expect(text).not.toContain('(arrondissement ou commune) et une distance approximative');
    expect(text).not.toContain(
      'seuls un libellé de secteur et une distance approximative le sont',
    );
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
      `A student who signs up on their own must be at least ${SELF_ENROLL_FLOOR_AGE}`,
    );
    // The governed carve-out — supervision is the protection, at any age.
    expect(text).toContain(
      `A student under ${SELF_ENROLL_FLOOR_AGE} can take part only through a supervised account`,
    );
    // The ceiling is enforced on ALL THREE apps, not absent on Sync/Do: PR
    // #412 review round 7 caught this exact defect class in its own copy —
    // `enrollDoer.ts:409-425` runs `checkEnrollmentAge` and throws
    // `age_mismatch` for an ungoverned caller with a parseable graduation
    // year, waivable via `enrollmentExemptions`, the same rule enrollTutor
    // applies. study-web StepProfile.tsx:79 and web StepProfile.tsx:48 both
    // gate `age >= 15 && age < 19` client-side; sit and do differ only in
    // WHICH SIDE enforces it and what refusal looks like.
    expect(text).toContain('All three apps require a provider');
    expect(text).toContain('consistent with their EJM school year');
    // enrollBabysitter.ts runs NO age check; ageBackstop.ts:6-8 calls itself
    // "the ONLY operative age gate on the provider side" and filters at search
    // and contact time, so sit enrolls the student and then hides them.
    expect(text).toContain('Sync/Study and Sync/Do both refuse the enrollment outright');
    expect(text).toContain('Sync/Sit accepts the enrollment and instead stops showing that provider to families');
    // passesAgeBackstop returns true when no DOB is stored (ageBackstop.ts:46).
    expect(text).toContain('skipped where we hold no date of birth');
    expect(text).not.toContain('There is no single upper age limit');
    expect(text).not.toContain('On Sync/Do there is no upper limit');
    expect(text).not.toContain('We do not set an upper age limit');
    expect(text).not.toContain('refuses a date of birth outside that window');
    // Guardian consent for flagged sync-do sub-categories.
    expect(text).toContain('approve that specific offer before the family sees it');
  });

  it('states the real floor and carve-out, with no upper bound (privacy, FR)', async () => {
    // The Terms §3 equivalent was already pinned in FR; Privacy §9 was not, so
    // the per-app ceiling, the two enforcement styles and the missing-DOB skip
    // could drift in French without failing anything. `shape()` does not
    // backstop it: none of these is a bullet, a paragraph break or a digit.
    await i18n.changeLanguage('fr');
    renderWithProviders(<PrivacyPage brand="Sync/Sit" supportEmail="help@example.com" />);
    const text = bodyText();

    expect(text).toContain(
      `Un élève qui s'inscrit de sa propre initiative doit avoir au moins ${SELF_ENROLL_FLOOR_AGE} ans`,
    );
    expect(text).toContain(
      `Un élève de moins de ${SELF_ENROLL_FLOOR_AGE} ans ne peut participer que par l'intermédiaire d'un compte supervisé`,
    );
    expect(text).toContain('Les trois applications exigent que la date de naissance');
    expect(text).toContain("reste cohérente avec son année scolaire à l'EJM");
    expect(text).toContain('Sync/Study et Sync/Do refusent tous deux purement et simplement l');
    expect(text).toContain('Sync/Sit l');
    expect(text).toContain('cesse de présenter ce prestataire aux familles');
    expect(text).toContain("écartée lorsque nous ne disposons d'aucune date de naissance");
    expect(text).not.toContain("Il n'existe pas de limite d'âge supérieure unique");
    expect(text).not.toContain("Sur Sync/Do, il n'existe aucune limite supérieure");
    expect(text).not.toContain("Nous ne fixons aucune limite d'âge supérieure");
  });

  it('states the real floor and carve-out, with no upper bound (terms, EN)', async () => {
    await i18n.changeLanguage('en');
    renderWithProviders(<TermsPage brand="Sync/Do" supportEmail="help@example.com" />);
    const text = bodyText();

    expect(text).toContain(
      `Must be at least ${SELF_ENROLL_FLOOR_AGE} years of age to sign up on their own`,
    );
    // §3 is the OPERATIVE eligibility list, so the per-app ceiling has to be a
    // bullet here — a 19-year-old terminale repeater with a valid @ejm.org
    // address reads this list, and enrollment will refuse them.
    expect(text).toContain(
      'Must have a date of birth that stays consistent with their EJM school year',
    );
    expect(text).toContain('Sync/Study and Sync/Do both refuse the enrollment outright');
    expect(text).toContain('stops showing the provider to families instead');
    expect(text).not.toContain('Sync/Do sets no upper age limit');
    expect(text).not.toContain('We do not set an upper age limit');
    expect(text).not.toContain('aged 15 to 18 at enrollment');
  });

  it('does not require an @ejm.org address unconditionally (EN + FR)', async () => {
    // §3's own preceding bullet carves out a pre-approved address, and
    // `verifyEjmEmail.ts:36-47` skips `validateEjmEmail` entirely when
    // `preapprovedEmails/{email}` exists unused — so an unconditional
    // "must have a valid @ejm.org address" disqualified the very reader the
    // line above had just qualified. Privacy §14 said the same thing
    // descriptively; both are scoped now, and they must not disagree.
    await i18n.changeLanguage('en');
    renderWithProviders(<TermsPage brand="Sync/Sit" supportEmail="help@example.com" />);
    let text = bodyText();
    expect(text).toContain('unless we have pre-approved a different address');
    expect(text).not.toContain('Must have a valid EJM school email address (@ejm.org) and verify');

    cleanup();
    renderWithProviders(<PrivacyPage brand="Sync/Sit" supportEmail="help@example.com" />);
    text = bodyText();
    expect(text).toContain('or through an address we have pre-approved');

    cleanup();
    await i18n.changeLanguage('fr');
    renderWithProviders(<TermsPage brand="Sync/Sit" supportEmail="help@example.com" />);
    text = bodyText();
    expect(text).toContain("sauf si nous avons approuvé au préalable une autre adresse");
    expect(text).not.toContain("Disposer d'une adresse e-mail scolaire EJM valide");

    cleanup();
    renderWithProviders(<PrivacyPage brand="Sync/Sit" supportEmail="help@example.com" />);
    text = bodyText();
    expect(text).toContain('ou par une adresse que nous avons approuvée au préalable');
  });

  it('states the real floor and carve-out (terms, FR)', async () => {
    await i18n.changeLanguage('fr');
    renderWithProviders(<TermsPage brand="Sync/Do" supportEmail="help@example.com" />);
    const text = bodyText();

    expect(text).toContain(
      `Être âgé(e) d'au moins ${SELF_ENROLL_FLOOR_AGE} ans pour s'inscrire de sa propre initiative`,
    );
    expect(text).toContain("reste cohérente avec son année scolaire à l'EJM");
    expect(text).toContain('Sync/Study et Sync/Do refusent tous deux purement et simplement l');
    expect(text).not.toContain("Sync/Do ne fixe aucune limite d'âge supérieure");
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

  it('pins the helper retention figures, which are written as words (EN + FR)', async () => {
    // `shape().numbers` is a digit multiset and these quantities are word-form,
    // so the parity guard is blind to them: an FR drift from "six mois" to
    // "trois mois" changes no digit, no bullet count and no paragraph break.
    // §10 is where it matters most — the helper has no account and no in-app
    // rights tool, so the retention bound is the only guarantee they get, and
    // it is word-form in both languages. Same for §5's seven-day
    // post-cancellation contact window (DO_CONTACT_GRACE_DAYS).
    await i18n.changeLanguage('en');
    renderWithProviders(<PrivacyPage brand="Sync/Do" supportEmail="help@example.com" />);
    let text = bodyText();
    expect(text).toContain('six months after the task is completed, or thirty days after it is cancelled');
    expect(text).toContain('for seven days after a cancellation');

    // Two renders in one test — cleanup() so the FR assertions do not read the
    // EN DOM still mounted (cf. the helper-retention test above).
    cleanup();
    await i18n.changeLanguage('fr');
    renderWithProviders(<PrivacyPage brand="Sync/Do" supportEmail="help@example.com" />);
    text = bodyText();
    expect(text).toContain(
      "six mois après l'achèvement de la mission, ou trente jours après son annulation",
    );
    expect(text).toContain('pendant sept jours après une annulation');
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
