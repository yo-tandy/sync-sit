import { useEffect, useRef } from 'react';
import { ref as storageRef, uploadBytes } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import { DO_TASK_PHOTOS_MAX } from '@ejm/do-core';
import { functions, storage } from '@/config/firebase';
import type { PhotoItem } from './postTaskDraft';

/** How the thumbnail poll paces itself: the stripper republishes within
 * seconds (§7.4), so a short fixed interval with a retry cap covers the
 * normal case, and the per-photo Retry button covers a slow one. */
export const PHOTO_POLL_INTERVAL_MS = 2500;
export const PHOTO_POLL_MAX_ATTEMPTS = 8;

/**
 * Client-side mirror of the storage.rules quarantine bounds
 * (`request.resource.size < 10MB && contentType.matches('image/.*')`): the
 * rules are the enforcement, this pre-check is the COPY — without it an
 * oversized camera photo dies as an opaque rules rejection with copy that
 * invites retrying (PR #331 round 1). Keep in sync with storage.rules.
 */
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;

interface UsePhotoUploadsArgs {
  uid: string | null;
  photos: PhotoItem[];
  onChange: (mutate: (prev: PhotoItem[]) => PhotoItem[]) => void;
}

/** What addPhoto did with the file — the STEP maps these to its notice
 * copy. A return value rather than callbacks so the hook can live in
 * PostTaskPage (outliving the step) while the notices stay step-local. */
export type AddPhotoResult = 'added' | 'limit' | 'wrong_type' | 'too_large' | 'upload_failed';

/** The three pipeline actions, as handed down to StepPhotos. */
export interface PhotoActions {
  addPhoto: (file: File) => Promise<AddPhotoResult>;
  retryPhoto: (photoId: string) => void;
  removePhoto: (photoId: string) => void;
}

function patch(photos: PhotoItem[], photoId: string, changes: Partial<PhotoItem>): PhotoItem[] {
  return photos.map((p) => (p.photoId === photoId ? { ...p, ...changes } : p));
}

/**
 * The §7.4 client pipeline, wizard side:
 *
 * 1. The wizard MINTS the photo id (crypto.randomUUID) and uploads the raw
 *    file to the quarantine prefix `do-uploads/{uid}/{photoId}` — the only
 *    client-writable path (the final prefix is `allow read, write: if
 *    false`).
 * 2. A storage trigger strips EXIF and republishes to
 *    `do-photos/{uid}/{photoId}` — SAME id (the return leg: the client
 *    already knows it, which is what lets it render thumbnails and hand
 *    doPostTask ids it could never list from the locked prefix).
 * 3. The thumbnail comes from `doGetOwnPhotoUrl`, polled while the stripper
 *    works: `not-found` is the NOT-YET-STRIPPED retry signal, by design.
 *
 * States: uploading → processing (polling) → ready | error; 'processing'
 * past the poll cap keeps a manual Retry.
 *
 * OWNED BY PostTaskPage, not the photos step (PR #331 round 3): the wizard
 * renders only the current step, so a hook mounted inside StepPhotos dies
 * on a Back press — an in-flight uploadBytes would resolve into a
 * permanently-`uploading` tile with no recovery control. Hosted in the
 * page, the pipeline runs for the wizard's whole life and uploads/polls
 * simply continue while the parent visits other steps; unmount cleanup
 * fires only when the wizard itself is left (where the draft dies too).
 */
export function usePhotoUploads({ uid, photos, onChange }: UsePhotoUploadsArgs): PhotoActions {
  // Live timers by photoId, cleared on unmount — the poll must never outlive
  // the wizard (the AreaPage timer-leak lesson, PR #221).
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Poll-chain GENERATION per photoId: exactly one chain may be live per
  // photo. The timer-clear alone misses the request-in-flight window (a
  // Retry during a slow doGetOwnPhotoUrl call — PR #331 round 2), so every
  // chain carries the generation it was started under and its callbacks
  // no-op once a newer chain (or a remove) bumped it.
  const gensRef = useRef<Map<string, number>>(new Map());
  const bumpGen = (photoId: string): number => {
    const next = (gensRef.current.get(photoId) ?? 0) + 1;
    gensRef.current.set(photoId, next);
    return next;
  };
  const unmountedRef = useRef(false);
  useEffect(() => {
    unmountedRef.current = false;
    const timers = timersRef.current;
    return () => {
      unmountedRef.current = true;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const pollThumbnail = (photoId: string, attempt: number, gen: number) => {
    if (unmountedRef.current) return;
    const stale = () => gensRef.current.get(photoId) !== gen;
    if (stale()) return;
    const getUrl = httpsCallable<{ photoId: string }, { url: string }>(functions, 'doGetOwnPhotoUrl');
    getUrl({ photoId })
      .then((res) => {
        if (unmountedRef.current || stale()) return;
        timersRef.current.delete(photoId);
        onChange((prev) => patch(prev, photoId, { state: 'ready', url: res.data.url }));
      })
      .catch((err: unknown) => {
        if (unmountedRef.current || stale()) return;
        const code = (err as { code?: string } | null)?.code ?? '';
        if (code.endsWith('not-found')) {
          // Not yet stripped (§7.4's retry signal). Keep polling up to the
          // cap; past it the photo stays 'processing' with a manual Retry.
          if (attempt + 1 < PHOTO_POLL_MAX_ATTEMPTS) {
            const timer = setTimeout(
              () => pollThumbnail(photoId, attempt + 1, gen),
              PHOTO_POLL_INTERVAL_MS,
            );
            timersRef.current.set(photoId, timer);
          } else {
            timersRef.current.delete(photoId);
          }
          return;
        }
        timersRef.current.delete(photoId);
        onChange((prev) => patch(prev, photoId, { state: 'error' }));
      });
  };

  const addPhoto = async (file: File): Promise<AddPhotoResult> => {
    if (!uid) return 'upload_failed';
    if (photos.length >= DO_TASK_PHOTOS_MAX) {
      return 'limit';
    }
    // Pre-empt the storage.rules bounds with actionable copy (the
    // VerificationPage file-size precedent): `accept="image/*"` on the
    // input is a picker hint, not enforcement.
    if (!file.type.startsWith('image/')) {
      return 'wrong_type';
    }
    if (file.size >= PHOTO_MAX_BYTES) {
      return 'too_large';
    }
    // Client-minted UUID (§7.4): safe because both prefixes are keyed by the
    // caller's own uid — a colliding id can only clobber the caller's own
    // objects.
    const photoId = crypto.randomUUID();
    onChange((prev) => [...prev, { photoId, state: 'uploading', url: null }]);
    try {
      await uploadBytes(storageRef(storage, `do-uploads/${uid}/${photoId}`), file);
    } catch {
      if (!unmountedRef.current) {
        onChange((prev) => prev.filter((p) => p.photoId !== photoId));
      }
      return 'upload_failed';
    }
    if (unmountedRef.current) return 'added';
    onChange((prev) => patch(prev, photoId, { state: 'processing' }));
    pollThumbnail(photoId, 0, bumpGen(photoId));
    return 'added';
  };

  const retryPhoto = (photoId: string) => {
    // Clear any poll already pending for this photo BEFORE starting a fresh
    // chain (mirrors removePhoto), and bump the generation so an IN-FLIGHT
    // request's callbacks no-op too — the timer-clear alone misses the
    // request-in-flight window (PR #331 round 2). Same timer-lifecycle
    // class as the PR #221 lesson.
    const pending = timersRef.current.get(photoId);
    if (pending) {
      clearTimeout(pending);
      timersRef.current.delete(photoId);
    }
    onChange((prev) => patch(prev, photoId, { state: 'processing' }));
    pollThumbnail(photoId, 0, bumpGen(photoId));
  };

  const removePhoto = (photoId: string) => {
    // Bump the generation: a removed photo's in-flight chain must not
    // resurrect it into the list via a late patch.
    bumpGen(photoId);
    const timer = timersRef.current.get(photoId);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(photoId);
    }
    // Client-side removal only: the quarantine/final objects are the daily
    // unclaimed-object sweep's to collect (§7.4) — the locked prefixes are
    // not client-deletable.
    onChange((prev) => prev.filter((p) => p.photoId !== photoId));
  };

  return { addPhoto, retryPhoto, removePhoto };
}
