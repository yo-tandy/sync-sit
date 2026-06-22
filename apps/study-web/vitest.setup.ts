// Vitest setup for apps/study-web — wires @testing-library/jest-dom matchers
// into Vitest's expect, and registers RTL DOM cleanup after each test.
// (With `globals: false`, RTL's automatic afterEach cleanup is not
// auto-installed, so we register it explicitly to avoid DOM bleed between
// tests.) Placed at the app root (not under src/) so the app's
// `tsc -b && vite build` does not compile it as application code.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
