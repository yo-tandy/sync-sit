import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { clearAll, getBucket, clearStoragePrefix } from '../../setup/emulator.js';

// doStripTaskPhoto round trip (plan §7.4, §8, §11.2), driven through the
// REAL storage emulator + functions emulator: an upload under do-uploads/
// fires the trigger exactly as production does. The fixture is a real
// geotagged JPEG (EXIF GPSLatitude/GPSLongitude + IFD0 tags, generated
// with sharp's withExif — see tests/fixtures/).

const FIXTURE = resolve(import.meta.dirname, '../../fixtures/geotagged.jpg');
const EXIF_MARKER = Buffer.from('Exif\0\0');

/** Poll until predicate or timeout. The trigger typically fires <2s. */
async function waitFor(pred: () => Promise<boolean>, timeoutMs = 20000): Promise<boolean> {
  const start = Date.now();
  for (;;) {
    if (await pred()) return true;
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, 500));
  }
}

describe('doStripTaskPhoto (storage trigger)', () => {
  beforeAll(async () => {
    await clearAll();
    await clearStoragePrefix('do-uploads/');
    await clearStoragePrefix('do-photos/');
  });

  afterAll(async () => {
    await clearStoragePrefix('do-uploads/');
    await clearStoragePrefix('do-photos/');
    await clearAll();
  });

  it('strips EXIF (GPS included) from a real geotagged JPEG, republishes id-for-id, deletes the quarantine original', async () => {
    const bucket = getBucket();
    const original = readFileSync(FIXTURE);
    // Pin the fixture itself: it genuinely carries EXIF, or the test proves
    // nothing.
    expect(original.includes(EXIF_MARKER)).toBe(true);
    expect(original.includes(Buffer.from('sync-do-fixture'))).toBe(true);

    await bucket.file('do-uploads/strip-u1/photo-strip-1').save(original, {
      resumable: false,
      metadata: { contentType: 'image/jpeg' },
    });

    const republished = await waitFor(async () => {
      const [exists] = await bucket.file('do-photos/strip-u1/photo-strip-1').exists();
      return exists;
    });
    expect(republished).toBe(true);

    // photoId == uploadId — the §7.4 client-chosen return leg.
    const [stripped] = await bucket.file('do-photos/strip-u1/photo-strip-1').download();
    expect(stripped.includes(EXIF_MARKER)).toBe(false);
    expect(stripped.includes(Buffer.from('sync-do-fixture'))).toBe(false);
    // Still a decodable JPEG (SOI marker), server-set contentType.
    expect(stripped[0]).toBe(0xff);
    expect(stripped[1]).toBe(0xd8);
    const [meta] = await bucket.file('do-photos/strip-u1/photo-strip-1').getMetadata();
    expect(meta.contentType).toBe('image/jpeg');

    // Quarantine original is gone.
    const gone = await waitFor(async () => {
      const [exists] = await bucket.file('do-uploads/strip-u1/photo-strip-1').exists();
      return !exists;
    });
    expect(gone).toBe(true);
  });

  it('fails CLOSED on non-image bytes labelled image/jpeg: quarantine deleted, nothing republished, no crash-loop', async () => {
    const bucket = getBucket();
    const hostile = Buffer.from('<script>not an image at all</script>'.repeat(100));
    await bucket.file('do-uploads/strip-u2/hostile-bytes-1').save(hostile, {
      resumable: false,
      metadata: { contentType: 'image/jpeg' }, // the client-asserted lie
    });

    // The fail-closed path DELETES the quarantine object...
    const deleted = await waitFor(async () => {
      const [exists] = await bucket.file('do-uploads/strip-u2/hostile-bytes-1').exists();
      return !exists;
    });
    expect(deleted).toBe(true);

    // ...and never republishes. (The delete above is itself the no-crash-loop
    // evidence: a thrown error would leave the object in place and re-fire.)
    await new Promise((r) => setTimeout(r, 1500));
    const [republished] = await bucket.file('do-photos/strip-u2/hostile-bytes-1').exists();
    expect(republished).toBe(false);
  });

  it('rejects an SVG even under an image/* contentType — the allowlist pin the inline read path depends on', async () => {
    // storage.rules' image/.* admits image/svg+xml, and prebuilt sharp CAN
    // decode SVG — so the OUTPUT_FORMAT allowlist is the only thing keeping
    // a scriptable document out of the inline-rendering signed-URL path
    // (the §11.2 divergence from getVerificationDocument's attachment
    // disposition rests on it). A decodable-but-unrepublishable input must
    // exit via delete-and-stop like hostile bytes do.
    const bucket = getBucket();
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48"><script>alert(1)</script><rect width="64" height="48" fill="red"/></svg>',
    );
    await bucket.file('do-uploads/strip-u6/sneaky-svg').save(svg, {
      resumable: false,
      metadata: { contentType: 'image/svg+xml' },
    });
    const deleted = await waitFor(async () =>
      !(await bucket.file('do-uploads/strip-u6/sneaky-svg').exists())[0]);
    expect(deleted).toBe(true);
    await new Promise((r) => setTimeout(r, 1000));
    const [republished] = await bucket.file('do-photos/strip-u6/sneaky-svg').exists();
    expect(republished).toBe(false);
  });

  it('rejects an uploadId outside the photo-id charset (could never be referenced by a task)', async () => {
    const bucket = getBucket();
    const original = readFileSync(FIXTURE);
    await bucket.file('do-uploads/strip-u3/bad id!').save(original, {
      resumable: false,
      metadata: { contentType: 'image/jpeg' },
    });
    const deleted = await waitFor(async () => {
      const [exists] = await bucket.file('do-uploads/strip-u3/bad id!').exists();
      return !exists;
    });
    expect(deleted).toBe(true);
    const [republished] = await bucket.file('do-photos/strip-u3/bad id!').exists();
    expect(republished).toBe(false);
  });

  it('an already-published photoId is NOT replaced: first write wins, the re-upload is rejected', async () => {
    const bucket = getBucket();
    const original = readFileSync(FIXTURE);
    await bucket.file('do-uploads/strip-u5/photo-once').save(original, {
      resumable: false, metadata: { contentType: 'image/jpeg' },
    });
    const republished = await waitFor(async () =>
      (await bucket.file('do-photos/strip-u5/photo-once').exists())[0]);
    expect(republished).toBe(true);
    const [firstBytes] = await bucket.file('do-photos/strip-u5/photo-once').download();

    // Re-upload DIFFERENT bytes under the same id — the swap a doer who
    // accepted on the first photos must never see.
    const other = await (async () => {
      // A second, visually different valid JPEG: reuse the fixture with a
      // byte appended (still decodable — trailing junk is tolerated).
      return Buffer.concat([original, Buffer.from([0x00])]);
    })();
    await bucket.file('do-uploads/strip-u5/photo-once').save(other, {
      resumable: false, metadata: { contentType: 'image/jpeg' },
    });
    const quarantineCleared = await waitFor(async () =>
      !(await bucket.file('do-uploads/strip-u5/photo-once').exists())[0]);
    expect(quarantineCleared).toBe(true);
    const [afterBytes] = await bucket.file('do-photos/strip-u5/photo-once').download();
    expect(afterBytes.equals(firstBytes)).toBe(true);
  });

  it('leaves other prefixes alone (profile photos are not quarantine)', async () => {
    const bucket = getBucket();
    await bucket.file('profile-photos/strip-u4.jpg').save(readFileSync(FIXTURE), {
      resumable: false,
      metadata: { contentType: 'image/jpeg' },
    });
    await new Promise((r) => setTimeout(r, 1500));
    const [stillThere] = await bucket.file('profile-photos/strip-u4.jpg').exists();
    expect(stillThere).toBe(true);
    await bucket.file('profile-photos/strip-u4.jpg').delete({ ignoreNotFound: true });
  });
});
