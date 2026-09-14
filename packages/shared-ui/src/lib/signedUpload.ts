/** What a membership-checked signed-URL-minting callable returns
 *  (createFamilyPhotoUploadUrl, issue #471; createVerificationDocumentUploadUrl,
 *  issue #447). */
export interface SignedUploadResponse {
  /** The short-lived V4 signed PUT URL to send the file bytes to. */
  url: string;
  /** The object's final Storage path, for the caller to persist. */
  path: string;
}

/**
 * PUTs `file` straight to a signed URL obtained from a membership-checked
 * upload callable, mirroring `FamilySettingsPage`'s `uploadFamilyPhoto`
 * (issue #471) — factored out here so #447's verification-document upload
 * (used from BOTH apps/web's and apps/study-web's VerificationPage) does not
 * duplicate it. This package has no firebase dependency, so callers invoke
 * the `httpsCallable` themselves and pass the resolved `{ url, path }` in.
 *
 * Binds the SAME `Content-Type` and `x-goog-content-length-range` headers
 * the server signed into the URL — both are bound into the V4 signature, so
 * either mismatching or missing means GCS rejects the PUT with
 * `SignatureDoesNotMatch`. `x-goog-content-length-range` is the REAL size
 * cap: GCS enforces it against the actual bytes sent, unlike the
 * caller-declared `sizeBytes` the callable only fast-fails on.
 *
 * A failed/rejected PUT is tagged with `code: 'upload/network'` (neither a
 * rejected `fetch` nor a non-2xx response carries a `storage/*` or
 * `functions/*` code on its own), which `uploadErrorKey` (`@ejm/shared-core`)
 * recognizes and maps to the connection-problem copy.
 *
 * Resolves with `signed.path` on success — callers persist that (Firestore
 * doc, download-URL construction, …) the same way they did before this
 * signed-URL flow existed.
 */
export async function putToSignedUrl(
  signed: SignedUploadResponse,
  file: File,
  contentType: string,
  maxBytes: number,
): Promise<string> {
  let putRes: Response;
  try {
    putRes = await fetch(signed.url, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        'x-goog-content-length-range': `0,${maxBytes}`,
      },
      body: file,
    });
  } catch (err) {
    throw Object.assign(new Error('Upload failed (network error)'), {
      code: 'upload/network',
      cause: err,
    });
  }
  if (!putRes.ok) {
    throw Object.assign(new Error(`Upload failed (${putRes.status})`), {
      code: 'upload/network',
    });
  }
  return signed.path;
}
