import { useTranslation } from 'react-i18next';
import type { TaskDoc } from '@ejm/do-core';
import { Spinner } from '@ejm/shared-ui';
import { useTaskPhotoUrls } from '@/lib/useTaskPhotoUrls';

/**
 * A published task's photos on the family's own detail, via the shared
 * `useTaskPhotoUrls` hook — every render goes through `doGetTaskPhotoUrl`
 * (plan §7.4 option 1: the final prefix is `allow read: if false`), and
 * failures degrade silently to fewer thumbnails: the photos are
 * illustrative here, never load-bearing.
 */
export function TaskPhotos({ task }: { task: TaskDoc }) {
  const { t } = useTranslation();
  const { urls, loading } = useTaskPhotoUrls(task.taskId, task.photos);

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
