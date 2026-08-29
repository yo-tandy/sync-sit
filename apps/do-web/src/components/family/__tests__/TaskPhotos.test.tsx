import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';
import type { TaskDoc } from '@ejm/do-core';

/**
 * TaskPhotos (§7.4 option 1, family side): every render signs through
 * doGetTaskPhotoUrl — the locked final prefix has no direct read path.
 * Pins: the per-photo call shape ({taskId, photoId} from the STORED pair),
 * the loading state, the deliberate silent degradation on a failed sign
 * (fewer thumbnails, no error), decorative empty alt, and the null render
 * for a photo-less task.
 */

const h = vi.hoisted(() => ({
  getTaskPhotoUrl: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ db: {}, functions: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => {
    if (name !== 'doGetTaskPhotoUrl') throw new Error(`unexpected callable ${name}`);
    return h.getTaskPhotoUrl(payload);
  },
}));

import { TaskPhotos } from '../TaskPhotos';

function task(photos: { uid: string; photoId: string }[]): TaskDoc {
  return { taskId: 'task1', photos } as unknown as TaskDoc;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.getTaskPhotoUrl.mockImplementation(({ photoId }: { photoId: string }) =>
    Promise.resolve({ data: { url: `https://signed/${photoId}` } }),
  );
});

describe('TaskPhotos (doGetTaskPhotoUrl signing)', () => {
  it('signs each stored {uid, photoId} pair via the callable and renders the thumbnails', async () => {
    renderWithProviders(
      <TaskPhotos task={task([{ uid: 'parentA', photoId: 'ph-1' }, { uid: 'parentB', photoId: 'ph-2' }])} />,
    );
    await waitFor(() => expect(screen.getAllByTestId('task-photo')).toHaveLength(2));
    // Call shape: taskId + photoId — the SERVER reconstructs the path from
    // the stored pair; the client never passes the uid half.
    expect(h.getTaskPhotoUrl).toHaveBeenCalledTimes(2);
    expect(h.getTaskPhotoUrl).toHaveBeenCalledWith({ taskId: 'task1', photoId: 'ph-1' });
    expect(h.getTaskPhotoUrl).toHaveBeenCalledWith({ taskId: 'task1', photoId: 'ph-2' });

    const imgs = screen.getAllByTestId('task-photo');
    expect(imgs.map((img) => img.getAttribute('src'))).toEqual([
      'https://signed/ph-1',
      'https://signed/ph-2',
    ]);
    // Decorative images: empty alt keeps screen readers from announcing
    // filenames/URLs.
    for (const img of imgs) expect(img).toHaveAttribute('alt', '');
    expect(screen.getByText('Photos')).toBeInTheDocument();
  });

  it('shows the loading state while the signing calls are in flight', async () => {
    let resolveSign!: (v: unknown) => void;
    h.getTaskPhotoUrl.mockReturnValueOnce(new Promise((res) => (resolveSign = res)));
    const { container } = renderWithProviders(
      <TaskPhotos task={task([{ uid: 'parentA', photoId: 'ph-1' }])} />,
    );
    expect(container.querySelector('.animate-spin')).toBeTruthy();
    resolveSign({ data: { url: 'https://signed/ph-1' } });
    await waitFor(() => expect(screen.getByTestId('task-photo')).toBeInTheDocument());
  });

  it('degrades silently on a failed sign — fewer thumbnails, no error surface', async () => {
    h.getTaskPhotoUrl.mockImplementation(({ photoId }: { photoId: string }) =>
      photoId === 'ph-1'
        ? Promise.reject(Object.assign(new Error('denied'), { code: 'functions/permission-denied' }))
        : Promise.resolve({ data: { url: `https://signed/${photoId}` } }),
    );
    renderWithProviders(
      <TaskPhotos task={task([{ uid: 'parentA', photoId: 'ph-1' }, { uid: 'parentB', photoId: 'ph-2' }])} />,
    );
    await waitFor(() => expect(screen.getAllByTestId('task-photo')).toHaveLength(1));
    expect(screen.getByTestId('task-photo')).toHaveAttribute('src', 'https://signed/ph-2');
    // Photos are illustrative here, never load-bearing — no error copy.
    expect(screen.queryByText(/error|could not/i)).toBeNull();
  });

  it('renders nothing at all for a photo-less task', () => {
    renderWithProviders(<TaskPhotos task={task([])} />);
    // No section heading, no thumbnails, no signing calls (the ToastProvider
    // wrapper contributes an sr-only live region, so assert on content).
    expect(screen.queryByText('Photos')).toBeNull();
    expect(screen.queryByTestId('task-photo')).toBeNull();
    expect(h.getTaskPhotoUrl).not.toHaveBeenCalled();
  });
});
