import { useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/config/firebase';

/**
 * Signed URLs for a task's photos, keyed by photoId. The final storage
 * prefix is `allow read: if false` (plan §7.4 option 1), so every render —
 * family detail, doer board card, doer detail — goes through
 * `doGetTaskPhotoUrl`: the callable re-proves the §7.2 audience against the
 * task and signs each stored `{uid, photoId}` pair. Failures degrade
 * silently to fewer thumbnails: photos are illustrative, never
 * load-bearing. Extracted from PR7's TaskPhotos for the PR8 doer surfaces.
 */
export function useTaskPhotoUrls(
  taskId: string,
  photos: { photoId: string }[],
): { urls: Record<string, string>; loading: boolean } {
  const [urls, setUrls] = useState<Record<string, string>>({});
  // The SETTLED key, not a loading flag: `loading` is derived below instead of
  // written synchronously on the way into the effect, which cascades renders.
  // Same idiom `useAssignedContact` records — the state a fetch needs is
  // scheduled by whoever triggers it, never set inside the effect body.
  const [settledKey, setSettledKey] = useState<string | null>(null);

  const photoKey = photos.map((p) => p.photoId).join(',');
  useEffect(() => {
    if (photoKey === '') return;
    let cancelled = false;
    const getUrl = httpsCallable<{ taskId: string; photoId: string }, { url: string }>(
      functions,
      'doGetTaskPhotoUrl',
    );
    void Promise.all(
      photoKey.split(',').map(async (photoId) => {
        try {
          const res = await getUrl({ taskId, photoId });
          return [photoId, res.data.url] as const;
        } catch {
          return null;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      setUrls(Object.fromEntries(entries.filter((e): e is [string, string] => e !== null)));
      setSettledKey(`${taskId}|${photoKey}`);
    });
    return () => {
      cancelled = true;
    };
  }, [taskId, photoKey]);

  // Identity includes taskId: the effect keys on both, so a taskId change
  // with an identical photoKey is still a refetch and must read as loading.
  return { urls, loading: photoKey !== '' && settledKey !== `${taskId}|${photoKey}` };
}
