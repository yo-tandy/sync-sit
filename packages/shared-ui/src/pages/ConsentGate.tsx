import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/Button.js';
import { Checkbox } from '../components/Checkbox.js';
import { callableErrorCode } from '../utils/callableErrors.js';

/**
 * The re-consent gate (issue #488 decision 1): what a signed-in member sees
 * INSTEAD of the app when the consent documents were bumped after they last
 * accepted them. Privacy §15 / Terms §14 promise in-app notification of
 * material changes; this is that notification, and the only path onward is
 * to accept the current documents (or sign out).
 *
 * Rendered by every app's `AuthGuard` -- before role routing, after the
 * `users` doc has loaded -- when `needsReconsent(userDoc)` (shared-core) is
 * true. The host supplies the writes: `onAccept` calls `acknowledgeConsent`
 * with the version this bundle PRESENTED (`consentVersion`, the client's
 * CONSENT_VERSION) and then refreshes the doc, which is what makes the gate
 * go away; `onSignOut` is the way out for a member who declines.
 *
 * Presentational: no firebase dependency, no knowledge of which app it is
 * in. The document links are same-origin routes every app serves at the
 * same paths (`/terms`, `/privacy`), overridable for a host that does not.
 *
 * NOT a modal over the app: the member has not accepted the terms the app
 * runs under, so nothing of the app renders behind this. Neutral grays, no
 * brand colour -- the documents are shared across the three apps.
 */
export interface ConsentGateProps {
  /** The version this bundle presents; passed back to `onAccept` unchanged. */
  consentVersion: string;
  /** Records the acceptance server-side, then refreshes the member's doc. Rejections are mapped to copy. */
  onAccept: (consentVersion: string) => Promise<void>;
  onSignOut: () => void | Promise<void>;
  termsHref?: string;
  privacyHref?: string;
}

function acceptErrorKey(err: unknown): string {
  // `consent/stale-client`: this bundle presented a version the server no
  // longer recognises as current -- the fix is a reload, not a retry, and the
  // copy says so. Read off `details.code`, never `err.message`.
  const code = (err as { details?: { code?: unknown } } | null)?.details?.code;
  if (code === 'consent/stale-client') return 'consentGate.staleClient';
  // Any other callable failure (offline, permission) gets the generic line;
  // callableErrorCode is consulted only so the mapping stays in one idiom.
  void callableErrorCode(err);
  return 'common.error';
}

export function ConsentGate({
  consentVersion,
  onAccept,
  onSignOut,
  termsHref = '/terms',
  privacyHref = '/privacy',
}: ConsentGateProps) {
  const { t } = useTranslation();
  const [agreed, setAgreed] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const accept = async () => {
    if (!agreed || accepting) return;
    setAccepting(true);
    setErrorKey(null);
    try {
      await onAccept(consentVersion);
    } catch (err) {
      setErrorKey(acceptErrorKey(err));
      setAccepting(false);
    }
    // On success the host's refreshed doc unmounts this gate; leaving
    // `accepting` true until then keeps a second tap from double-writing.
  };

  return (
    <main
      aria-labelledby="consent-gate-title"
      className="flex min-h-screen flex-col items-center justify-center bg-ground-admin px-6 py-10"
    >
      <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h1 id="consent-gate-title" className="mb-2 text-xl font-bold text-gray-900">
          {t('consentGate.title')}
        </h1>
        <p className="mb-5 text-sm text-gray-600">{t('consentGate.body')}</p>

        <ul className="mb-5 space-y-1 text-sm">
          <li>
            <Link to={termsHref} target="_blank" className="font-semibold text-brand-600 hover:underline">
              {t('consentGate.terms')}
            </Link>
          </li>
          <li>
            <Link to={privacyHref} target="_blank" className="font-semibold text-brand-600 hover:underline">
              {t('consentGate.privacy')}
            </Link>
          </li>
        </ul>

        <Checkbox
          className="mb-5"
          checked={agreed}
          disabled={accepting}
          onChange={(e) => setAgreed(e.target.checked)}
          label={
            <>
              {t('consentGate.agreePrefix')}{' '}
              <Link to={termsHref} target="_blank" className="text-brand-600 hover:underline">
                {t('consentGate.terms')}
              </Link>{' '}
              {t('consentGate.and')}{' '}
              <Link to={privacyHref} target="_blank" className="text-brand-600 hover:underline">
                {t('consentGate.privacy')}
              </Link>
              .
            </>
          }
        />

        {errorKey && (
          <p role="alert" className="mb-4 text-sm text-error-600">
            {t(errorKey)}
          </p>
        )}

        <Button type="button" onClick={accept} disabled={!agreed || accepting}>
          {t('consentGate.accept')}
        </Button>

        <button
          type="button"
          onClick={() => void onSignOut()}
          disabled={accepting}
          className="mt-4 w-full text-center text-sm text-gray-500 hover:text-gray-700 hover:underline disabled:opacity-50"
        >
          {t('consentGate.signOut')}
        </button>
      </div>
    </main>
  );
}
