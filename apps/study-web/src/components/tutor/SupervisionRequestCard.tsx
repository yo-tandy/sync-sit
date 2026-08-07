import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { Card, Button, Dialog, ShieldIcon } from '@ejm/shared-ui';
import type { GuardianLinkDoc } from '@/types/guardian';

/**
 * The kid's ask-to-supervise prompt on the tutor dashboard. Reads
 * guardianLinks/{ownUid} — the ONLY client-side guardian Firestore read
 * (child-readable by rules) — and renders only for a pending CLAIM (a
 * parent_created pending link activates through the invite email instead).
 *
 * Both responses are NON-OPTIMISTIC: the card re-reads the link doc after the
 * callable resolves (accept → active, decline → deleted; either way the card
 * goes away), and refreshes the user doc so the governedBy mirror lands.
 * Declining is private — the parent is never told, so the confirm says so.
 */
export function SupervisionRequestCard() {
  const { t } = useTranslation();
  const { firebaseUser, refreshUserDoc } = useAuthStore();
  const uid = firebaseUser?.uid ?? null;

  const [link, setLink] = useState<GuardianLinkDoc | null>(null);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [declineOpen, setDeclineOpen] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!uid) return;
    try {
      const snap = await getDoc(doc(db, 'guardianLinks', uid));
      if (!mountedRef.current) return;
      setLink(snap.exists() ? (snap.data() as GuardianLinkDoc) : null);
    } catch {
      // Unreadable link doc → no card (the request still reaches the kid via
      // notification; this surface is best-effort).
    }
  }, [uid]);

  useEffect(() => {
    load();
  }, [load]);

  if (!link || link.status !== 'pending' || link.origin !== 'claim') return null;

  const respond = async (accept: boolean) => {
    setError(null);
    setActing(true);
    try {
      const fn = httpsCallable<{ accept: boolean }, { success: boolean }>(
        functions,
        'respondToSupervisionRequest',
      );
      await fn({ accept });
      await load();
      await refreshUserDoc();
    } catch {
      if (mountedRef.current) setError(t('supervision.error'));
    } finally {
      if (mountedRef.current) setActing(false);
    }
  };

  return (
    <Card className="mb-4">
      <div className="flex items-start gap-3">
        <ShieldIcon className="h-6 w-6 shrink-0 text-red-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900">{t('supervision.requestTitle')}</p>
          <p className="mt-0.5 text-xs text-gray-600">{t('supervision.requestBody')}</p>
          <Link
            to="/supervision-info"
            className="mt-1 inline-block text-xs font-semibold text-red-600 hover:underline"
          >
            {t('supervision.whatItMeans')}
          </Link>
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
          <div className="mt-3 flex gap-2">
            <Button size="sm" disabled={acting} onClick={() => respond(true)}>
              {t('supervision.accept')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={acting}
              onClick={() => setDeclineOpen(true)}
            >
              {t('supervision.decline')}
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={declineOpen} onClose={() => setDeclineOpen(false)}>
        <h3 className="mb-2 text-lg font-bold">{t('supervision.confirmDeclineTitle')}</h3>
        <p className="mb-5 text-sm text-gray-600">{t('supervision.confirmDeclineDesc')}</p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            disabled={acting}
            onClick={() => {
              setDeclineOpen(false);
              respond(false);
            }}
          >
            {t('supervision.confirmDeclineCta')}
          </Button>
          <Button variant="ghost" className="flex-1" onClick={() => setDeclineOpen(false)}>
            {t('common.cancel')}
          </Button>
        </div>
      </Dialog>
    </Card>
  );
}
