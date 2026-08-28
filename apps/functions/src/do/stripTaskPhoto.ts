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
 * (download/save transport failures) still throw — and `retry: true` is
 * set so the re-fire actually happens: gen-2 event functions default to
 * retry DISABLED, under which a transient GCS blip would strand the photo
 * in quarantine forever ("still processing" in the wizard until the sweep
 * eats it). Retry is safe here precisely because every deterministic
 * failure is caught and deleted — only transport errors ever throw.
 *
 * Never a loop: its own output lands under `do-photos/`, which the prefix
 * guard ignores.
 */

/**
 * Decode ceiling in pixels (~50MP — beyond any phone camera). The rule's
 * 10MB bound caps the COMPRESSED size only: a small PNG/WebP can declare
 * enormous dimensions and decompress to a ~1GB raster that OOM-kills the
 * instance mid-`toBuffer()` — skipping the catch, so `rejectQuarantine`
 * never runs and the fail-closed property silently dies. With the ceiling,
 * sharp throws a normal Error at decode time and the existing catch turns
 * a decompression bomb into the documented delete-and-stop.
 */
const MAX_INPUT_PIXELS = 50_000_000;

/**
 * Output raster bound (longest edge, px). Board photos never render larger;
 * bounding the OUTPUT collapses the re-encode's time and memory profile so
 * a legitimately huge input (a 45MP AVIF is an ordinary phone file) cannot
 * ride the decode ceiling into a deadline kill.
 */
const MAX_OUTPUT_EDGE = 2048;

/**
 * Retry bailout: `retry: true` re-fires transport failures, but a failure
 * that kills the PROCESS (deadline, OOM) never reaches the catch — so a
 * deterministic one would ride the retry window indefinitely. An event
 * older than this is therefore consumed fail-closed (delete + stop): any
 * failure mode, including ones not yet imagined, self-terminates within
 * the hour instead of crash-looping for Eventarc's full retry window.
 */
const EVENT_MAX_AGE_MS = 60 * 60 * 1000;

export const doStripTaskPhoto = onObjectFinalized(
  {
    region: 'europe-west1',
    // sharp holds the decoded raster in memory: MAX_INPUT_PIXELS × 4 bytes
    // ≈ 200MB worst case, plus the (output-bounded) encode buffer.
    memory: '512MiB',
    // Explicit, not the 60s gen-2 default: a worst-case decode at the
    // pixel ceiling plus a bounded re-encode fits comfortably, and the
    // deadline is what turns "slow" into a process kill that skips the
    // fail-closed path.
    timeoutSeconds: 120,
    retry: true, // see docstring — transport errors must re-fire
  },
  async (event) => {
    const name = event.data.name;
    if (!name || !name.startsWith(DO_UPLOADS_PREFIX)) {
      return; // not quarantine — profile photos, verification docs, our own output
    }
    const bucket = getStorage().bucket(event.data.bucket);
    const file = bucket.file(name);

    // Retry-window bailout (see EVENT_MAX_AGE_MS): an event still failing
    // an hour after the upload is deterministically stuck — consume it
    // fail-closed rather than paying for another lap.
    const eventAgeMs = Date.now() - Date.parse(event.time ?? '');
    if (Number.isFinite(eventAgeMs) && eventAgeMs > EVENT_MAX_AGE_MS) {
      console.warn(`doStripTaskPhoto: consuming stuck event for ${name} (age ${Math.round(eventAgeMs / 60000)}m)`);
      await file.delete({ ignoreNotFound: true });
      return;
    }

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

    // A photoId that already published must not be silently REPLACED: the
    // id is client-chosen, so without this a parent could re-upload
    // different bytes for an id already attached to a task — including an
    // `assigned`/`completed` task doUpdateTask refuses to edit — and swap
    // the photos a doer accepted on. First-write-wins; a client replacing
    // a wizard photo mints a fresh UUID anyway. (On a RETRIED event whose
    // save landed but whose original-delete didn't, this branch performs
    // exactly the missing cleanup.)
    const finalFile = bucket.file(photoObjectPath(uid, uploadId));
    if ((await finalFile.exists())[0]) {
      await rejectQuarantine('photoId already published (first write wins)');
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
    // is called — the re-encode itself is the strip. Output codec is
    // NORMALIZED, never round-tripped from the input: an AVIF input must
    // not force an AVIF (libaom) encode, which at tens of megapixels
    // routinely exceeds the function deadline — the deterministic-timeout
    // crash-loop the fail-closed design rules out. jpeg/png/webp encode in
    // their own (fast) codecs; avif lands as webp (keeps alpha), gif as
    // png (first frame, keeps alpha — board photos, not animations). svg
    // is deliberately ABSENT: prebuilt sharp decodes it, it is scriptable,
    // and the read legs sign inline-rendering URLs — the §11.2 read-path
    // safety rests on this map never emitting a scriptable type.
    const OUTPUT_FORMAT: Record<string, 'jpeg' | 'png' | 'webp'> = {
      jpeg: 'jpeg',
      png: 'png',
      webp: 'webp',
      avif: 'webp',
      gif: 'png',
    };
    let stripped: Buffer;
    let outFormat: 'jpeg' | 'png' | 'webp';
    try {
      const image = sharp(original, { limitInputPixels: MAX_INPUT_PIXELS });
      const meta = await image.metadata();
      const mapped = meta.format ? OUTPUT_FORMAT[meta.format] : undefined;
      if (!mapped) {
        // Decodable but not a format the pipeline republishes (svg is
        // scriptable, pdf/heif are not board photos): fail closed.
        await rejectQuarantine(`unsupported format ${meta.format ?? 'unknown'}`);
        return;
      }
      outFormat = mapped;
      // .rotate() bakes the EXIF orientation into the pixels; the resize
      // bounds the OUTPUT raster (board photos never render larger), which
      // collapses the encode's time and memory profile the same way
      // limitInputPixels bounds the decode's.
      stripped = await image
        .rotate()
        .resize(MAX_OUTPUT_EDGE, MAX_OUTPUT_EDGE, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .toFormat(outFormat)
        .toBuffer();
    } catch (err) {
      // Deterministic decode failure — hostile or corrupt bytes labelled
      // image/*. Delete and stop; throwing would re-fire forever (§8).
      await rejectQuarantine(
        `not a decodable image (${(err as Error).message})`,
      );
      return;
    }

    // Republish under the final prefix with a SERVER-set contentType (the
    // normalized output format, never the client's claim), then delete the
    // original.
    await finalFile.save(stripped, {
      resumable: false,
      metadata: { contentType: `image/${outFormat}` },
    });
    await file.delete({ ignoreNotFound: true });
    console.log(
      `doStripTaskPhoto: republished ${name} -> ${photoObjectPath(uid, uploadId)} (${outFormat}, ${stripped.length} bytes)`,
    );
  },
);
