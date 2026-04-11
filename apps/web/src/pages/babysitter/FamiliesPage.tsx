import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { Card, TopNav, Spinner } from '@/components/ui';

interface SharingRequest {
  requestId: string;
  familyId: string;
  familyName: string;
  parentName: string;
  status: 'pending' | 'approved' | 'declined';
  createdAt: any;
}

export function FamiliesPage() {
  const { t } = useTranslation();
  const { firebaseUser } = useAuthStore();
  const uid = firebaseUser?.uid;

  const [requests, setRequests] = useState<SharingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    const q = query(
      collection(db, 'contactSharingRequests'),
      where('babysitterUserId', '==', uid)
    );
    const unsub = onSnapshot(q, (snap) => {
      const reqs = snap.docs.map((d) => ({
        ...d.data(),
        requestId: d.id,
      })) as SharingRequest[];
      // Sort: pending first, then approved, then declined
      reqs.sort((a, b) => {
        const order = { pending: 0, approved: 1, declined: 2 };
        return (order[a.status] || 3) - (order[b.status] || 3);
      });
      setRequests(reqs);
      setLoading(false);
    });
    return unsub;
  }, [uid]);

  const handleRespond = async (requestId: string, action: 'approve' | 'decline') => {
    setToggling(requestId);
    try {
      const fn = httpsCallable(functions, 'respondToContactSharing');
      await fn({ requestId, action });
    } catch {
      // silent
    } finally {
      setToggling(null);
    }
  };

  return (
    <div>
      <TopNav title={t('fans.title')} backTo="/babysitter" />

      <div className="px-5 pt-4 pb-8">
        <p className="mb-2 text-sm text-gray-500">{t('fans.desc')}</p>
        <p className="mb-6 text-xs text-amber-600">{t('fans.appointmentNote')}</p>

        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner className="h-8 w-8 text-red-600" />
          </div>
        ) : requests.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-center">
            <div className="mb-3 text-3xl">👨‍👩‍👧</div>
            <p className="mb-1 text-sm font-medium text-gray-700">{t('fans.noFamilies')}</p>
            <p className="max-w-[260px] text-xs text-gray-500">{t('fans.noFamiliesDesc')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {requests.map((req) => (
              <Card key={req.requestId}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">
                      {req.familyName} {t('fans.family')}
                    </p>
                    <p className="text-xs text-gray-500">{req.parentName}</p>
                  </div>

                  {req.status === 'pending' && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleRespond(req.requestId, 'approve')}
                        disabled={toggling === req.requestId}
                        className="rounded-lg bg-green-100 px-3 py-1.5 text-xs font-semibold text-green-700 active:bg-green-200"
                      >
                        {t('fans.share')}
                      </button>
                      <button
                        onClick={() => handleRespond(req.requestId, 'decline')}
                        disabled={toggling === req.requestId}
                        className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-600 active:bg-gray-200"
                      >
                        {t('fans.decline')}
                      </button>
                    </div>
                  )}

                  {req.status === 'approved' && (
                    <button
                      onClick={() => handleRespond(req.requestId, 'decline')}
                      disabled={toggling === req.requestId}
                      className="flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1.5 text-xs font-semibold text-green-700"
                    >
                      <div className="h-2 w-2 rounded-full bg-green-500" />
                      {t('fans.sharing')}
                    </button>
                  )}

                  {req.status === 'declined' && (
                    <button
                      onClick={() => handleRespond(req.requestId, 'approve')}
                      disabled={toggling === req.requestId}
                      className="flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-500"
                    >
                      <div className="h-2 w-2 rounded-full bg-gray-400" />
                      {t('fans.notSharing')}
                    </button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
