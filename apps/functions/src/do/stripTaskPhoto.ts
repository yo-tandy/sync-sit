import { onObjectFinalized } from 'firebase-functions/v2/storage';
import { getStorage } from 'firebase-admin/storage';
import sharp from 'sharp';
import { DO_PHOTO_ID_RE } from '@ejm/do-core';
import { DO_UPLOADS_PREFIX, photoObjectPath } from './taskAccess.js';

/**
 * `doStripTaskPhoto` (plan §7.4, §8, §11.2): the quarantine→strip→republish
 * leg of the photo pipeline. Fires on every finalized object and acts only
 * under `do-uploads/{uid}/{uploadId}`:
 *
 * 1. Downloads the quarantine original (client-written under the §7.4
 *    owner-scoped rule).
 * 2. Strips ALL metadata — EXIF (a geotagged photo of a front door is an
 *    address leak, §11.2), ICC beyond the rendered pixels, XMP — by
 *    re-encoding the raster through sharp. `.rotate()` first applies the
 *    EXIF orientation to the pixels, so stripping the tag cannot turn
 *    portraits sideways.
 * 3. Republishes to `do-photos/{uid}/{photoId}` with `photoId == uploadId`
 *    — the client-chosen return leg (§7.4): safe because both prefixes are
 *    keyed by the caller's own uid, so a colliding or hostile id can only
 *    clobber the caller's own objects, and reusing the id is what lets the
 *    wizard render thumbnails from a prefix it can neither read nor list.
 * 4. Deletes the quarantine original.
 *
 * FAILS CLOSED on anything that is not a decodable raster image: the
 * storage rule's `image/*` contentType check is client-asserted metadata,
 * so hostile bytes labelled `image/jpeg` WILL arrive — the stripper deletes
 * the quarantine object and STOPS (never throw-and-refire: a deterministic
 * decode failure would crash-loop on every retry). Genuine infra errors
 * (download/save transport failures) still throw, where a retry is
 * productive.
 *
 * Never a loop: its own output lands under `do-photos/`, which the prefix
 * guard ignores.
 */
export const doStripTaskPhoto = onObjectFinalized(
  {
    region: 'europe-west1',
    // sharp holds the decoded raster in memory; 512MiB covers a 10MB
    // upload's decoded pixels with headroom.
    memory: '512MiB',
  },
  async (event) => {
    const name = event.data.name;
    if (!name || !name.startsWith(DO_UPLOADS_PREFIX)) {
      return; // not quarantine — profile photos, verification docs, our own output
    }
    const bucket = getStorage().bucket(event.data.bucket);
    const file = bucket.file(name);

    /** The fail-closed exit: remove the quarantine object, never republish. */
    const rejectQuarantine = async (why: string): Promise<void> => {
      console.warn(`doStripTaskPhoto: rejecting ${name}: ${why}`);
      await file.delete({ ignoreNotFound: true });
    };

    const parts = name.split('/');
    if (parts.length !== 3 || !parts[1] || !parts[2]) {
      // Nested or malformed path — the rules only allow the two-segment
      // shape, so this is console/raw-API residue. Fail closed.
      await rejectQuarantine('malformed quarantine path');
      return;
    }
    const [, uid, uploadId] = parts;
    if (!DO_PHOTO_ID_RE.test(uploadId)) {
      // An id outside the wizard's UUID charset could never be referenced
      // by a task (do-core's validateTaskPhotos rejects it at doPostTask),
      // so republishing it would only mint an unreachable object.
      await rejectQuarantine('uploadId outside the photo-id charset');
      return;
    }

    // The rules bound uploads to <10MB, but the Admin SDK and the console
    // bypass rules — re-assert the bound before decoding.
    const size = Number(event.data.size);
    if (!Number.isFinite(size) || size >= 10 * 1024 * 1024) {
      await rejectQuarantine(`size ${event.data.size} outside the 10MB bound`);
      return;
    }

    let original: Buffer;
    try {
      [original] = await file.download();
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code === 404) {
        // Retried event after the original was already consumed or swept —
        // nothing to do.
        return;
      }
      throw err; // transport error: retry is productive
    }

    // Decode + re-encode. sharp writes NO metadata unless withMetadata()
    // is called — the re-encode itself is the strip.
    const REPUBLISHABLE = new Set(['jpeg', 'png', 'webp', 'gif', 'avif']);
    let stripped: Buffer;
    let format: string;
    try {
      const image = sharp(original);
      const meta = await image.metadata();
      if (!meta.format || !REPUBLISHABLE.has(meta.format)) {
        // Decodable but not a format the pipeline republishes (svg is
        // scriptable, pdf/heif are not board photos): fail closed.
        await rejectQuarantine(`unsupported format ${meta.format ?? 'unknown'}`);
        return;
      }
      format = meta.format;
      // .rotate() bakes the EXIF orientation into the pixels; output format
      // defaults to the input format.
      stripped = await image.rotate().toBuffer();
    } catch (err) {
      // Deterministic decode failure — hostile or corrupt bytes labelled
      // image/*. Delete and stop; throwing would re-fire forever (§8).
      await rejectQuarantine(
        `not a decodable image (${(err as Error).message})`,
      );
      return;
    }

    // Republish under the final prefix with a SERVER-set contentType (the
    // sniffed format, not the client's claim), then delete the original.
    await bucket.file(photoObjectPath(uid, uploadId)).save(stripped, {
      resumable: false,
      metadata: { contentType: `image/${format}` },
    });
    await file.delete({ ignoreNotFound: true });
    console.log(
      `doStripTaskPhoto: republished ${name} -> ${photoObjectPath(uid, uploadId)} (${format}, ${stripped.length} bytes)`,
    );
  },
);
