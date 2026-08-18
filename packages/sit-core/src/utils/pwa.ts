// isRunningAsPWA was promoted to @ejm/shared-core (issue #168 Phase 1) so
// study-web can share the PWA detection. This re-export keeps every existing
// `import { isRunningAsPWA } from '@ejm/sit-core'` consumer compiling.
export { isRunningAsPWA } from '@ejm/shared-core';
