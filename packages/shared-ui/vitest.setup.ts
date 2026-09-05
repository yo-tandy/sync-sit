// Vitest setup for @ejm/shared-ui.
//
// Imported via vitest.config.ts -> test.setupFiles. Wires
// @testing-library/jest-dom matchers (toBeInTheDocument, toHaveTextContent,
// toBeVisible, ...) into Vitest's expect, mirroring apps/web/vitest.setup.ts.
//
// Placed at the package root (not under src/) so `tsc --noEmit` (the
// package's typecheck script) doesn't try to compile it as library code.
import '@testing-library/jest-dom/vitest';
