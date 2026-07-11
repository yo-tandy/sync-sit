import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

// Hoisted, test-controllable store state. The page consumes the store module,
// so we mock it and drive each verification state through `h.state`.
const h = vi.hoisted(() => ({
  state: {
    verification: null as { identityStatus: string } | null,
    documents: [] as Array<{
      id: string;
      status: string;
      fileName?: string;
      rejectionReason?: string;
      createdAt?: string;
    }>,
    loading: false,
    uploading: false,
    error: null as string | null,
  },
  fetchStatus: vi.fn(() => Promise.resolve()),
  submit: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/stores/verificationStore', () => ({
  useVerificationStore: () => ({
    verification: h.state.verification,
    documents: h.state.documents,
    loading: h.state.loading,
    uploading: h.state.uploading,
    error: h.state.error,
    fetchStatus: h.fetchStatus,
    submit: h.submit,
  }),
}));

import { VerificationPage } from '../VerificationPage';

function reset(state: Partial<typeof h.state>) {
  h.state.verification = null;
  h.state.documents = [];
  h.state.loading = false;
  h.state.uploading = false;
  h.state.error = null;
  Object.assign(h.state, state);
  h.fetchStatus.mockClear();
  h.submit.mockClear();
}

describe('tutor VerificationPage', () => {
  beforeEach(() => reset({}));

  it('fetches status on mount', () => {
    renderWithProviders(<VerificationPage />);
    expect(h.fetchStatus).toHaveBeenCalled();
  });

  it('not_submitted: shows the upload CTA and a file input', () => {
    reset({ verification: { identityStatus: 'not_submitted' }, documents: [] });
    renderWithProviders(<VerificationPage />);
    expect(screen.getByText(/upload your id/i)).toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeInTheDocument();
  });

  it('renders not_submitted when verification is absent (pre-#77 tutor)', () => {
    reset({ verification: null, documents: [] });
    renderWithProviders(<VerificationPage />);
    expect(document.querySelector('input[type="file"]')).toBeInTheDocument();
  });

  it('pending: shows under-review message and no file input', () => {
    reset({
      verification: { identityStatus: 'pending' },
      documents: [{ id: 'd1', status: 'pending', fileName: 'id.pdf', createdAt: '2026-07-01' }],
    });
    renderWithProviders(<VerificationPage />);
    expect(screen.getByText(/under review/i)).toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).not.toBeInTheDocument();
  });

  it('rejected: shows the rejection reason from the latest document and a resubmit input', () => {
    reset({
      verification: { identityStatus: 'rejected' },
      documents: [
        { id: 'd2', status: 'rejected', fileName: 'id.pdf', rejectionReason: 'Photo is blurry', createdAt: '2026-07-02' },
      ],
    });
    renderWithProviders(<VerificationPage />);
    expect(screen.getByText('Photo is blurry')).toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeInTheDocument();
  });

  it('approved: shows the approved message and no file input', () => {
    reset({
      verification: { identityStatus: 'approved' },
      documents: [{ id: 'd3', status: 'approved', fileName: 'id.pdf', createdAt: '2026-07-03' }],
    });
    renderWithProviders(<VerificationPage />);
    expect(screen.getByText(/verified/i)).toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).not.toBeInTheDocument();
  });

  it('submit is called with the chosen file, then status is refetched', async () => {
    reset({ verification: { identityStatus: 'not_submitted' }, documents: [] });
    renderWithProviders(<VerificationPage />);
    h.fetchStatus.mockClear();

    const file = new File(['x'], 'my-id.png', { type: 'image/png' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    fireEvent.click(screen.getByRole('button', { name: /upload/i }));

    await waitFor(() => expect(h.submit).toHaveBeenCalledWith(file));
    await waitFor(() => expect(h.fetchStatus).toHaveBeenCalled());
  });

  it('rejects a file over 10MB without calling submit', () => {
    reset({ verification: { identityStatus: 'not_submitted' }, documents: [] });
    renderWithProviders(<VerificationPage />);

    const big = new File(['x'], 'big.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [big] } });

    fireEvent.click(screen.getByRole('button', { name: /upload/i }));
    expect(h.submit).not.toHaveBeenCalled();
    expect(screen.getByText(/maximum size is 10\s*MB/i)).toBeInTheDocument();
  });
});
