import { describe, it, expect, vi } from 'vitest';

let captured: Record<string, unknown> = {};
vi.mock('@ejm/shared-ui', () => ({
  ForgotPasswordPage: (props: Record<string, unknown>) => {
    captured = props;
    return null;
  },
}));

const h = vi.hoisted(() => ({ resetPassword: vi.fn(), clearError: vi.fn() }));
vi.mock('@/stores/authStore', () => {
  const state = { resetPassword: h.resetPassword, error: 'oops', clearError: h.clearError };
  const useAuthStore = () => state;
  useAuthStore.getState = () => state;
  return { useAuthStore };
});

import { render } from '@testing-library/react';
import { ForgotPasswordPage } from '../ForgotPasswordPage';

describe('study ForgotPasswordPage wrapper', () => {
  it('wires the authStore resetPassword + error into the shared page', () => {
    render(<ForgotPasswordPage />);
    expect(captured.onSubmit).toBe(h.resetPassword);
    expect(captured.clearError).toBe(h.clearError);
    expect(captured.error).toBe('oops');
  });
});
