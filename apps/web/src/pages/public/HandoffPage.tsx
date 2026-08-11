import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import { signInWithCustomToken } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { getSitRole, type SitUser } from '@ejm/sit-core';
import { auth, db, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { postLoginRouter } from '@/lib/postLoginRouter';
import { Card, Spinner } from '@/components/ui';

/**
 * PUBLIC cross-app arrival page (/handoff#code=…). The one-time code minted
 * on the other app is the capability — no auth guard wraps this route. It
 * arrives in the URL FRAGMENT (fragments never reach servers or logs) and is
 * stripped from the address bar before anything else happens.
 *
 * Every way the code can be bad (missing, expired, already used, garbage) is
 * ONE identical "switch again" screen — the backend refuses them
 * indistinguishably, and a missing code renders the same screen locally.
 */
function codeFromHash(): string | null {
  const hash = window.location.hash;
  return new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash).get('code');
}

export function HandoffPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // A missing code IS the error state from the first render (same screen as a
  // rejected code — no oracle in the UI either).
  const [failed, setFailed] = useState<boolean>(() => codeFromHash() === null);
  const started = useRef(false);

  useEffect(() => {
    // The code is one-time; guard against StrictMode's double-run of effects.
    if (started.current) return;
    started.current = true;

    const code = codeFromHash();
    // Strip the fragment IMMEDIATELY — before any await — so the code never
    // survives in the address bar or a history entry.
    window.history.replaceState(null, '', window.location.pathname + window.location.search);

    if (!code) return; // the initial state already shows the error screen

    (async () => {
      try {
        const redeem = httpsCallable<{ code: string }, { token: string }>(
          functions,
          'redeemAppHandoffCode',
        );
        const res = await redeem({ code });
        // If someone is already signed in on this origin, the handoff still
        // wins — it's the fresher intent; the custom token replaces the
        // session.
        const cred = await signInWithCustomToken(auth, res.data.token);
        try {
          // Mirror the login flow: load the user doc, prime the store, then
          // land exactly where the login page would.
          const snap = await getDoc(doc(db, 'users', cred.user.uid));
          const userDoc = snap.exists() ? (snap.data() as SitUser) : null;
          useAuthStore.setState({ firebaseUser: cred.user, userDoc, loading: false });
          navigate(postLoginRouter(getSitRole(userDoc)), { replace: true });
        } catch {
          // Past sign-in the user IS authenticated and the code is consumed —
          // the "switch again" screen would strand them. Land on the default
          // entrance instead; the app re-reads the user doc from there.
          useAuthStore.setState({ firebaseUser: cred.user, userDoc: null, loading: false });
          navigate(postLoginRouter(getSitRole(null)), { replace: true });
        }
      } catch {
        setFailed(true);
      }
    })();
  }, [navigate]);

  if (failed) {
    return (
      <div className="px-5 pt-8 pb-8">
        <Card>
          <h2 className="mb-2 text-lg font-bold text-gray-900">{t('handoff.errorTitle')}</h2>
          <p className="mb-4 text-sm text-gray-600">{t('handoff.errorDesc')}</p>
          <Link to="/login" className="text-sm text-red-600 hover:underline">
            {t('handoff.goToLogin')}
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 py-20">
      <Spinner className="h-8 w-8 text-red-600" />
      <p className="text-sm text-gray-600">{t('handoff.switching')}</p>
    </div>
  );
}
