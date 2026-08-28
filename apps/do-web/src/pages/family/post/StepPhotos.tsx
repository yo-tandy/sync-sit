import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DO_TASK_PHOTOS_MAX } from '@ejm/do-core';
import { InfoBanner, PlusIcon, Spinner, XIcon } from '@ejm/shared-ui';
import { useAuthStore } from '@/stores/authStore';
import type { StepProps } from './steps';
import type { PhotoItem } from './postTaskDraft';
import { usePhotoUploads } from './usePhotoUploads';

interface StepPhotosProps extends StepProps {
  /** FUNCTIONAL photo updates: the upload/poll callbacks resolve long after
   * the render that scheduled them, so they must mutate the LATEST list —
   * a value-style `update({ photos: ... })` here would write through a
   * stale closure and drop concurrent uploads. */
  updatePhotos: (mutate: (prev: PhotoItem[]) => PhotoItem[]) => void;
}

/**
 * The §7.4 photos step: client-minted-UUID upload into the quarantine
 * prefix, thumbnails (and the not-yet-stripped retry state) via
 * doGetOwnPhotoUrl, ≤6 with a remove control. The §11.2 visibility warning
 * shows here as well as at review — photos are board-visible.
 */
export function StepPhotos({ draft, updatePhotos }: StepPhotosProps) {
  const { t } = useTranslation();
  const uid = useAuthStore((s) => s.firebaseUser)?.uid ?? null;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { addPhoto, retryPhoto, removePhoto } = usePhotoUploads({
    uid,
    photos: draft.photos,
    onChange: updatePhotos,
    onLimitError: () => setNotice(t('family.post.photoTooMany', { max: DO_TASK_PHOTOS_MAX })),
    onUploadError: () => setNotice(t('family.post.photoUploadError')),
  });

  return (
    <div>
      <p className="mb-2 text-sm text-gray-600">
        {t('family.post.photosHint', { max: DO_TASK_PHOTOS_MAX })}
      </p>
      <InfoBanner variant="warning" className="mb-4">
        {t('family.post.photosVisibleWarning')}
      </InfoBanner>

      <div className="grid grid-cols-3 gap-3">
        {draft.photos.map((photo) => (
          <div
            key={photo.photoId}
            className="relative aspect-square overflow-hidden rounded-xl border border-gray-200 bg-gray-50"
          >
            {photo.state === 'ready' && photo.url ? (
              <img src={photo.url} alt="" data-testid="photo-thumb" className="h-full w-full object-cover" />
            ) : photo.state === 'error' ? (
              <div className="flex h-full flex-col items-center justify-center gap-1 p-2 text-center">
                <span className="text-[10px] leading-tight text-error-600">
                  {t('family.post.photoError')}
                </span>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-2 text-center">
                <Spinner className="h-5 w-5" />
                <span className="text-[10px] text-gray-500">
                  {photo.state === 'uploading'
                    ? t('family.post.photoUploading')
                    : t('family.post.photoProcessing')}
                </span>
                {photo.state === 'processing' && (
                  <button
                    type="button"
                    onClick={() => retryPhoto(photo.photoId)}
                    className="text-[10px] font-semibold text-brand-600 underline"
                  >
                    {t('family.post.photoRetry')}
                  </button>
                )}
              </div>
            )}
            <button
              type="button"
              aria-label={t('family.post.photoRemove')}
              onClick={() => removePhoto(photo.photoId)}
              className="absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-gray-900/60 text-white hover:bg-gray-900/80"
            >
              <XIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}

        {draft.photos.length < DO_TASK_PHOTOS_MAX && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border-[1.5px] border-dashed border-gray-300 text-gray-400 transition-colors hover:border-brand-400 hover:text-brand-600"
          >
            <PlusIcon className="h-6 w-6" />
            <span className="text-[10px] font-medium">{t('family.post.photoAdd')}</span>
          </button>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        data-testid="photo-file-input"
        onChange={(e) => {
          setNotice(null);
          const file = e.target.files?.[0];
          if (file) void addPhoto(file);
          e.target.value = '';
        }}
      />

      {notice && <p className="mt-3 text-sm text-error-600">{notice}</p>}
    </div>
  );
}
