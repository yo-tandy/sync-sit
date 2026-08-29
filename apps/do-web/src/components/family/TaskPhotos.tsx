import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { httpsCallable } from 'firebase/functions';
import type { TaskDoc } from '@ejm/do-core';
import { Spinner } from '@ejm/shared-ui';
import { functions } from '@/config/firebase';

/**
 * A published task's photos on the family's own detail. The final storage
 * prefix is `allow read: if false` (§7.4 option 1), so every render goes
 * through `doGetTaskPhotoUrl` — the callable re-proves the §7.2 audience
 * against the task and signs each stored `{uid, photoId}` pair. Failures
 * degrade silently to fewer thumbnails: the photos are illustrative here,
 * never load-bearing.
 */
export function TaskPhotos({ task }: { task: TaskDoc }) {
  const { t } = useTranslation();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const photoKey = task.photos.map((p) => p.photoId).join(',');
  useEffect(() => {
    if (task.photos.length === 0) return;
    let cancelled = false;
    setLoading(true);
    const getUrl = httpsCallable<{ taskId: string; photoId: string }, { url: string }>(
      functions,
      'doGetTaskPhotoUrl',
    );
    void Promise.all(
      task.photos.map(async ({ photoId }) => {
        try {
          const res = await getUrl({ taskId: task.taskId, photoId });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.taskId, photoKey]);

  if (task.photos.length === 0) return null;

  return (
    <div className="mt-3">
      <h4 className="mb-2 text-xs font-semibold text-gray-700">{t('family.taskDetail.photosTitle')}</h4>
      {loading ? (
        <div className="flex justify-center py-4">
          <Spinner className="h-5 w-5" />
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {task.photos.map(
            ({ photoId }) =>
              urls[photoId] && (
                <img
                  key={photoId}
                  src={urls[photoId]}
                  alt=""
                  data-testid="task-photo"
                  className="aspect-square w-full rounded-lg object-cover"
                />
              ),
          )}
        </div>
      )}
    </div>
  );
}
