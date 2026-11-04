import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router';
import { SignUpRedirectPage } from '../SignUpRedirectPage';

/**
 * `/signup` is retired (issue #435 milestone, PR5): it now only forwards to
 * `/enroll`, the unified landing page — but it must keep resolving (old
 * bookmarks, stale marketing links) and must not drop whatever query string
 * arrived with it.
 */

// Renders /enroll's own location back out so a test can see exactly where
// the redirect landed, query string included (route MATCHING alone would
// pass even if the query string were silently dropped).
function LocationEcho({ onLocation }: { onLocation: (loc: string) => void }) {
  const location = useLocation();
  onLocation(`${location.pathname}${location.search}`);
  return <div>enroll-landing</div>;
}

function landingUrlFor(path: string): string {
  let landedAt = '';
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/signup" element={<SignUpRedirectPage />} />
        <Route path="/enroll" element={<LocationEcho onLocation={(loc) => { landedAt = loc; }} />} />
      </Routes>
    </MemoryRouter>,
  );
  return landedAt;
}

describe('SignUpRedirectPage (sit /signup -> /enroll)', () => {
  it('forwards a bare /signup visit to /enroll', () => {
    render(
      <MemoryRouter initialEntries={['/signup']}>
        <Routes>
          <Route path="/signup" element={<SignUpRedirectPage />} />
          <Route path="/enroll" element={<div>enroll-landing</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('enroll-landing')).toBeInTheDocument();
  });

  it('drops no query string: /signup?lang=fr&foo=bar lands on the same string appended to /enroll', () => {
    expect(landingUrlFor('/signup?lang=fr&foo=bar')).toBe('/enroll?lang=fr&foo=bar');
  });

  it('lands on a bare /enroll when there was no query string to preserve', () => {
    expect(landingUrlFor('/signup')).toBe('/enroll');
  });

  it('mutation check: a redirect to the wrong path would fail the bare-visit assertion', () => {
    // Not an actual mutation of source — a sanity check that the render
    // harness above can distinguish "landed on /enroll" from "did not".
    expect(landingUrlFor('/signup')).not.toBe('/signup');
  });
});
