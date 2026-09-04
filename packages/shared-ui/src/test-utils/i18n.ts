import i18next, { type i18n } from 'i18next';
import { initReactI18next } from 'react-i18next';

/**
 * A minimal, real i18next instance for shared-ui component tests.
 *
 * shared-ui components call `t()` against whatever the HOST app has loaded
 * (each app owns its own `en.ts`/`fr.ts`) -- there is no i18n bundle that
 * belongs to this package. Rather than mock `useTranslation` down to an
 * identity function (which would let a component reference a key no host
 * app actually defines and never notice), tests render against a small real
 * instance carrying the exact English copy this PR adds identically to all
 * three apps' `en.ts` files. That copy living here too means these tests
 * double as a spec: a key renamed in one place and not the other fails
 * loudly instead of silently rendering the raw key.
 */
export function createTestI18n(): i18n {
  const instance = i18next.createInstance();
  void instance.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    resources: {
      en: {
        translation: {
          common: {
            continue: 'Continue',
          },
          welcome: {
            alreadyHaveAccount: 'Already have an account?',
            logIn: 'Log in',
          },
          // GENDER_OPTIONS (from @ejm/shared-core, added on PR1) hardcodes
          // its labelKeys as `enrollment.genderFemale` etc. -- the SAME keys
          // sit's/study's existing per-role StepProfile already reads. This
          // component reuses that constant as-is (no reason to fork it), so
          // it needs these under `enrollment`, not `unifiedEnrollment`.
          enrollment: {
            genderFemale: 'Female',
            genderMale: 'Male',
            genderOther: 'Other',
            genderPreferNot: 'Prefer not to say',
          },
          unifiedEnrollment: {
            landingTitle: 'Join the Sync community',
            landingSubtitle:
              'One account for babysitting, tutoring, and more — across the whole EJM community.',
            comingSoon: 'Coming soon',
            basicInfoTitle: "Let's start with the basics",
            basicInfoSubtitle: "Your name, date of birth and class can't be changed later.",
            firstName: 'First name *',
            lastName: 'Last name *',
            dateOfBirth: 'Date of birth *',
            ageError: 'You must be between 15 and 18 years old',
            ageUnder15:
              'You need to be at least 15 to enroll on your own. Your parents can create an account and enroll you from theirs.',
            ageMismatch:
              "Your date of birth doesn't match your school year. Please contact the EJM administrator.",
            classLabel: 'Class *',
            selectClass: 'Select class',
            gender: 'Gender *',
            genderFemale: 'Female',
            genderMale: 'Male',
            genderOther: 'Other',
            genderPreferNot: 'Prefer not to say',
            contactInfoTitle: 'How can families reach you?',
            contactInfoSubtitle: 'Provide at least one contact method — email or phone.',
            contactEmail: 'Contact email',
            contactEmailInvalid: 'Enter a full email address (e.g. name@example.com).',
            autofillEjmEmail: 'Use my EJM email ({{email}})',
            contactPhone: 'Contact phone',
            contactRequired: 'Provide at least one contact method (email or phone).',
            whatsappLabel: 'WhatsApp',
            whatsappSameAsPhone: 'Same as my phone number',
            contactVisibilityConsent:
              "I'm aware that families who want to reach me will get access to this contact information once I'm visible in search.",
            contactVisibilityWarning:
              "Without this, you won't show up in search until contact visibility is turned on later, from your account settings.",
            additionalInfoTitle: 'A few optional extras',
            additionalInfoSubtitle:
              'All of this is optional — you can fill it in, or skip it and add it later.',
            bioLabel: 'About me (optional)',
            bioPlaceholder: 'Tell families a bit about yourself...',
            photoLabel: 'Profile photo (optional)',
            photoChoose: 'Choose photo',
            photoRemove: 'Remove',
            photoHint: 'Optional · Max 5 MB',
            photoTypeError: 'Please choose a JPEG, PNG, WebP or HEIC image.',
            photoSizeError: 'Photo must be smaller than 5 MB.',
            addressLabel: 'Address (optional)',
            addressHint: 'This helps optimize your search results — families see how far away you are.',
          },
        },
      },
    },
    interpolation: { escapeValue: false },
  });
  return instance;
}
