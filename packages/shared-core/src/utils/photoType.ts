/**
 * Is this `File.type` acceptable for a profile photo?
 *
 * DENYLIST, not an allowlist -- the same call `storage.rules` documents for
 * verification documents (issue #281). PR #450 first made it for the
 * unified-enrollment photo step (`StepAdditionalInfo`); this is that helper's
 * shared home, and the step now imports it from here rather than keeping its
 * own copy. Browsers report `File.type` inconsistently,
 * giving `''` or `application/octet-stream` for perfectly valid files on some
 * OS/browser combos. An allowlist rejects those, and the worst case here is
 * precisely the common one: iPhone HEIC/HEIF frequently arrives with an empty
 * type, so an allowlist told a user photographing themselves on an iPhone
 * that their own photo was "not a supported image" (issue #452 -- the same
 * bug on the three shipped AccountPages).
 *
 * So: treat an absent/generic type as UNKNOWN and accept it, and reject only
 * what the browser positively identifies as something other than an image.
 * This is UX guidance, not a security control -- the bytes are never trusted
 * on the strength of a client-asserted MIME string; server-side enforcement
 * (where it exists at all) is storage.rules.
 */
export function isAcceptablePhotoType(type: string): boolean {
  // Normalise ONCE, up front (PR #450 review, a7ceb155). Doing it per-branch
  // invited a bug where the `application/octet-stream` branch compared the
  // RAW string while the image check compared a normalised one: a browser
  // reporting 'Application/Octet-Stream' (or with stray padding) would then
  // miss the unknown-type branch and get rejected by the image check
  // instead -- the exact opposite of this function's intent. Real browsers
  // report File.type lowercase per spec, but the whole reason this is a
  // denylist is that File.type is not reliably what the spec says.
  const t = type.toLowerCase().trim();
  if (!t || t === 'application/octet-stream') return true;
  if (!t.startsWith('image/')) return false;
  // ...with one carve-out: image/svg+xml is a scriptable document that renders
  // live, which is exactly what storage.rules' #281 denylist exists to reject.
  // Matching the `+xml` suffix rather than the one spelling, for the same
  // reason that rule does (Firefox treats every *+xml media type as an XML
  // document).
  return !t.includes('+xml');
}

/** Extensions this app already lets through the (now-removed) allowlist,
 *  mapped to the content type Storage/browsers expect for them. Used only to
 *  fill in a MISSING/generic `File.type` -- never to override a type the
 *  browser positively reported, and never consulted by `isAcceptablePhotoType`
 *  itself (that function's whole point is not needing this map to decide
 *  accept/reject). */
const EXT_CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  gif: 'image/gif',
};

/**
 * The content type to upload a photo with. `File.type` is trusted whenever
 * it is a real, specific value; when it is empty or the generic
 * `application/octet-stream` -- the exact shape `isAcceptablePhotoType` now
 * accepts but the browser gave no useful type for -- fall back to a guess
 * from the filename extension (issue #452). Storage's own `profile-photos/`
 * rule does not gate on contentType, so this is not needed to pass the
 * upload; it is needed so the object is actually SERVED with an image
 * Content-Type header afterwards, so `<img>` tags render it rather than
 * offering a download of an "octet-stream".
 *
 * Falls back to `application/octet-stream` when even the extension is
 * unrecognised -- honest about not knowing, rather than guessing wrong.
 */
export function resolvePhotoContentType(fileName: string, fileType: string): string {
  const t = fileType.toLowerCase().trim();
  if (t && t !== 'application/octet-stream') return t;
  const ext = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : '';
  return EXT_CONTENT_TYPES[ext] ?? 'application/octet-stream';
}
