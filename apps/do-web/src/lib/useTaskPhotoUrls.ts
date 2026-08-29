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
  const [loading, setLoading] = useState(false);

  const photoKey = photos.map((p) => p.photoId).join(',');
  useEffect(() => {
    if (photoKey === '') return;
    let cancelled = false;
    setLoading(true);
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
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [taskId, photoKey]);

  return { urls, loading };
}
