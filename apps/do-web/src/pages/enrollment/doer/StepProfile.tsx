import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Input } from '@ejm/shared-ui';

export interface ProfileData {
  // Identity is absent when it is already on file (issue #144) — the server
  // keeps the stored, set-once values.
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  contactEmail?: string;
  contactPhone?: string;
}

/** Root identity already carried by the signed-in user's doc (cross-app).
 * PER-FIELD: any subset may be on file; only missing fields are collected —
 * in particular a cross-app sit babysitter's doc may lack a DOB, which the
 * server's §11.1 age gate makes mandatory, so this step must be able to ask
 * for exactly that one field. */
export interface IdentityOnFile {
  firstName?: string;
  lastName?: string;
  /** Firestore Timestamp on study/parent-created accounts, "YYYY-MM-DD" string on sit-created ones. */
  dateOfBirth?: unknown;
}

interface StepProfileProps {
  onNext: (data: ProfileData) => void;
  /** Previously-entered values, restored on back-navigation. */
  initial?: ProfileData | null;
  /** A submit-time server rejection carried back from the details step —
   * the field it names usually lives HERE. */
  serverError?: string | null;
  identityOnFile?: IdentityOnFile | null;
  /**
   * The §11.1 governed carve-out, client-side: a supervised account
   * (userDoc.governedBy) passes the under-15 floor at any age, so the DOB
   * input must not block it — the server re-runs the real gate anyway.
   */
  governed?: boolean;
  /**
   * Abbreviated cross-app flow (§3.3): contact is not re-collected when the
   * account already has a channel — but the callable requires at least one
   * on EVERY path (PR #320), so the orchestrator flips this back on for a
   * zero-channel cross-app account and this step collects it.
   */
  collectContact?: boolean;
}

/**
 * Display form of an on-file DOB: sit-created accounts store a "YYYY-MM-DD"
 * string, study/parent-created ones a Firestore Timestamp.
 */
function formatDob(dob: unknown): string {
  if (typeof dob === 'string') return dob;
  if (
    typeof dob === 'object' &&
    dob !== null &&
    'toDate' in dob &&
    typeof (dob as { toDate: unknown }).toDate === 'function'
  ) {
    return (dob as { toDate: () => Date }).toDate().toLocaleDateString();
  }
  return '';
}

function getAge(dateOfBirth: string): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age;
}

export function StepProfile({
  onNext,
  initial = null,
  serverError = null,
  identityOnFile = null,
  governed = false,
  collectContact = true,
}: StepProfileProps) {
  const { t } = useTranslation();
  const [firstName, setFirstName] = useState(initial?.firstName ?? '');
  const [lastName, setLastName] = useState(initial?.lastName ?? '');
  const [dateOfBirth, setDateOfBirth] = useState(initial?.dateOfBirth ?? '');
  const [contactEmail, setContactEmail] = useState(initial?.contactEmail ?? '');
  const [contactPhone, setContactPhone] = useState(initial?.contactPhone ?? '');

  // PER-FIELD on-file flags (matching sit's and study's StepProfile): a
  // partial doc collects only its missing fields.
  const hasFirstName = !!identityOnFile?.firstName;
  const hasLastName = !!identityOnFile?.lastName;
  const hasDateOfBirth = !!identityOnFile?.dateOfBirth;
  const allOnFile = hasFirstName && hasLastName && hasDateOfBirth;

  const age = getAge(dateOfBirth);
  // The client floor only applies when a DOB is being ENTERED, and stands
  // down for a governed account (§11.1's carve-out — supervision is its
  // protection). No upper bound: unlike study's 15-19 class gate, a doer's
  // EJM-cohort coherence is the server's age_mismatch half. The server
  // re-runs the whole gate regardless.
  const ageValid = age !== null && (governed || age >= 15);
  const showAgeError = dateOfBirth && !ageValid;
  // Approximate the server's contactEmail shape check (doEnrollDoer runs
  // zod's z.string().email(), PR #320 round 2) so a rejection cannot
  // strand the user on the submitting details step; both reject the
  // dot-less 'x@y' the native email input would let through.
  const emailFormatOk =
    !contactEmail.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(contactEmail.trim());
  const hasContact = !collectContact || contactEmail.trim() || contactPhone.trim();
  const identityValid = (hasFirstName || firstName)
    && (hasLastName || lastName)
    && (hasDateOfBirth || (dateOfBirth && ageValid));
  const isValid = identityValid && hasContact && emailFormatOk;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;
    onNext({
      // Omit each identity field that is on file (issue #144): the server
      // keeps the stored, set-once values.
      ...(hasFirstName ? {} : { firstName }),
      ...(hasLastName ? {} : { lastName }),
      ...(hasDateOfBirth ? {} : { dateOfBirth }),
      ...(collectContact
        ? {
            contactEmail: contactEmail.trim() || undefined,
            contactPhone: contactPhone.trim() || undefined,
          }
        : {}),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="px-6">
      <h2 className="mt-4 mb-2 text-xl font-bold">
        {t('enrollment.welcomeTitle1')}<br />{t('enrollment.welcomeTitle2')}
      </h2>
      <p className="mb-6 text-sm text-gray-500">{t('enrollment.welcomeSubtitle')}</p>

      {/* PER-FIELD rendering (matches payload/isValid): the full summary only
          when everything is on file; otherwise inputs for exactly the
          missing fields. */}
      {allOnFile && (
        <div className="mb-5 rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-700">
          <p>
            {t('enrollment.identityOnFile', {
              name: `${identityOnFile!.firstName} ${identityOnFile!.lastName}`,
            })}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {t('enrollment.dateOfBirth')}: {formatDob(identityOnFile!.dateOfBirth)}
          </p>
        </div>
      )}
      {!(hasFirstName && hasLastName) && (
        <div className="flex gap-3">
          {!hasFirstName && (
            <div className="flex-1">
              <Input
                label={t('enrollment.firstName')}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
              />
            </div>
          )}
          {!hasLastName && (
            <div className="flex-1">
              <Input
                label={t('enrollment.lastName')}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
              />
            </div>
          )}
        </div>
      )}

      {!hasDateOfBirth && (
        <div className="max-w-[50%] min-w-0">
          <Input
            label={t('enrollment.dateOfBirth')}
            type="date"
            value={dateOfBirth}
            onChange={(e) => setDateOfBirth(e.target.value)}
            error={showAgeError ? t('enrollment.ageError') : undefined}
            required
          />
        </div>
      )}

      {collectContact && (
        <>
          <hr className="my-5 border-gray-200" />

          <p className="mb-1 text-sm font-semibold text-gray-700">{t('enrollment.contactSection')}</p>
          <p className="mb-3 text-xs text-gray-500">{t('enrollment.contactHint')}</p>
          <Input
            label={t('enrollment.contactEmail')}
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            error={contactEmail.trim() && !emailFormatOk ? t('enrollment.contactEmailInvalid') : undefined}
          />
          <Input
            label={t('enrollment.contactPhone')}
            type="tel"
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
          />
        </>
      )}

      {serverError && <p className="mb-4 text-sm text-error-600">{serverError}</p>}

      <Button type="submit" disabled={!isValid}>
        {t('common.continue')}
      </Button>
    </form>
  );
}
