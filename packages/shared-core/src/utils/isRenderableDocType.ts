/**
 * Server-side (Node/TS) mirror of the `isRenderableDocType` denylist encoded
 * in `storage.rules` (issue #281 / #287). Storage rules can enforce this on
 * a DIRECT client write, but a signed-URL-mediated upload (issue #471, and
 * #447's proposed verification-document equivalent) never evaluates rules
 * at all — the caller authenticates as the service account — so the
 * denylist has to be re-checked in the callable that MINTS the signed URL,
 * before it is issued.
 *
 * Deliberately a DENYLIST, not an allowlist, matching the rules helper: browsers
 * report `File.type` inconsistently (empty or `application/octet-stream` for
 * valid photos/PDFs on some OS/browser combos), so an allowlist would reject
 * legitimate uploads. The denied types are the ones a browser renders as a
 * live, scriptable document when served back inline: `text/html` directly,
 * and XML documents — `text/xml`, `application/xml`, and any `*+xml` type
 * (`image/svg+xml`, `application/xhtml+xml`, …) since Firefox treats every
 * `+xml` media type as XML and SVG/XHTML script directly.
 *
 * `null`/`undefined`/empty-string content types are NOT renderable per this
 * check (GCS serves those as octet-stream, which downloads rather than
 * renders) — kept permissive on purpose, mirroring the rules helper's
 * null-safe `.get`/no-match fallthrough.
 */
export function isRenderableDocType(contentType: string | null | undefined): boolean {
  if (!contentType) return false;
  const t = contentType.toLowerCase().trim();
  return (
    t.startsWith('text/html')
    || t.startsWith('text/xml')
    || t.startsWith('application/xml')
    || t.includes('+xml')
  );
}
