/**
 * Sit's i18n prefix for cross-app endorsement origin labels (issue #280).
 *
 * Shared by every sit surface that renders the shared `references` list
 * (SearchPage results, ExpandableBabysitterCard) so the two cannot drift onto
 * different copy for the same badge. The key itself is derived per source app
 * by `endorsementLabelKey` in shared-core, so a fourth product needs no edit
 * here — only its locale strings.
 */
export const SIT_ORIGIN_LABEL_PREFIX = 'references.from';
