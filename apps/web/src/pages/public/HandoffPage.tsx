import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { i18n as I18n } from 'i18next';
import { httpsCallable } from 'firebase/functions';
import { signInWithCustomToken } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { getSitRole, type SitUser } from '@ejm/sit-core';
import { auth, db, functions } from '@/config/firebase';
import { markNextSignInFresh, useAuthStore } from '@/stores/authStore';
import { postLoginRouter } from '@/lib/postLoginRouter';
import { Card, Spinner } from '@/components/ui';

/**
 * PUBLIC cross-app arrival page (/handoff#code=…&lang=…). The one-time code
 * minted on the other app is the capability — no auth guard wraps this route.
 * It arrives in the URL FRAGMENT (fragments never reach servers or logs) and
 * is stripped from the address bar as soon as the page mounts.
 *
 * Every way the code can be bad (missing, expired, already used, garbage) is
 * ONE identical "switch again" screen — the backend refuses them
 * indistinguishably, and a missing code renders the same screen locally
 * WITHOUT any callable round-trip.
 *
 * The whole arrival is a module-scope ONE-SHOT: the fragment is read and
 * stripped once, and redeem+sign-in runs once, no matter how many times React
 * mounts the component (StrictMode remounts in dev would otherwise re-redeem
 * the one-time code and land on the error screen). Once the attempt settles,
 * the stash and attempt are cleared — a later visit with no fragment takes the
 * pure no-code path.
 */
function hashParams(): URLSearchParams {
  const hash = window.location.hash;
  return new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
}

/**
 * Deep-link destination guard (issue #129). The origin app may pass a
 * `dest` fragment param to land the user on a specific sit page after
 * sign-in (e.g. /family/verification from study's verification banner).
 *
 * SECURITY: the destination rides ONLY in the URL fragment — it is NOT part
 * of the minted handoff doc and nothing server-side ever sees or validates
 * it. This allowlist-shape check is therefore doing ALL the work: the
 * handoff URL is attacker-visible surface, and honoring an unvalidated
 * destination right after an authenticating sign-in would be an open
 * redirect through the auth handoff. Accept only a RELATIVE path on this
 * origin — must start with '/', must not start with '//'
 * (protocol-relative), no backslash anywhere (browsers fold '\' into '/',
 * so '/\evil.com' becomes '//evil.com'), and a scheme ('javascript:',
 * 'https:') is impossible once the leading '/' is required. Anything else
 * is dropped and the arrival falls back to the default role landing.
 */
function safeDestination(raw: string | null): string | null {
  if (!raw || raw.length > 512) return null;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  if (raw.includes('\\')) return null;
  return raw;
}

let stashedParams: URLSearchParams | null = null;
let attempt: Promise<string | null> | null = null;

/** Read + strip the fragment on a fresh arrival; keep the stash for remounts. */
function takeHashParams(): URLSearchParams {
  if (window.location.hash) {
    stashedParams = hashParams();
    attempt = null; // a fresh fragment starts a fresh one-shot
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  return stashedParams ?? new URLSearchParams();
}

/**
 * The one-shot: redeem the code, sign in, prime the auth store. Resolves the
 * landing route on success, null on any failure. Cached module-side so
 * StrictMode's second mount awaits the SAME promise instead of re-redeeming.
 */
function runHandoffOnce(params: URLSearchParams, i18nInstance: I18n): Promise<string | null> {
  if (attempt) return attempt;
  attempt = (async () => {
    const code = params.get('code');
    // The origin app passes its CURRENT language (i18n caches are per-origin)
    // so the user keeps their language across the switch. Allow-listed; an
    // unknown or absent value leaves the language untouched.
    const lang = params.get('lang');
    if (lang === 'en' || lang === 'fr') void i18nInstance.changeLanguage(lang);
    // Optional deep-link destination — validated (see safeDestination) or
    // dropped; a hostile value degrades to the default landing, never fails
    // the handoff.
    const dest = safeDestination(params.get('dest'));
    if (!code) return null;
    try {
      const redeem = httpsCallable<{ code: string }, { token: string }>(
        functions,
        'redeemAppHandoffCode',
      );
      const res = await redeem({ code });
      // If someone is already signed in on this origin, the handoff still
      // wins — it's the fresher intent; the custom token replaces the session.
      // Fresh, deliberate sign-in: capture the session epoch anew (issue #181).
      markNextSignInFresh();
      const cred = await signInWithCustomToken(auth, res.data.token);
      try {
        // Mirror the login flow: load the user doc, prime the store, then
        // land exactly where the login page would.
        const snap = await getDoc(doc(db, 'users', cred.user.uid));
        const userDoc = snap.exists() ? (snap.data() as SitUser) : null;
        useAuthStore.setState({ firebaseUser: cred.user, userDoc, loading: false });
        // A validated deep-link destination wins over the role landing; the
        // layout guards own whether this user may actually see that page,
        // exactly as for a typed-in URL.
        return dest ?? postLoginRouter(getSitRole(userDoc), userDoc);
      } catch {
        // Past sign-in the user IS authenticated and the code is consumed —
        // the "switch again" screen would strand them. Land on the default
        // entrance instead (NOT the deep-link destination: with no user doc
        // the role layouts cannot vouch for it); the app re-reads the user
        // doc from there.
        useAuthStore.setState({ firebaseUser: cred.user, userDoc: null, loading: false });
        return postLoginRouter(getSitRole(null));
      }
    } catch {
      return null;
    }
  })();
  // Once settled, the arrival is over: clear the one-shot so a later visit
  // (no fragment) neither re-redeems nor keeps the code in memory. Clear ONLY
  // if we are still the current attempt — a fresh fragment may have started a
  // new one-shot while this one was in flight, and its state must survive.
  const mine = attempt;
  const mineParams = stashedParams;
  void mine.finally(() => {
    if (stashedParams === mineParams) stashedParams = null;
    if (attempt === mine) attempt = null;
  });
  return mine;
}

export function HandoffPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const params = takeHashParams();
    void runHandoffOnce(params, i18n).then((dest) => {
      // Only the LIVE instance acts on the shared one-shot's outcome.
      if (!alive) return;
      if (dest) navigate(dest, { replace: true });
      else setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [navigate, i18n]);

  if (failed) {
    return (
      <div className="px-5 pt-8 pb-8">
        <Card>
          <h2 className="mb-2 text-lg font-bold text-gray-900">{t('handoff.errorTitle')}</h2>
          <p className="mb-4 text-sm text-gray-600">{t('handoff.errorDesc')}</p>
          <Link to="/login" className="text-sm text-brand-600 hover:underline">
            {t('handoff.goToLogin')}
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 py-20">
      <Spinner className="h-8 w-8 text-brand-600" />
      <p className="text-sm text-gray-600">{t('handoff.switching')}</p>
    </div>
  );
}
