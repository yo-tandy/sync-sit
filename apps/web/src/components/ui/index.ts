// Curated re-exports for sync-sit consumers. Shared primitives come from
// @ejm/shared-ui (15 names below); sync-sit-only UI stays local.
//
// Names NOT in this barrel — consumers import them directly:
//   DateTag, PhotoLightbox → @/components/ui/DateTag, @/components/ui/PhotoLightbox
//   Icons (all 23)         → @/components/ui/Icons
//   AppBar, EnrollmentAppBar, PushPrompt → not in shared-ui yet (deferred,
//     see docs/superpowers/plans/2026-05-18-shared-ui-extraction.md Q1)
export {
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  Chip,
  Dialog,
  InfoBanner,
  Input,
  LanguageSelector,
  Select,
  Spinner,
  StepIndicator,
  Textarea,
  TopNav,
} from '@ejm/shared-ui';

// sync-sit-only:
export { InstallAppBanner } from './InstallAppBanner';
