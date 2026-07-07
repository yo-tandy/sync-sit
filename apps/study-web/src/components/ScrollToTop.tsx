import { useEffect } from 'react';
import { useLocation } from 'react-router';

/**
 * Scrolls to the top of the page on every route change.
 * Fixes iOS Safari retaining scroll position after navigation/login.
 */
export function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}
