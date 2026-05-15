// Harness sanity check for apps/web's vitest setup.
//
// This is NOT a product test. Its only job is to fail loudly if the
// vitest + jsdom + React 19 + @testing-library/jest-dom wiring is
// broken, so that real tests (Phase -1 lint-cleanup verification and
// onwards) can rely on the harness.
//
// Owned by agent-8-tester; do not extend with product assertions —
// per Agent 8's brief, product tests go under
// src/<feature>/__tests__/.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

describe('vitest harness sanity', () => {
  it('renders a React element into jsdom', () => {
    render(<div data-testid="probe">hello world</div>);
    expect(screen.getByTestId('probe')).toBeInTheDocument();
  });

  it('reads text content via jest-dom matchers', () => {
    render(<span>sync-study</span>);
    expect(screen.getByText('sync-study')).toHaveTextContent('sync-study');
  });
});
