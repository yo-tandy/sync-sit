import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useState } from 'react';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

/**
 * The §7.4 photos step, client side:
 * - upload goes to the QUARANTINE prefix do-uploads/{uid}/{photoId} with a
 *   client-minted UUID (never do-photos — that prefix is locked);
 * - the thumbnail poll treats doGetOwnPhotoUrl not-found as the
 *   not-yet-stripped retry signal, resolving to 'ready' when the stripper
 *   republishes; a manual Retry re-polls;
 * - remove control; the ≤6 cap.
 */

const h = vi.hoisted(() => ({
  auth: { firebaseUser: { uid: 'parent-1' } as unknown },
  uploadBytes: vi.fn(() => Promise.resolve()),
  refPaths: [] as string[],
  getOwnPhotoUrl: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ db: {}, functions: {}, storage: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => {
    if (name !== 'doGetOwnPhotoUrl') throw new Error(`unexpected callable ${name}`);
    return h.getOwnPhotoUrl(payload);
  },
}));
vi.mock('firebase/storage', () => ({
  ref: (_storage: unknown, path: string) => {
    h.refPaths.push(path);
    return { path };
  },
  uploadBytes: (...args: unknown[]) => h.uploadBytes(...(args as [])),
}));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector?: (s: typeof h.auth) => unknown) => (selector ? selector(h.auth) : h.auth),
}));

import { StepPhotos } from '../StepPhotos';
import { EMPTY_DRAFT, type PhotoItem, type TaskDraft } from '../postTaskDraft';
import { PHOTO_POLL_INTERVAL_MS, usePhotoUploads } from '../usePhotoUploads';

/**
 * Stateful harness mirroring PostTaskPage's architecture (PR #331 round 3):
 * the PIPELINE HOOK lives in the harness (the page) while StepPhotos only
 * renders — `showStep` simulates the wizard leaving/re-entering the photos
 * step, which unmounts the step but NOT the pipeline.
 */
function Harness({
  initialPhotos = [] as PhotoItem[],
  showStep = true,
  notice = null as string | null,
}) {
  const [draft, setDraft] = useState<TaskDraft>({ ...EMPTY_DRAFT, photos: initialPhotos });
  const actions = usePhotoUploads({
    uid: 'parent-1',
    photos: draft.photos,
    onChange: (mutate) => setDraft((d) => ({ ...d, photos: mutate(d.photos) })),
  });
  if (!showStep) return <div>other-step</div>;
  return (
    <StepPhotos
      draft={draft}
      update={(c) => setDraft((d) => ({ ...d, ...c }))}
      actions={actions}
      pageNotice={notice}
    />
  );
}

function HarnessWithNotice({ notice }: { notice: string }) {
  return <Harness notice={notice} />;
}

function pickFile() {
  const input = screen.getByTestId('photo-file-input');
  fireEvent.change(input, { target: { files: [new File(['x'], 'garden.jpg', { type: 'image/jpeg' })] } });
}

const notFound = () =>
  Promise.reject(Object.assign(new Error('nf'), { code: 'functions/not-found', details: { reason: 'photo_not_ready' } }));

beforeEach(() => {
  vi.clearAllMocks();
  h.refPaths = [];
  h.getOwnPhotoUrl.mockImplementation(() => Promise.resolve({ data: { url: 'https://signed/thumb' } }));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('StepPhotos (§7.4 client pipeline)', () => {
  it('uploads to the quarantine prefix with a client-minted UUID and polls to ready', async () => {
    renderWithProviders(<Harness />);
    pickFile();

    await waitFor(() => expect(h.uploadBytes).toHaveBeenCalledTimes(1));
    expect(h.refPaths).toHaveLength(1);
    const path = h.refPaths[0];
    // do-uploads/{uid}/{uuid} — quarantine, never the locked final prefix.
    expect(path).toMatch(
      /^do-uploads\/parent-1\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    const photoId = path.split('/')[2];

    // The thumbnail comes from doGetOwnPhotoUrl for the SAME id (the §7.4
    // return leg: the stripper republishes under the upload id).
    await waitFor(() => expect(h.getOwnPhotoUrl).toHaveBeenCalledWith({ photoId }));
    await waitFor(() => expect(screen.getByTestId('photo-thumb')).toHaveAttribute('src', 'https://signed/thumb'));
  });

  it("shows the not-yet-stripped processing state on not-found and resolves on a later poll", async () => {
    vi.useFakeTimers();
    h.getOwnPhotoUrl.mockImplementationOnce(notFound);
    renderWithProviders(<Harness />);
    pickFile();

    // Flush upload + first (rejected) poll.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('Processing...')).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();

    // The scheduled re-poll succeeds and the thumbnail renders.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PHOTO_POLL_INTERVAL_MS);
    });
    expect(screen.getByTestId('photo-thumb')).toHaveAttribute('src', 'https://signed/thumb');
  });

  it('manual Retry re-polls a stuck processing photo', async () => {
    renderWithProviders(
      <Harness initialPhotos={[{ photoId: 'stuck-1', state: 'processing', url: null }]} />,
    );
    fireEvent.click(screen.getByText('Retry'));
    await waitFor(() => expect(h.getOwnPhotoUrl).toHaveBeenCalledWith({ photoId: 'stuck-1' }));
    await waitFor(() => expect(screen.getByTestId('photo-thumb')).toBeInTheDocument());
  });

  it('marks a photo failed on a non-not-found error, with the remove control', async () => {
    h.getOwnPhotoUrl.mockImplementationOnce(() =>
      Promise.reject(Object.assign(new Error('boom'), { code: 'functions/internal' })),
    );
    renderWithProviders(<Harness />);
    pickFile();
    await waitFor(() =>
      expect(screen.getByText(/could not be processed/i)).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByLabelText('Remove photo'));
    expect(screen.queryByText(/could not be processed/i)).toBeNull();
  });

  it('refuses an oversized file BEFORE uploading, with the size copy (storage.rules mirror)', async () => {
    renderWithProviders(<Harness />);
    const big = new File(['x'], 'huge.jpg', { type: 'image/jpeg' });
    Object.defineProperty(big, 'size', { value: 10 * 1024 * 1024 });
    fireEvent.change(screen.getByTestId('photo-file-input'), { target: { files: [big] } });
    await waitFor(() =>
      expect(screen.getByText(/larger than 10 MB/)).toBeInTheDocument(),
    );
    expect(h.uploadBytes).not.toHaveBeenCalled();
  });

  it('refuses a non-image file BEFORE uploading, with the type copy', async () => {
    renderWithProviders(<Harness />);
    const pdf = new File(['x'], 'plan.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByTestId('photo-file-input'), { target: { files: [pdf] } });
    await waitFor(() =>
      expect(screen.getByText(/not an image/)).toBeInTheDocument(),
    );
    expect(h.uploadBytes).not.toHaveBeenCalled();
  });

  it('an upload in flight survives the photos step unmounting (pipeline owned by the page, PR #331 round 3)', async () => {
    let resolveUpload!: () => void;
    h.uploadBytes.mockImplementationOnce(() => new Promise<void>((res) => (resolveUpload = res)));
    const { rerender } = renderWithProviders(<Harness />);
    pickFile();
    await waitFor(() => expect(h.uploadBytes).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Uploading...')).toBeInTheDocument();

    // Back press: the STEP unmounts; the page-hosted pipeline does not.
    rerender(<Harness showStep={false} />);
    expect(screen.getByText('other-step')).toBeInTheDocument();

    // The upload finishes while the parent is on another step, and the
    // poll fetches the thumbnail in the background.
    await act(async () => {
      resolveUpload();
    });

    // Returning to the step shows the READY thumbnail — never the
    // permanently stuck 'Uploading...' tile the step-local hook produced.
    rerender(<Harness showStep />);
    await waitFor(() => expect(screen.getByTestId('photo-thumb')).toBeInTheDocument());
    expect(screen.queryByText('Uploading...')).toBeNull();
  });

  it('Retry during an IN-FLIGHT poll leaves one live chain (generation guard, PR #331 round 2)', async () => {
    vi.useFakeTimers();
    // First poll hangs (a cold function start); everything after is the
    // normal not-found retry signal.
    let rejectFirst!: (e: unknown) => void;
    h.getOwnPhotoUrl
      .mockImplementationOnce(() => new Promise((_res, rej) => (rejectFirst = rej)))
      .mockImplementation(notFound);
    renderWithProviders(<Harness />);
    pickFile();

    // Flush the upload; the first poll is dispatched and STILL in flight —
    // no timer exists yet, which is exactly the window the round-1
    // timer-clear missed.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(h.getOwnPhotoUrl).toHaveBeenCalledTimes(1);

    // Retry while in flight: a fresh chain dispatches (call 2)...
    fireEvent.click(screen.getByText('Retry'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(h.getOwnPhotoUrl).toHaveBeenCalledTimes(2);

    // ...and the STALE chain's late rejection must no-op (generation
    // bumped), never arm a second timer.
    await act(async () => {
      rejectFirst(Object.assign(new Error('nf'), { code: 'functions/not-found' }));
      await vi.advanceTimersByTimeAsync(0);
    });

    // One interval later exactly ONE re-poll fires — two live chains would
    // fire two.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PHOTO_POLL_INTERVAL_MS);
    });
    expect(h.getOwnPhotoUrl).toHaveBeenCalledTimes(3);
  });

  it('Retry mid-poll clears the pending timer — ONE chain, not two (PR #221 lesson)', async () => {
    vi.useFakeTimers();
    h.getOwnPhotoUrl.mockImplementation(notFound);
    renderWithProviders(<Harness />);
    pickFile();

    // Flush upload + first (rejected) poll → a re-poll timer is armed.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(h.getOwnPhotoUrl).toHaveBeenCalledTimes(1);

    // Manual Retry while that timer is pending: must clear it and start a
    // single fresh chain.
    fireEvent.click(screen.getByText('Retry'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(h.getOwnPhotoUrl).toHaveBeenCalledTimes(2);

    // One interval later exactly ONE re-poll fires (two chains would fire
    // two).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PHOTO_POLL_INTERVAL_MS);
    });
    expect(h.getOwnPhotoUrl).toHaveBeenCalledTimes(3);
  });

  it('renders the page-level bounce-back notice above the step when given', () => {
    renderWithProviders(
      <HarnessWithNotice notice="One of your photos is still being prepared. Wait until every thumbnail shows, then publish again." />,
    );
    expect(screen.getByText(/still being prepared/)).toBeInTheDocument();
  });

  it('refuses a 7th photo (≤6, §4.1)', async () => {
    const six: PhotoItem[] = Array.from({ length: 6 }, (_, i) => ({
      photoId: `p${i}`,
      state: 'ready',
      url: `u${i}`,
    }));
    renderWithProviders(<Harness initialPhotos={six} />);
    // The add tile disappears at the cap — the input is the only way in,
    // and the hook still refuses.
    expect(screen.queryByText('Add a photo')).toBeNull();
    pickFile();
    await waitFor(() => expect(screen.getByText('At most 6 photos.')).toBeInTheDocument());
    expect(h.uploadBytes).not.toHaveBeenCalled();
  });
});
