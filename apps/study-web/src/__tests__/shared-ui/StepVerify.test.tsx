import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { StepVerify } from '@ejm/shared-ui';
import i18n from '@/i18n';

// Round 5 (issue #148): the code-entry step always renders a static
// "already have an account? log in" exit hint. It shows on BOTH the fresh
// and silent existing-account paths, so it distinguishes nothing — but it
// gives a silent-path user (who will never receive a code) a way out.
describe('StepVerify login hint (issue #148)', () => {
  it('always renders the no-code hint with a /login link', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <StepVerify
            ejemEmail="someone28@ejm.org"
            onVerify={async () => {}}
            onResend={async () => {}}
            error={null}
          />
        </MemoryRouter>
      </I18nextProvider>,
    );

    expect(screen.getByText(/If you already have an account/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'log in' });
    expect(link).toHaveAttribute('href', '/login');
  });
});

// Issue #155 (PR #180 review): the resend button is where a user burns the
// authed own-email bypass allowance, and handleResend used to swallow ALL
// failures — the one failure the user can act on (the send cap) must be
// surfaced, while transport errors stay swallowed as before.
describe('StepVerify resend error surfacing (issue #155)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function renderVerify(onResend: () => Promise<void>) {
    return render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <StepVerify
            ejemEmail="someone28@ejm.org"
            onVerify={async () => {}}
            onResend={onResend}
            error={null}
          />
        </MemoryRouter>
      </I18nextProvider>,
    );
  }

  // The resend button only appears once the initial 60s cooldown elapses.
  async function elapseCooldown() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
  }

  it('surfaces the send-cap rejection as the translated message and keeps the cooldown ticking', async () => {
    const onResend = vi
      .fn()
      .mockRejectedValue({ code: 'functions/failed-precondition', details: { reason: 'send-cap' } });
    renderVerify(onResend);
    await elapseCooldown();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: i18n.t('auth.resendCode') }));
    });

    expect(onResend).toHaveBeenCalledTimes(1);
    expect(screen.getByText(i18n.t('enrollment.sendCapReached'))).toBeInTheDocument();
    // The cooldown was NOT reset to 0 (an immediate retry cannot succeed
    // within the hour) — the resend button is hidden behind the timer again.
    expect(screen.queryByRole('button', { name: i18n.t('auth.resendCode') })).toBeNull();
  });

  it('still swallows a transport error: no message, cooldown reset so the user can retry immediately', async () => {
    const onResend = vi.fn().mockRejectedValue(new Error('network down'));
    renderVerify(onResend);
    await elapseCooldown();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: i18n.t('auth.resendCode') }));
    });

    expect(screen.queryByText('network down')).toBeNull();
    expect(screen.queryByText(i18n.t('enrollment.sendCapReached'))).toBeNull();
    // Cooldown reset to 0 — the resend button is immediately available.
    expect(screen.getByRole('button', { name: i18n.t('auth.resendCode') })).toBeInTheDocument();
  });
});

// Issue #250 round 5: the countdown itself must follow the resendCooldownS
// prop -- start value, post-resend re-arm, and the mount race where the
// configured value resolves only after useState captured the default (the
// sync effect extends, never shortens, a running countdown).
describe('StepVerify configured resend cooldown (issue #250)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function renderWithCooldown(resendCooldownS?: number) {
    return render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <StepVerify
            ejemEmail="someone28@ejm.org"
            onVerify={async () => {}}
            onResend={async () => {}}
            error={null}
            resendCooldownS={resendCooldownS}
          />
        </MemoryRouter>
      </I18nextProvider>,
    );
  }

  it('starts the countdown at the configured value, not the code default', () => {
    renderWithCooldown(600);
    expect(screen.getByText(i18n.t('auth.resendIn', { seconds: 600 }))).toBeInTheDocument();
  });

  it('extends a running countdown when the configured value arrives after mount', async () => {
    const view = renderWithCooldown(undefined); // config unresolved: default 60
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.getByText(i18n.t('auth.resendIn', { seconds: 50 }))).toBeInTheDocument();
    // The config read resolves to 600 mid-countdown: 10s elapsed, 590 remain.
    view.rerender(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <StepVerify
            ejemEmail="someone28@ejm.org"
            onVerify={async () => {}}
            onResend={async () => {}}
            error={null}
            resendCooldownS={600}
          />
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(screen.getByText(i18n.t('auth.resendIn', { seconds: 590 }))).toBeInTheDocument();
  });

  it('re-arms the post-resend cooldown at the configured value', async () => {
    renderWithCooldown(90);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(91_000);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: i18n.t('auth.resendCode') }));
    });
    expect(screen.getByText(i18n.t('auth.resendIn', { seconds: 90 }))).toBeInTheDocument();
  });
});
