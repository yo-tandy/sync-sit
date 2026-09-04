import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Address } from '@ejm/shared-core';
import { Button } from '../components/Button.js';
import { Textarea } from '../components/Textarea.js';
import { Avatar } from '../components/Avatar.js';
import { AddressAutocomplete } from '../forms/AddressAutocomplete.js';

export interface AdditionalInfoData {
  bio: string;
  /** A freshly-picked file, or `null` when no (new) photo was chosen. The
   *  orchestrator (PR4) owns actually uploading it to Storage -- this
   *  component makes no API calls. */
  photoFile: File | null;
  address: Address | null;
}

interface StepAdditionalInfoProps {
  onNext: (data: AdditionalInfoData) => void;
  /** Previously-entered values, restored on back-navigation. Note there is
   *  no restored `photoFile` -- a `File` cannot round-trip through wizard
   *  state, so a back-then-forward re-selects it if still wanted. */
  initial?: { bio: string; address: Address | null } | null;
  /** A submit-time server rejection carried back from a later step. */
  serverError?: string | null;
}

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const ACCEPTED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

/**
 * Additional-info step of the unified enrollment flow (issue #435
 * milestone, PR3, step 4b "optional extras"): bio/"about me", profile
 * photo, and home address. Every field here is optional, so the button is
 * always enabled -- there is nothing to validate before continuing.
 *
 * No existing photo-UPLOAD component was found in shared-ui (`Avatar`
 * only ever renders one; `PhotoLightbox` only ever views one), so this adds
 * a plain file-input + object-URL preview -- no cropping/compression, per
 * the task brief, since nothing like that exists elsewhere to copy either.
 *
 * Address reuses the existing `AddressAutocomplete` unchanged.
 *
 * Presentational only: owns its own field state, calls `onNext` with the
 * finished payload. No callables -- the photo file is handed up raw for
 * the orchestrator to upload.
 */
export function StepAdditionalInfo({ onNext, initial = null, serverError = null }: StepAdditionalInfoProps) {
  const { t } = useTranslation();
  const [bio, setBio] = useState(initial?.bio ?? '');
  const [address, setAddress] = useState<Address | null>(initial?.address ?? null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Object URLs are only valid for the lifetime of the File reference that
  // created them -- revoke the previous one whenever it's replaced, and on
  // unmount, so a picked-then-abandoned photo doesn't leak.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    e.target.value = '';
    if (!file) return;
    setPhotoError(null);
    if (!ACCEPTED_PHOTO_TYPES.includes(file.type)) {
      setPhotoError(t('unifiedEnrollment.photoTypeError'));
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setPhotoError(t('unifiedEnrollment.photoSizeError'));
      return;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPhotoFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const handleRemovePhoto = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPhotoFile(null);
    setPreviewUrl(null);
    setPhotoError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onNext({ bio: bio.trim(), photoFile, address });
  };

  return (
    <form onSubmit={handleSubmit} className="px-6">
      <h2 className="mt-4 mb-2 text-xl font-bold">{t('unifiedEnrollment.additionalInfoTitle')}</h2>
      <p className="mb-6 text-sm text-gray-500">{t('unifiedEnrollment.additionalInfoSubtitle')}</p>

      <div className="mb-5">
        <label className="mb-2 block text-sm font-medium text-gray-700">
          {t('unifiedEnrollment.photoLabel')}
        </label>
        <div className="flex items-center gap-4">
          <Avatar initials="?" src={previewUrl ?? undefined} size="lg" />
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_PHOTO_TYPES.join(',')}
              className="hidden"
              onChange={handleFileChange}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              fullWidth={false}
              onClick={() => fileInputRef.current?.click()}
            >
              {t('unifiedEnrollment.photoChoose')}
            </Button>
            {photoFile && (
              <button
                type="button"
                onClick={handleRemovePhoto}
                className="ml-3 text-sm font-medium text-brand-600 hover:underline"
              >
                {t('unifiedEnrollment.photoRemove')}
              </button>
            )}
            <p className="mt-1 text-xs text-gray-500">{t('unifiedEnrollment.photoHint')}</p>
          </div>
        </div>
        {photoError && <p className="mt-2 text-sm text-error-600">{photoError}</p>}
      </div>

      <Textarea
        label={t('unifiedEnrollment.bioLabel')}
        value={bio}
        onChange={(e) => setBio(e.target.value)}
        placeholder={t('unifiedEnrollment.bioPlaceholder')}
        rows={4}
        maxLength={1000}
      />

      <AddressAutocomplete value={address} onChange={setAddress} label={t('unifiedEnrollment.addressLabel')} />
      <p className="-mt-3 mb-5 text-xs text-gray-500">{t('unifiedEnrollment.addressHint')}</p>

      {serverError && <p className="mb-4 text-sm text-error-600">{serverError}</p>}

      <Button type="submit">{t('common.continue')}</Button>
    </form>
  );
}
