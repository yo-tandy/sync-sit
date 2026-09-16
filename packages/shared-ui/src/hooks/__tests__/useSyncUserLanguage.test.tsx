import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { emitUserLanguageChange } from '../../i18n/userLanguage.js';
import { useSyncUserLanguage } from '../useSyncUserLanguage.js';

afterEach(cleanup);

function setup(uid: string | null, write = vi.fn().mockResolvedValue(undefined)) {
  const hook = renderHook(({ uid }) => useSyncUserLanguage(uid, write), { initialProps: { uid } });
  return { write, hook };
}

describe('useSyncUserLanguage', () => {
  it('writes the picked language for the signed-in user', async () => {
    const { write } = setup('u1');
    await act(async () => {
      emitUserLanguageChange('fr');
    });
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('fr');
  });

  it('never writes on mount or on sign-in — only an explicit pick writes', () => {
    const { write, hook } = setup(null);
    hook.rerender({ uid: 'u1' });
    expect(write).not.toHaveBeenCalled();
  });

  it('a pick while signed out is dropped, never replayed onto whoever signs in next (#518 review)', async () => {
    const { write, hook } = setup(null);
    await act(async () => {
      emitUserLanguageChange('fr');
    });
    hook.rerender({ uid: 'u1' });
    expect(write).not.toHaveBeenCalled();

    await act(async () => {
      emitUserLanguageChange('en');
    });
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('en');
  });

  it('collapses a repeated pick of the same language into one write', async () => {
    const { write } = setup('u1');
    await act(async () => {
      emitUserLanguageChange('fr');
      emitUserLanguageChange('fr');
    });
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('retries on the next pick after a failed write (the memo is cleared)', async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setup('u1', write);
    await act(async () => {
      emitUserLanguageChange('fr');
    });
    await act(async () => {
      emitUserLanguageChange('en');
      emitUserLanguageChange('fr');
    });
    expect(write.mock.calls.map((c) => c[0])).toEqual(['fr', 'en', 'fr']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('a new uid gets its own memo: the same language is written again for the next account', async () => {
    const { write, hook } = setup('u1');
    await act(async () => {
      emitUserLanguageChange('fr');
    });
    hook.rerender({ uid: 'u2' });
    await act(async () => {
      emitUserLanguageChange('fr');
    });
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('stops listening on unmount', async () => {
    const { write, hook } = setup('u1');
    hook.unmount();
    await act(async () => {
      emitUserLanguageChange('fr');
    });
    expect(write).not.toHaveBeenCalled();
  });
});
