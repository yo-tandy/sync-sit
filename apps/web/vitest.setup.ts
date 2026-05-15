// Vitest setup for apps/web.
//
// Imported via vitest.config.ts -> test.setupFiles. Wires
// @testing-library/jest-dom matchers (toBeInTheDocument, toHaveTextContent,
// toBeVisible, ...) into Vitest's expect so component and hook tests can
// use them naturally.
//
// Placed at apps/web root (not under src/) so the app's `tsc -b && vite
// build` does not try to compile it as application code.
import '@testing-library/jest-dom/vitest';
