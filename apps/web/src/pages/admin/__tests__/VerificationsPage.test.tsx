import { describe, it, expect, vi, beforeEach } from 'vitest';

// Avoid initializing the real Firebase app in jsdom.
vi.mock('@/config/firebase', () => ({ functions: {} }));
vi.mock('firebase/functions', () => ({ httpsCallable: vi.fn() }));

// Controllable verification store state.
const storeState: {
  pendingVerifications: Record<string, unknown>[];
  pendingLoading: boolean;
  fetchPendingVerifications: ReturnType<typeof vi.fn>;
  reviewVerification: ReturnType<typeof vi.fn>;
} = {
  pendingVerifications: [],
  pendingLoading: false,
  fetchPendingVerifications: vi.fn(),
  reviewVerification: vi.fn(),
};
vi.mock('@/stores/verificationStore', () => ({
  useVerificationStore: () => storeState,
}));

import i18n from '@/i18n';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { afterEach } from 'vitest';
import { MemoryRouter } from 'react-router';
import { AdminVerificationsPage } from '../VerificationsPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <AdminVerificationsPage />
    </MemoryRouter>,
  );
}

describe('AdminVerificationsPage family verification review', () => {
  beforeEach(() => {
    i18n.changeLanguage('en');
    storeState.pendingVerifications = [];
    storeState.pendingLoading = false;
    storeState.fetchPendingVerifications = vi.fn();
    storeState.reviewVerification = vi.fn();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders a family enrollment doc with family fields (regression)', () => {
    storeState.pendingVerifications = [
      {
        id: 'f1',
        type: 'ejm_enrollment',
        status: 'pending',
        familyName: 'The Smiths',
        parentName: 'Bob Smith',
        familyParentNames: ['Bob Smith'],
        familyKids: [{ firstName: 'Kid', age: 5 }],
        fileUrl: 'https://storage.googleapis.com/b/o/verification-documents%2Ff.pdf?alt=media',
        fileName: 'f.pdf',
        createdAt: '2026-07-01T00:00:00Z',
      },
    ];
    renderPage();

    expect(screen.getByText('The Smiths')).toBeInTheDocument();
    expect(screen.getByText('Bob Smith')).toBeInTheDocument();
    expect(screen.getByText(i18n.t('verification.registeredFamily'))).toBeInTheDocument();
  });

  it('offers only the family types in the type filter (tutor identity retired)', () => {
    renderPage();
    expect(
      screen.getByRole('option', { name: i18n.t('verification.typeIdentity') }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: i18n.t('verification.typeEnrollment') }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /tutor/i })).not.toBeInTheDocument();
  });

  it('offers the Superseded status filter and refetches with it (issue #218)', () => {
    // The one user-visible surface of the supersede feature: without this
    // option an admin cannot see the docs a community grant closed. Pins both
    // the option and the wiring, so a dropped locale key or a dropped filter
    // value fails here rather than silently rendering an empty label.
    renderPage();
    const option = screen.getByRole('option', {
      name: i18n.t('verification.status_superseded'),
    }) as HTMLOptionElement;
    expect(option).toBeInTheDocument();
    expect(option.value).toBe('superseded');

    fireEvent.change(option.closest('select')!, { target: { value: 'superseded' } });
    expect(storeState.fetchPendingVerifications).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 'superseded' }),
    );
  });
});

describe('AdminVerificationsPage view-document error surfacing', () => {
  beforeEach(() => {
    i18n.changeLanguage('en');
    storeState.pendingVerifications = [
      {
        id: 'v1',
        type: 'identity',
        status: 'pending',
        familyName: 'Dupont',
        fileUrl:
          'https://firebasestorage.googleapis.com/v0/b/sync-sit.appspot.com/o/verification-documents%2Ffam1%2Fid.pdf',
        fileName: 'id.pdf',
        createdAt: '2026-07-01T00:00:00Z',
      },
    ];
    storeState.pendingLoading = false;
    storeState.fetchPendingVerifications = vi.fn();
    storeState.reviewVerification = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  /**
   * Issue #292: the document is fetched with DOWNLOAD semantics -- a
   * programmatic anchor click, not window.open (which flashed a tab and
   * was popup-blockable after the await). Spy captures the href of every
   * anchor clicked programmatically.
   */
  function spyOnAnchorClicks(): string[] {
    const hrefs: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      hrefs.push(this.href);
    });
    return hrefs;
  }

  it('surfaces an inline error and never falls back to the raw fileUrl when the callable fails', async () => {
    const { httpsCallable } = await import('firebase/functions');
    (httpsCallable as ReturnType<typeof vi.fn>).mockReturnValue(
      vi.fn().mockRejectedValue(new Error('internal')),
    );
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    const hrefs = spyOnAnchorClicks();

    renderPage();
    const { fireEvent, waitFor } = await import('@testing-library/react');
    fireEvent.click(screen.getByText(i18n.t('verification.viewDocument')));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        i18n.t('verification.viewDocumentError'),
      ),
    );
    // The old masking fallback (opening the raw fileUrl) must be gone --
    // by EITHER mechanism.
    expect(openSpy).not.toHaveBeenCalled();
    expect(hrefs).toEqual([]);
  });

  it('DOWNLOADS the signed URL (not the raw fileUrl) on success and shows no error', async () => {
    const { httpsCallable } = await import('firebase/functions');
    const fn = vi.fn().mockResolvedValue({ data: { url: 'https://signed.example/u' } });
    (httpsCallable as ReturnType<typeof vi.fn>).mockReturnValue(fn);
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    const hrefs = spyOnAnchorClicks();

    renderPage();
    const { fireEvent, waitFor } = await import('@testing-library/react');
    fireEvent.click(screen.getByText(i18n.t('verification.viewDocument')));

    await waitFor(() => expect(hrefs).toEqual(['https://signed.example/u']));
    expect(fn).toHaveBeenCalledWith({ filePath: 'verification-documents/fam1/id.pdf' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // Issue #292 regression guard: the popup mechanism must not come back
    // -- window.open flashed a tab (Safari left it behind) and was
    // popup-blockable after the await.
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('leaves the admin page in place: the anchor is targetless and removed after the click', async () => {
    const { httpsCallable } = await import('firebase/functions');
    (httpsCallable as ReturnType<typeof vi.fn>).mockReturnValue(
      vi.fn().mockResolvedValue({ data: { url: 'https://signed.example/u' } }),
    );
    let seenTarget: string | null = null;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      // No target: the server's Content-Disposition: attachment (PR #285)
      // makes this a download rather than a navigation, so the queue stays.
      seenTarget = this.getAttribute('target');
    });

    renderPage();
    const { fireEvent, waitFor } = await import('@testing-library/react');
    fireEvent.click(screen.getByText(i18n.t('verification.viewDocument')));

    await waitFor(() => expect(seenTarget).toBe(null));
    // Nothing is left in the DOM afterwards.
    expect(document.querySelectorAll('a[download]')).toHaveLength(0);
  });

  it('surfaces an error for an unparseable fileUrl instead of opening it raw', async () => {
    storeState.pendingVerifications[0].fileUrl = 'https://example.com/no-object-segment';
    const { httpsCallable } = await import('firebase/functions');
    const fn = vi.fn();
    (httpsCallable as ReturnType<typeof vi.fn>).mockReturnValue(fn);
    const openSpy = vi.spyOn(window, 'open').mockReturnValue({} as Window);
    const hrefs = spyOnAnchorClicks();

    renderPage();
    const { fireEvent, waitFor } = await import('@testing-library/react');
    fireEvent.click(screen.getByText(i18n.t('verification.viewDocument')));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(fn).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
    expect(hrefs).toEqual([]);
  });

  // The old 'popup-blocked open surfaces an error' pin is GONE with the
  // mechanism it guarded: an anchor download cannot be popup-blocked, so
  // there is no null-return failure to surface (issue #292). A blocked
  // popup was the failure mode; removing the popup removes the mode. The
  // real error path -- a failing callable -- keeps its own pin above, and
  // the success pin asserts window.open is never called again.
  it('carries the document filename as the download hint when one is known', async () => {
    const { httpsCallable } = await import('firebase/functions');
    (httpsCallable as ReturnType<typeof vi.fn>).mockReturnValue(
      vi.fn().mockResolvedValue({ data: { url: 'https://signed.example/u' } }),
    );
    let seenDownload: string | null = null;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      seenDownload = this.getAttribute('download');
    });

    renderPage();
    const { fireEvent, waitFor } = await import('@testing-library/react');
    fireEvent.click(screen.getByText(i18n.t('verification.viewDocument')));

    // Advisory only cross-origin (browsers ignore it; the server's
    // Content-Disposition does the work) -- pinned so a same-origin
    // future, or a filename regression, is visible.
    await waitFor(() => expect(seenDownload).toBe('id.pdf'));
  });
});
