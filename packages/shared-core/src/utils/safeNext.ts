/**
 * Validates an in-app relative path for use as a cross-app handoff
 * destination (issue #426).
 *
 * The handoff mints a session, so an unvalidated destination on it is an
 * OPEN REDIRECT against a freshly authenticated user — the highest-value
 * kind, since the victim lands already signed in. `safeNext` is pure and
 * side-effect-free so BOTH the minting side (defense in depth) and the
 * receiving side can call it, but the fragment is attacker-controllable
 * regardless of who minted the handoff — the caller on the RECEIVING app
 * (the one that will actually navigate) must always run this itself rather
 * than trust a value it did not validate.
 *
 * Accepted shape, `rawNext`:
 * - a single leading `/` (not `//`, not a scheme, not `/\`);
 * - no backslash anywhere;
 * - no whitespace or control characters;
 * - no `..` path segments (defense against prefix-match traversal below);
 * - decodes cleanly with `decodeURIComponent` — a malformed percent-escape
 *   is rejected — and the DECODED string is re-validated against every rule
 *   above, so an encoded attack (`/%2Fevil.com` decoding to `//evil.com`, or
 *   `/%5Cevil.com` decoding to `/\evil.com`) is caught after decoding even
 *   though the raw string looks like a plain path.
 *
 * A path clearing every structural rule is STILL rejected unless its
 * pathname (query/hash stripped) falls under one of `allowedPrefixes` — a
 * fixed route table beats a regex on attacker-controlled input, per the
 * issue. Prefixes match exactly or as a `prefix/`-rooted subpath.
 *
 * Returns the validated (decoded) path, or `null` — callers must fall back
 * to their normal post-login destination on `null`, and must never render or
 * echo the rejected raw value.
 */
export function safeNext(
  rawNext: string | null | undefined,
  allowedPrefixes: readonly string[],
): string | null {
  if (!rawNext) return null;
  if (!structurallySafe(rawNext)) return null;

  let decoded: string;
  try {
    decoded = decodeURIComponent(rawNext);
  } catch {
    return null; // malformed percent-escape — does not decode cleanly
  }
  if (!structurallySafe(decoded)) return null;

  const pathname = decoded.split(/[?#]/)[0];
  const allowed = allowedPrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  return allowed ? decoded : null;
}

/** Rules applied identically to the raw string and its decoded form. */
function structurallySafe(value: string): boolean {
  if (value.length === 0) return false;
  // Control characters (incl. tab/newline) and any whitespace.
  if (/[\s\x00-\x1f\x7f]/.test(value)) return false;
  // Backslashes are a browser-parsing footgun (some treat `/\` like `//`).
  if (value.includes('\\')) return false;
  // Exactly one leading slash — not scheme-relative (`//host`), not absent.
  if (!value.startsWith('/') || value.startsWith('//')) return false;
  // No path traversal — also closes a prefix-match bypass such as
  // `/family/sessions/../../evil`, which would otherwise pass the
  // allowlist's `startsWith(prefix + '/')` check.
  if (value.includes('..')) return false;
  // No embedded scheme (`/javascript:alert(1)` still starts with a single
  // `/` and would otherwise slip past every rule above).
  if (/^\/[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return false;
  return true;
}
