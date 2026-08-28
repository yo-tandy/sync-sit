import { describe, it, expect, beforeEach, vi } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from '@/__tests__/test-utils';

/**
 * Wizard integration pins (plan §9.1 bullet 1):
 * - step sequencing in §9.1's order, Next gated per step;
 * - considerations rendered ALONGSIDE the description (§5 surface 1);
 * - the review step's §11.2 publish warning + decision-15 liability line;
 * - the doPostTask payload shape (timing group omits other models' fields;
 *   photos ship as {uid, photoId} pairs);
 * - address_required → the decision-17 in-wizard address panel, draft kept;
 * - task_cap → the cap copy.
 */

const h = vi.hoisted(() => ({
  auth: {
    firebaseUser: { uid: 'parent-1' } as unknown,
    userDoc: { uid: 'parent-1', profiles: { parent: { familyId: 'fam1' } } } as unknown,
    loading: false,
  },
  callable: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('@/config/firebase', () => ({ db: {}, functions: {}, storage: {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (payload: unknown) => h.callable(name, payload),
}));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  updateDoc: vi.fn(() => Promise.resolve()),
  serverTimestamp: () => ({ __serverTimestamp: true }),
}));
vi.mock('firebase/storage', () => ({
  ref: vi.fn(),
  uploadBytes: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: Object.assign(
    (selector?: (s: typeof h.auth) => unknown) => (selector ? selector(h.auth) : h.auth),
    { getState: () => h.auth },
  ),
}));
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return { ...actual, useNavigate: () => h.navigate };
});

import { PostTaskPage } from '../PostTaskPage';

const next = () => fireEvent.click(screen.getByRole('button', { name: 'Next' }));

/** Walk the wizard to the review step with a valid deadline draft. */
function walkToReview() {
  fireEvent.click(screen.getByRole('button', { name: 'Ikea assembly' }));
  next();
  fireEvent.click(screen.getByRole('button', { name: 'Assembly from instructions' }));
  next();
  fireEvent.click(screen.getByRole('button', { name: /^Deadline/ }));
  fireEvent.change(screen.getByLabelText('Done by *'), { target: { value: '2036-09-15' } });
  next();
  fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'Assemble PAX' } });
  fireEvent.change(screen.getByLabelText('Description *'), {
    target: { value: 'Two wardrobes, instructions included.' },
  });
  next();
  next(); // photos (none)
  fireEvent.click(screen.getByRole('button', { name: 'Yes, an adult will be present' }));
  next();
  next(); // tools/transport defaults
  next(); // budget empty
}

beforeEach(() => {
  vi.clearAllMocks();
  h.callable.mockResolvedValue({ data: { taskId: 'task-1' } });
});

describe('PostTaskPage sequencing + gating', () => {
  it('walks §9.1 step order, gating Next per step', () => {
    renderWithProviders(<PostTaskPage />);

    // Step 1: category — Next disabled until a pick.
    expect(screen.getByText('What kind of task?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Ikea assembly' }));
    next();

    // Step 2: sub-category.
    expect(screen.getByText('More precisely?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Assembly from instructions' }));
    next();

    // Step 3: timing — a past date keeps Next disabled (the client-side
    // not-past guard).
    expect(screen.getByText('When?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Deadline/ }));
    fireEvent.change(screen.getByLabelText('Done by *'), { target: { value: '2020-01-01' } });
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Done by *'), { target: { value: '2036-09-15' } });
    next();

    // Step 4: describe — considerations render ALONGSIDE the free text.
    expect(screen.getByText('Describe the task')).toBeInTheDocument();
    expect(screen.getByText('Things worth covering')).toBeInTheDocument();
    // One §5 ikea consideration, from do-core's content module.
    expect(screen.getByText(/instructions and all the parts/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'Assemble PAX' } });
    fireEvent.change(screen.getByLabelText('Description *'), { target: { value: 'Two wardrobes.' } });
    next();

    // Step 5: photos (optional) → 6: adult present → 7: tools → 8: budget → 9: review.
    expect(screen.getByText(/Up to 6 photos/)).toBeInTheDocument();
    next();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'No, the student works alone' }));
    next();
    expect(screen.getByText('Tools')).toBeInTheDocument();
    next();
    expect(screen.getByLabelText(/Suggested budget/)).toBeInTheDocument();
    next();
    expect(screen.getByText('Ready to publish?')).toBeInTheDocument();
  });

  it("requires the §5.7 alone-at-home acknowledgement for pet drop-in with 'no'", () => {
    renderWithProviders(<PostTaskPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Pet & house-sitting' }));
    next();
    fireEvent.click(screen.getByRole('button', { name: 'Drop-in checks on an empty flat' }));
    next();
    fireEvent.click(screen.getByRole('button', { name: /Ongoing/ }));
    fireEvent.change(screen.getByLabelText('From *'), { target: { value: '2036-09-01' } });
    // cadenceKind defaults to weekly (its chip shows selected as '✓ Weekly').
    fireEvent.click(screen.getByRole('button', { name: /Weekly/ }));
    fireEvent.click(screen.getByRole('button', { name: /Mon/ }));
    next();
    fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'Check the flat' } });
    fireEvent.change(screen.getByLabelText('Description *'), { target: { value: 'Water plants, check post.' } });
    next();
    next(); // photos
    fireEvent.click(screen.getByRole('button', { name: 'No, the student works alone' }));
    // Gated on the acknowledgement.
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  it('shows the §5.4 childcare interstitial for kids-entertainment, linking out to sync-sit', () => {
    renderWithProviders(<PostTaskPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Party help' }));
    next();
    fireEvent.click(screen.getByRole('button', { name: /Kids' entertainment/ }));
    expect(screen.getByText(/childcare/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Sync/Sit' })).toBeInTheDocument();
  });
});

describe('PostTaskPage review + publish', () => {
  it('pins the §11.2 publish warning and the decision-15 liability line on review', () => {
    renderWithProviders(<PostTaskPage />);
    walkToReview();
    expect(
      screen.getByText(/visible to every enrolled EJM student/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/your address is never shown/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Insurance, accidents and any damage are your family's responsibility/i),
    ).toBeInTheDocument();
  });

  it('publishes with the exact doPostTask payload shape (timing group only, no null-filling)', async () => {
    renderWithProviders(<PostTaskPage />);
    walkToReview();
    fireEvent.click(screen.getByRole('button', { name: 'Publish task' }));
    await waitFor(() => expect(h.callable).toHaveBeenCalledWith('doPostTask', {
      category: 'ikea',
      subCategory: 'ikea_assembly',
      title: 'Assemble PAX',
      description: 'Two wardrobes, instructions included.',
      photos: [],
      timing: 'deadline',
      dueDate: '2036-09-15',
      estimatedHours: null,
      suggestedBudget: null,
      adultPresent: 'yes',
      toolsProvided: null,
      transportNeeded: false,
    }));
    await waitFor(() =>
      expect(h.navigate).toHaveBeenCalledWith('/family/tasks/task-1', { replace: true }),
    );
  });

  it('address_required swaps review for the decision-17 address panel and keeps the draft', async () => {
    renderWithProviders(<PostTaskPage />);
    walkToReview();
    h.callable.mockRejectedValueOnce(
      Object.assign(new Error('address'), {
        code: 'functions/failed-precondition',
        details: { reason: 'address_required' },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Publish task' }));
    await waitFor(() =>
      expect(screen.getByText('Complete your address first')).toBeInTheDocument(),
    );
    // Back to review: the draft survived the detour.
    fireEvent.click(screen.getByRole('button', { name: 'Back to review' }));
    expect(screen.getByText('Assemble PAX')).toBeInTheDocument();
  });

  it('maps task_cap to the cap copy', async () => {
    renderWithProviders(<PostTaskPage />);
    walkToReview();
    h.callable.mockRejectedValueOnce(
      Object.assign(new Error('cap'), {
        code: 'functions/resource-exhausted',
        details: { reason: 'task_cap' },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Publish task' }));
    await waitFor(() =>
      expect(screen.getByText(/maximum number of open tasks/i)).toBeInTheDocument(),
    );
  });

  it('maps permission-denied to the verification copy', async () => {
    renderWithProviders(<PostTaskPage />);
    walkToReview();
    h.callable.mockRejectedValueOnce(
      Object.assign(new Error('denied'), { code: 'functions/permission-denied' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Publish task' }));
    await waitFor(() =>
      expect(screen.getByText(/must be verified before posting/i)).toBeInTheDocument(),
    );
  });
});
