/**
 * Storage security rules tests.
 * Uses @firebase/rules-unit-testing to validate access control on Firebase Storage.
 */
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  ref,
  uploadString,
  uploadBytes,
  getBytes,
  deleteObject,
  updateMetadata,
} from 'firebase/storage';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  const rulesPath = resolve(import.meta.dirname, '../../storage.rules');
  const rules = readFileSync(rulesPath, 'utf8');

  testEnv = await initializeTestEnvironment({
    projectId: 'demo-storage-rules-test',
    // Env-overridable so a second emulator lane (firebase.lane2.json, all
    // ports +10000) can run the suite in parallel with the dev stack. Without
    // this, a lane-2 run connects to the DEV stack's storage on 9199 and
    // clearStorage() wipes it.
    storage: { rules, host: '127.0.0.1', port: Number(process.env.TEST_STORAGE_PORT ?? '9199') },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearStorage();
});

describe('verification-documents', () => {
  it('denies unauthenticated reads (reads go through cloud function)', async () => {
    const unauthed = testEnv.unauthenticatedContext();
    const fileRef = ref(unauthed.storage(), 'verification-documents/family1/doc.pdf');
    await assertFails(getBytes(fileRef));
  });

  it('denies authenticated reads directly (must go through cloud function)', async () => {
    // Seed a file via admin context
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const seedRef = ref(ctx.storage(), 'verification-documents/family1/doc.pdf');
      await uploadString(seedRef, 'seed', 'raw');
    });

    const authed = testEnv.authenticatedContext('user1');
    const fileRef = ref(authed.storage(), 'verification-documents/family1/doc.pdf');
    await assertFails(getBytes(fileRef));
  });

  it('denies unauthenticated writes', async () => {
    const unauthed = testEnv.unauthenticatedContext();
    const fileRef = ref(unauthed.storage(), 'verification-documents/family1/doc.pdf');
    await assertFails(uploadString(fileRef, 'contents', 'raw'));
  });

  // Issue #447 — writes now go through createVerificationDocumentUploadUrl
  // (a membership-checked signed PUT URL) exclusively, the same shape
  // family-photos uses (issue #471). `create, update: if false` means NO
  // direct client SDK write can ever succeed here, for ANYONE — this
  // replaces both the old contentType/size-denylist pins (moot: the rule
  // denies before request.resource is even considered) and the four
  // "TEMPORARILY allows ..." gap-pins issue #446's interim fix carried.
  it('denies a direct authenticated write into the caller\'s OWN family path (issue #447 — no client write path exists anymore)', async () => {
    const authed = testEnv.authenticatedContext('parent1');
    const fileRef = ref(authed.storage(), 'verification-documents/family1/1724700000000-id.pdf');
    await assertFails(uploadString(fileRef, 'contents', 'raw'));
  });

  it('denies a direct authenticated write with a normal explicit content type (application/pdf)', async () => {
    const authed = testEnv.authenticatedContext('parent1');
    const fileRef = ref(authed.storage(), 'verification-documents/family1/1724700000000-scan.pdf');
    await assertFails(
      uploadBytes(fileRef, new Uint8Array([1, 2, 3]), { contentType: 'application/pdf' }),
    );
  });

  it('denies an admin\'s direct write too (admin break-glass now lives in the callable, not the rule)', async () => {
    const authed = testEnv.authenticatedContext('admin1');
    const fileRef = ref(authed.storage(), 'verification-documents/family1/doc.pdf');
    await assertFails(uploadString(fileRef, 'contents', 'raw'));
  });

  it('denies a direct write from a caller with no user doc at all (no Firestore lookup happens anymore)', async () => {
    const authed = testEnv.authenticatedContext('ghost1');
    const fileRef = ref(authed.storage(), 'verification-documents/family1/doc.pdf');
    await assertFails(uploadString(fileRef, 'contents', 'raw'));
  });

  it('denies overwriting an existing file in the same path too', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const seedRef = ref(ctx.storage(), 'verification-documents/family1/doc.pdf');
      await uploadString(seedRef, 'seed', 'raw');
    });
    const authed = testEnv.authenticatedContext('parent1');
    const fileRef = ref(authed.storage(), 'verification-documents/family1/doc.pdf');
    await assertFails(uploadString(fileRef, 'updated', 'raw'));
  });

  it('denies flipping contentType via updateMetadata too (update is if false, same as create)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadString(ref(ctx.storage(), 'verification-documents/family1/meta.pdf'), 'seed', 'raw');
    });
    const authed = testEnv.authenticatedContext('parent1');
    const fileRef = ref(authed.storage(), 'verification-documents/family1/meta.pdf');
    await assertFails(updateMetadata(fileRef, { contentType: 'application/pdf' }));
  });

  it('denies deletes even by the owning family (no client deletes; Admin SDK bypasses rules)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const seedRef = ref(ctx.storage(), 'verification-documents/family1/doc.pdf');
      await uploadString(seedRef, 'seed', 'raw');
    });
    const authed = testEnv.authenticatedContext('parent1');
    const fileRef = ref(authed.storage(), 'verification-documents/family1/doc.pdf');
    await assertFails(deleteObject(fileRef));
  });
});

describe('profile-photos', () => {
  it('allows authenticated users to read profile photos', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const seedRef = ref(ctx.storage(), 'profile-photos/user1.jpg');
      await uploadString(seedRef, 'seed', 'raw');
    });

    const authed = testEnv.authenticatedContext('user2');
    const fileRef = ref(authed.storage(), 'profile-photos/user1.jpg');
    await assertSucceeds(getBytes(fileRef));
  });

  it('denies unauthenticated reads', async () => {
    const unauthed = testEnv.unauthenticatedContext();
    const fileRef = ref(unauthed.storage(), 'profile-photos/user1.jpg');
    await assertFails(getBytes(fileRef));
  });

  it('allows owner to write their own profile photo', async () => {
    const authed = testEnv.authenticatedContext('user1');
    const fileRef = ref(authed.storage(), 'profile-photos/user1.jpg');
    await assertSucceeds(uploadString(fileRef, 'photo', 'raw'));
  });

  it('allows owner to upload with different extensions', async () => {
    const authed = testEnv.authenticatedContext('user1');
    const pngRef = ref(authed.storage(), 'profile-photos/user1.png');
    await assertSucceeds(uploadString(pngRef, 'photo', 'raw'));
    const webpRef = ref(authed.storage(), 'profile-photos/user1.webp');
    await assertSucceeds(uploadString(webpRef, 'photo', 'raw'));
  });

  it('denies user from overwriting another user\'s profile photo', async () => {
    const authed = testEnv.authenticatedContext('user1');
    const fileRef = ref(authed.storage(), 'profile-photos/user2.jpg');
    await assertFails(uploadString(fileRef, 'photo', 'raw'));
  });

  it('denies writes when filename does not start with caller uid', async () => {
    const authed = testEnv.authenticatedContext('user1');
    // e.g. a guessed pattern that doesn't start with uid
    const fileRef = ref(authed.storage(), 'profile-photos/random-name.jpg');
    await assertFails(uploadString(fileRef, 'photo', 'raw'));
  });

  it('denies unauthenticated writes', async () => {
    const unauthed = testEnv.unauthenticatedContext();
    const fileRef = ref(unauthed.storage(), 'profile-photos/user1.jpg');
    await assertFails(uploadString(fileRef, 'photo', 'raw'));
  });

  it('denies writes to subdirectories under profile-photos (flat namespace only)', async () => {
    // The rule matches a single {fileName} segment, not nested paths.
    // Nested paths fall through to the default-deny rule.
    const authed = testEnv.authenticatedContext('user1');
    const fileRef = ref(authed.storage(), 'profile-photos/user1/avatar.jpg');
    await assertFails(uploadString(fileRef, 'photo', 'raw'));
  });

  // Issue #287: this path had NO contentType constraint at all before this
  // PR (confirmed by PR #466's investigation) — any authenticated owner
  // could set contentType: 'text/html' and mint a durable inline-rendering
  // link via getDownloadURL. Same denylist as verification-documents
  // (issue #281).
  it('denies an owner upload with contentType text/html (admin/user-phishing surface, issue #287)', async () => {
    const authed = testEnv.authenticatedContext('user1');
    const fileRef = ref(authed.storage(), 'profile-photos/user1.html');
    await assertFails(
      uploadBytes(fileRef, new TextEncoder().encode('<script>phish()</script>'), {
        contentType: 'text/html',
      }),
    );
  });

  it('denies an owner upload with contentType image/svg+xml (scriptable, renders live)', async () => {
    const authed = testEnv.authenticatedContext('user1');
    const fileRef = ref(authed.storage(), 'profile-photos/user1.svg');
    await assertFails(
      uploadBytes(fileRef, new TextEncoder().encode('<svg/>'), {
        contentType: 'image/svg+xml',
      }),
    );
  });

  it('allows real photo content types for the owner (image/jpeg, image/heic)', async () => {
    const authed = testEnv.authenticatedContext('user1');
    await assertSucceeds(
      uploadBytes(ref(authed.storage(), 'profile-photos/user1.jpg'), new Uint8Array([1, 2, 3]), {
        contentType: 'image/jpeg',
      }),
    );
    await assertSucceeds(
      uploadBytes(ref(authed.storage(), 'profile-photos/user1.heic'), new Uint8Array([1, 2, 3]), {
        contentType: 'image/heic',
      }),
    );
  });

  it('allows empty/application/octet-stream content types for the owner (denylist, not an allowlist)', async () => {
    // PR #466's resolvePhotoContentType falls back to these when the
    // browser's File.type is empty/generic — the rule must not become an
    // allowlist and reject them (mirrors the verification-documents pin).
    const authed = testEnv.authenticatedContext('user1');
    await assertSucceeds(
      uploadBytes(ref(authed.storage(), 'profile-photos/user1.heic'), new Uint8Array([1, 2, 3]), {
        contentType: '',
      }),
    );
    await assertSucceeds(
      uploadBytes(ref(authed.storage(), 'profile-photos/user1.jpg'), new Uint8Array([1, 2, 3]), {
        contentType: 'application/octet-stream',
      }),
    );
  });

  // Review round on PR #470: `allow write` covers create/update/delete, and
  // request.resource is null on a delete, so a combined `write` rule
  // referencing request.resource.contentType denies EVERY delete. This is a
  // real, currently-live flow — apps/web family/babysitter AccountPage.tsx
  // and apps/study-web tutor AccountPage.tsx call
  // deleteObject(ref(storage, oldPath)).catch(() => {}) to clean up the old
  // avatar on remove/replace, swallowing any error — so the regression would
  // have silently orphaned a readable photo (of a minor, in the tutor case)
  // on every remove. The rule is now split into create/update + delete
  // (mirroring verification-documents) specifically so this stays covered.
  it('allows the owner to delete their own profile photo', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadString(ref(ctx.storage(), 'profile-photos/user1.jpg'), 'seed', 'raw');
    });
    const authed = testEnv.authenticatedContext('user1');
    const fileRef = ref(authed.storage(), 'profile-photos/user1.jpg');
    await assertSucceeds(deleteObject(fileRef));
  });

  it('denies a non-owner from deleting another user\'s profile photo', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadString(ref(ctx.storage(), 'profile-photos/user1.jpg'), 'seed', 'raw');
    });
    const authed = testEnv.authenticatedContext('user2');
    const fileRef = ref(authed.storage(), 'profile-photos/user1.jpg');
    await assertFails(deleteObject(fileRef));
  });
});

describe('family-photos', () => {
  it('allows authenticated reads', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const seedRef = ref(ctx.storage(), 'family-photos/family1/photo.jpg');
      await uploadString(seedRef, 'seed', 'raw');
    });

    const authed = testEnv.authenticatedContext('user1');
    const fileRef = ref(authed.storage(), 'family-photos/family1/photo.jpg');
    await assertSucceeds(getBytes(fileRef));
  });

  it('denies unauthenticated reads', async () => {
    const unauthed = testEnv.unauthenticatedContext();
    const fileRef = ref(unauthed.storage(), 'family-photos/family1/photo.jpg');
    await assertFails(getBytes(fileRef));
  });

  it('denies unauthenticated writes', async () => {
    const unauthed = testEnv.unauthenticatedContext();
    const fileRef = ref(unauthed.storage(), 'family-photos/family1/photo.jpg');
    await assertFails(uploadString(fileRef, 'photo', 'raw'));
  });

  // Issue #471 — writes now go through createFamilyPhotoUploadUrl (a
  // membership-checked signed PUT URL) exclusively. `create, update: if
  // false` means NO direct client SDK write can ever succeed here, for
  // ANYONE — this replaces both the #287 contentType-denylist pins (moot:
  // the rule denies before contentType is even considered) and the #287
  // gap-pin this test used to carry ("TEMPORARILY allows a non-member...").
  it('denies a direct authenticated write into the caller\'s OWN family path (issue #471 — no client write path exists anymore)', async () => {
    const authed = testEnv.authenticatedContext('user1');
    const fileRef = ref(authed.storage(), 'family-photos/family1/photo.jpg');
    await assertFails(uploadString(fileRef, 'photo', 'raw'));
  });

  it('denies a direct authenticated write with a legitimate image contentType (rule denies before contentType is considered)', async () => {
    const authed = testEnv.authenticatedContext('user1');
    const fileRef = ref(authed.storage(), 'family-photos/family1/photo.jpg');
    await assertFails(
      uploadBytes(fileRef, new Uint8Array([1, 2, 3]), { contentType: 'image/jpeg' }),
    );
  });

  // The #287 gap-pin, now flipped to green: a non-member's direct write is
  // DENIED (previously the only pin this test file had for this path was
  // that it TEMPORARILY succeeded).
  it('denies a non-member\'s direct write into another family\'s photo path (issue #287 scoping finding, closed by #471)', async () => {
    const authed = testEnv.authenticatedContext('unrelated-user');
    const fileRef = ref(authed.storage(), 'family-photos/family2.jpg');
    await assertFails(uploadString(fileRef, 'photo', 'raw'));
  });

  it('denies an update to an existing object too (create AND update are both if false)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadString(ref(ctx.storage(), 'family-photos/family1/photo.jpg'), 'seed', 'raw');
    });
    const authed = testEnv.authenticatedContext('user1');
    const fileRef = ref(authed.storage(), 'family-photos/family1/photo.jpg');
    await assertFails(uploadString(fileRef, 'replacement', 'raw'));
  });

  // Issue #483 — deletes now go through deleteFamilyPhoto (a
  // membership-checked Admin-SDK delete) exclusively, closing the gap
  // #482 deliberately left open ("delete stays unscoped — see the
  // storage.rules comment for why"). `delete: if false` means NO direct
  // client SDK delete can ever succeed here, for ANYONE — member or not.
  it("denies a direct authenticated delete into the caller's OWN family path (issue #483 — no client delete path exists anymore)", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadString(ref(ctx.storage(), 'family-photos/family1/photo.jpg'), 'seed', 'raw');
    });
    const authed = testEnv.authenticatedContext('user1');
    const fileRef = ref(authed.storage(), 'family-photos/family1/photo.jpg');
    await assertFails(deleteObject(fileRef));
  });

  // The #470/#482 gap-pin, now flipped to green: a non-member's direct
  // delete is DENIED (previously the only pin this test file had for
  // delete was that it succeeded, unscoped, for anyone authenticated).
  it("denies a non-member's direct delete of another family's photo path (issue #483 closes the #482 gap)", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadString(ref(ctx.storage(), 'family-photos/family2/photo.jpg'), 'seed', 'raw');
    });
    const authed = testEnv.authenticatedContext('unrelated-user');
    const fileRef = ref(authed.storage(), 'family-photos/family2/photo.jpg');
    await assertFails(deleteObject(fileRef));
  });

  it('denies an unauthenticated delete', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadString(ref(ctx.storage(), 'family-photos/family1/photo.jpg'), 'seed', 'raw');
    });
    const unauthed = testEnv.unauthenticatedContext();
    const fileRef = ref(unauthed.storage(), 'family-photos/family1/photo.jpg');
    await assertFails(deleteObject(fileRef));
  });
});

describe('do-photos (sync-do final objects, plan §7.4)', () => {
  // allow read, write: if false — written only by the stripper (Admin SDK),
  // read only via the signing callables. No Firestore lookup involved, so
  // no user docs to seed.
  it('denies reading a photo under the caller\'s OWN prefix (reads go through doGetOwnPhotoUrl)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadString(ref(ctx.storage(), 'do-photos/user1/photo-1'), 'stripped', 'raw');
    });
    const authed = testEnv.authenticatedContext('user1');
    await assertFails(getBytes(ref(authed.storage(), 'do-photos/user1/photo-1')));
  });

  it('denies reading another user\'s photo', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadString(ref(ctx.storage(), 'do-photos/user1/photo-1'), 'stripped', 'raw');
    });
    const authed = testEnv.authenticatedContext('user2');
    await assertFails(getBytes(ref(authed.storage(), 'do-photos/user1/photo-1')));
  });

  it('denies writes even under the caller\'s own prefix — only the stripper writes final objects', async () => {
    const authed = testEnv.authenticatedContext('user1');
    await assertFails(
      uploadBytes(ref(authed.storage(), 'do-photos/user1/photo-1'), new Uint8Array([1]), {
        contentType: 'image/jpeg',
      }),
    );
  });

  it('denies deletes', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadString(ref(ctx.storage(), 'do-photos/user1/photo-2'), 'stripped', 'raw');
    });
    const authed = testEnv.authenticatedContext('user1');
    await assertFails(deleteObject(ref(authed.storage(), 'do-photos/user1/photo-2')));
  });
});

describe('do-uploads (sync-do quarantine, plan §7.4)', () => {
  const IMG = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 1, 2, 3]);

  it('allows the owner to write an image/* object under their own prefix', async () => {
    const authed = testEnv.authenticatedContext('user1');
    await assertSucceeds(
      uploadBytes(ref(authed.storage(), 'do-uploads/user1/upload-1'), IMG, {
        contentType: 'image/jpeg',
      }),
    );
    await assertSucceeds(
      uploadBytes(ref(authed.storage(), 'do-uploads/user1/upload-2'), IMG, {
        contentType: 'image/png',
      }),
    );
  });

  it('denies writing under ANOTHER user\'s prefix — §7.4\'s "ownership is structural" basis', async () => {
    const authed = testEnv.authenticatedContext('user2');
    await assertFails(
      uploadBytes(ref(authed.storage(), 'do-uploads/user1/upload-x'), IMG, {
        contentType: 'image/jpeg',
      }),
    );
  });

  it('denies unauthenticated writes', async () => {
    const unauthed = testEnv.unauthenticatedContext();
    await assertFails(
      uploadBytes(ref(unauthed.storage(), 'do-uploads/user1/upload-x'), IMG, {
        contentType: 'image/jpeg',
      }),
    );
  });

  it('denies reads, even by the owner — thumbnails render from the POST-strip object', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadString(ref(ctx.storage(), 'do-uploads/user1/upload-r'), 'raw-with-exif', 'raw');
    });
    const authed = testEnv.authenticatedContext('user1');
    await assertFails(getBytes(ref(authed.storage(), 'do-uploads/user1/upload-r')));
  });

  it('enforces the size bound: 10MB exactly is refused (strict <), just under passes', async () => {
    const authed = testEnv.authenticatedContext('user1');
    await assertFails(
      uploadBytes(ref(authed.storage(), 'do-uploads/user1/too-big'), new Uint8Array(10 * 1024 * 1024), {
        contentType: 'image/jpeg',
      }),
    );
    await assertSucceeds(
      uploadBytes(ref(authed.storage(), 'do-uploads/user1/just-fits'), new Uint8Array(10 * 1024 * 1024 - 1), {
        contentType: 'image/jpeg',
      }),
    );
  });

  it('enforces the content-type bound: non-image and absent types are refused', async () => {
    const authed = testEnv.authenticatedContext('user1');
    await assertFails(
      uploadBytes(ref(authed.storage(), 'do-uploads/user1/not-img-1'), IMG, {
        contentType: 'application/pdf',
      }),
    );
    await assertFails(
      uploadBytes(ref(authed.storage(), 'do-uploads/user1/not-img-2'), IMG, {
        contentType: 'text/html',
      }),
    );
    await assertFails(
      uploadBytes(ref(authed.storage(), 'do-uploads/user1/not-img-3'), IMG, {
        contentType: 'application/octet-stream',
      }),
    );
  });

  // Issue #287 audit finding: 'image/svg+xml' matches the image/.* allowlist
  // byte-for-byte, so before this PR an SVG (scriptable, renders live) got
  // through this rule where text/html/application/pdf did not.
  it('denies contentType image/svg+xml even though it matches the image/.* allowlist (issue #287)', async () => {
    const authed = testEnv.authenticatedContext('user1');
    await assertFails(
      uploadBytes(ref(authed.storage(), 'do-uploads/user1/evil.svg'), IMG, {
        contentType: 'image/svg+xml',
      }),
    );
  });

  it('denies flipping contentType off image/* via updateMetadata (update path bounded too)', async () => {
    const authed = testEnv.authenticatedContext('user1');
    const fileRef = ref(authed.storage(), 'do-uploads/user1/meta-flip');
    await assertSucceeds(uploadBytes(fileRef, IMG, { contentType: 'image/jpeg' }));
    await assertFails(updateMetadata(fileRef, { contentType: 'text/html' }));
  });

  it('denies deletes (cleanup is the stripper\'s and the sweep\'s job, via the Admin SDK)', async () => {
    const authed = testEnv.authenticatedContext('user1');
    const fileRef = ref(authed.storage(), 'do-uploads/user1/upload-del');
    await assertSucceeds(uploadBytes(fileRef, IMG, { contentType: 'image/jpeg' }));
    await assertFails(deleteObject(fileRef));
  });

  it('denies nested paths (single {uploadId} segment only — the trigger\'s path parse relies on it)', async () => {
    const authed = testEnv.authenticatedContext('user1');
    await assertFails(
      uploadBytes(ref(authed.storage(), 'do-uploads/user1/a/b'), IMG, {
        contentType: 'image/jpeg',
      }),
    );
  });
});

describe('default deny', () => {
  it('denies writes outside known buckets even when authenticated', async () => {
    const authed = testEnv.authenticatedContext('user1');
    const fileRef = ref(authed.storage(), 'other-bucket/file.jpg');
    await assertFails(uploadString(fileRef, 'data', 'raw'));
  });

  it('denies reads outside known buckets even when authenticated', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const seedRef = ref(ctx.storage(), 'other-bucket/file.jpg');
      await uploadString(seedRef, 'seed', 'raw');
    });

    const authed = testEnv.authenticatedContext('user1');
    const fileRef = ref(authed.storage(), 'other-bucket/file.jpg');
    await assertFails(getBytes(fileRef));
  });
});
