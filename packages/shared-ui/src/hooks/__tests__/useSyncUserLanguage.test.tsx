import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import type { ReactNode } from 'react';
import { createTestI18n } from '../../test-utils/i18n.js';
import { useSyncUserLanguage } from '../useSyncUserLanguage.js';

afterEach(cleanup);

function setup(uid: string | null, write = vi.fn().mockResolvedValue(undefined)) {
  const i18n = createTestI18n();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
  );
  const hook = renderHook(({ uid }) => useSyncUserLanguage(uid, write), { wrapper, initialProps: { uid } });
  return { i18n, write, hook };
}

describe('useSyncUserLanguage', () => {
  it('writes the new language for the signed-in user when the UI language changes', async () => {
    const { i18n, write } = setup('u1');
    await act(async () => {
      await i18n.changeLanguage('fr');
    });
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('fr');
  });

  it('never writes on mount — the doc is not overwritten with whatever the browser was set to', () => {
    const { write } = setup('u1');
    expect(write).not.toHaveBeenCalled();
  });

  it('holds a change seen while signed out and writes it once the user arrives (handoff ordering)', async () => {
    // HandoffPage switches i18n to the minted `lang` BEFORE redeeming the
    // code and signing in — the only language signal that parent may ever
    // give. It must not be dropped.
    const { i18n, write, hook } = setup(null);
    await act(async () => {
      await i18n.changeLanguage('fr');
    });
    expect(write).not.toHaveBeenCalled();

    hook.rerender({ uid: 'u1' });
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('fr');

    await act(async () => {
      await i18n.changeLanguage('en');
    });
    expect(write).toHaveBeenCalledWith('en');
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('a plain sign-in with NO prior change writes nothing (the doc is not overwritten with the browser default)', () => {
    const { write, hook } = setup(null);
    hook.rerender({ uid: 'u1' });
    expect(write).not.toHaveBeenCalled();
  });

  it('the held change is consumed once: a second sign-in does not replay it', async () => {
    const { i18n, write, hook } = setup(null);
    await act(async () => {
      await i18n.changeLanguage('fr');
    });
    hook.rerender({ uid: 'u1' });
    hook.rerender({ uid: null });
    hook.rerender({ uid: 'u2' });
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('collapses a repeated change to the same language into one write', async () => {
    const { i18n, write } = setup('u1');
    await act(async () => {
      await i18n.changeLanguage('fr');
      await i18n.changeLanguage('fr');
    });
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('normalises regional codes to the two supported languages', async () => {
    const { i18n, write } = setup('u1');
    await act(async () => {
      await i18n.changeLanguage('fr-FR');
    });
    expect(write).toHaveBeenCalledWith('fr');
  });

  it('retries on the next change after a failed write (the memo is cleared)', async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { i18n } = setup('u1', write);
    await act(async () => {
      await i18n.changeLanguage('fr');
    });
    await act(async () => {
      await i18n.changeLanguage('en');
      await i18n.changeLanguage('fr');
    });
    // fr (failed), en, fr (retried after the failure cleared the memo).
    expect(write.mock.calls.map((c) => c[0])).toEqual(['fr', 'en', 'fr']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('stops listening on unmount', async () => {
    const { i18n, write, hook } = setup('u1');
    hook.unmount();
    await act(async () => {
      await i18n.changeLanguage('fr');
    });
    expect(write).not.toHaveBeenCalled();
  });
});
