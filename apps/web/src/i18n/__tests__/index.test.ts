import { describe, it, expect } from 'vitest';
import i18n from '../index';

/**
 * study/do's /signup redirect (issue #435 milestone, PR5) hands off
 * cross-origin to `${SIT_APP_URL}/enroll?lang=xx` to carry the visitor's
 * language across the origin switch (localStorage doesn't cross origins).
 * For that to actually change what the visitor sees, this app's detector
 * must read the `lang` query param — and read it BEFORE localStorage, since
 * a first-time cross-origin arrival has no local record of the choice yet.
 */
describe('i18n language detection (issue #435 milestone, PR5)', () => {
  it('checks the querystring lang param before localStorage/navigator', () => {
    const detection = i18n.options.detection as { order?: string[]; lookupQuerystring?: string };
    expect(detection.order?.[0]).toBe('querystring');
    expect(detection.lookupQuerystring).toBe('lang');
  });

  it('still falls back to localStorage then navigator (unchanged for in-app navigation)', () => {
    const detection = i18n.options.detection as { order?: string[] };
    expect(detection.order).toEqual(['querystring', 'localStorage', 'navigator']);
  });
});
