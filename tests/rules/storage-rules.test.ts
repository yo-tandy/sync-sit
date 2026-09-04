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
import { doc, setDoc, deleteDoc } from 'firebase/firestore';

let testEnv: RulesTestEnvironment;
let crossServiceEnv: RulesTestEnvironment;

// storage.rules does a cross-service firestore.get() on the caller's user doc
// (verification-documents family-membership check, issue #153). The Storage
// emulator resolves that lookup against the project the EMULATOR SUITE was
// started with (firebase-tools files.js passes its startup projectId to the
// rules runtime), NOT against this test env's projectId — so the user docs
// must be seeded into the Firestore emulator under that project. emulators:exec
// exports it as GCLOUD_PROJECT (demo-test in CI and the lane scripts).
const CROSS_SERVICE_PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-test';

// Uids/familyIds are suite-prefixed: they land in the shared demo-test
// Firestore namespace (fileParallelism is off, so no races, but leftovers must
// never collide with other suites' seed data). Every uid a test may seed is
// listed here so cleanup can run defensively in beforeAll (self-healing after
// an aborted prior run) and unconditionally in afterAll. Add new uids here.
const SUITE_UIDS = ['sr-parent1', 'sr-parent2', 'sr-admin1', 'sr-sitter1', 'sr-tutor1', 'sr-ghost1'];

let testEnvs: RulesTestEnvironment[] = [];

/** Delete this suite's user docs from BOTH namespaces seedUser writes to
 * (deleteDoc on a missing doc is a no-op). NEVER clearFirestore() on
 * crossServiceEnv — it shares the integration tests' project. */
async function deleteSuiteDocs() {
  for (const env of testEnvs) {
    await env.withSecurityRulesDisabled(async (ctx) => {
      for (const uid of SUITE_UIDS) {
        await deleteDoc(doc(ctx.firestore(), 'users', uid));
      }
    });
  }
}

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
    // Firestore config so seedUser can also seed this env's own namespace —
    // a hedge against the emulator's cross-service project resolution (see
    // seedUser). Lane-aware port, same as tests/rules/firestore-rules.test.ts.
    firestore: { host: '127.0.0.1', port: Number(process.env.TEST_FIRESTORE_PORT ?? '8080') },
  });

  // Separate env purely for seeding the cross-service user docs (see above).
  crossServiceEnv = await initializeTestEnvironment({
    projectId: CROSS_SERVICE_PROJECT,
    firestore: { host: '127.0.0.1', port: Number(process.env.TEST_FIRESTORE_PORT ?? '8080') },
  });

  testEnvs = [testEnv, crossServiceEnv];

  // Self-heal: an aborted prior run (crash, Ctrl-C, timeout) never reached
  // afterAll, so its sr-* docs may still sit in the shared namespace.
  await deleteSuiteDocs();
});

afterAll(async () => {
  try {
    await deleteSuiteDocs();
  } finally {
    // Cleanup must run even if the emulator is already gone.
    for (const env of testEnvs) {
      await env.cleanup();
    }
  }
});

beforeEach(async () => {
  await testEnv.clearStorage();
});

/** Seed a users/{uid} doc (Plan D shape) with rules disabled — into BOTH
 * Firestore namespaces. firebase-tools currently resolves the storage rules'
 * firestore.get() against the emulator suite's startup project
 * (CROSS_SERVICE_PROJECT); seeding this env's own project too means the suite
 * keeps passing if a future firebase-tools resolves against the bucket's
 * project instead. Negative pins stay meaningful either way: the docs exist in
 * both namespaces, so a denial is a rules decision, not doc-not-found. */
async function seedUser(uid: string, data: Record<string, unknown>) {
  if (!SUITE_UIDS.includes(uid)) {
    throw new Error(`seedUser: add '${uid}' to SUITE_UIDS so cleanup covers it`);
  }
  for (const env of testEnvs) {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', uid), data);
    });
  }
}

describe('verification-documents', () => {
  it('denies unauthenticated reads (reads go through cloud function)', async () => {
    const unauthed = testEnv.unauthenticatedContext();
    const fileRef = ref(unauthed.storage(), 'verification-documents/sr-family1/doc.pdf');
    await assertFails(getBytes(fileRef));
  });

  it('denies authenticated reads directly (must go through cloud function)', async () => {
    // Seed a file via admin context
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const seedRef = ref(ctx.storage(), 'verification-documents/sr-family1/doc.pdf');
      await uploadString(seedRef, 'seed', 'raw');
    });

    const authed = testEnv.authenticatedContext('user1');
    const fileRef = ref(authed.storage(), 'verification-documents/sr-family1/doc.pdf');
    await assertFails(getBytes(fileRef));
  });

  it('allows a member of the owning family to write into their family path', async () => {
    await seedUser('sr-parent1', { profiles: { parent: { familyId: 'sr-family1' } } });
    const authed = testEnv.authenticatedContext('sr-parent1');
    // Same path shape the web clients build: {familyId}/{Date.now()}-{name}
    const fileRef = ref(authed.storage(), 'verification-documents/sr-family1/1724700000000-id.pdf');
    await assertSucceeds(uploadString(fileRef, 'contents', 'raw'));
  });

  it('allows a family member to overwrite an existing file in their family path', async () => {
    await seedUser('sr-parent1', { profiles: { parent: { familyId: 'sr-family1' } } });
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const seedRef = ref(ctx.storage(), 'verification-documents/sr-family1/doc.pdf');
      await uploadString(seedRef, 'seed', 'raw');
    });
    const authed = testEnv.authenticatedContext('sr-parent1');
    const fileRef = ref(authed.storage(), 'verification-documents/sr-family1/doc.pdf');
    await assertSucceeds(uploadString(fileRef, 'updated', 'raw'));
  });

  it('allows an upload with a normal explicit content type (application/pdf)', async () => {
    // Clients pass the browser-detected File.type through uploadBytes; the
    // rule only denies the narrow renderable-type denylist (issue #281).
    await seedUser('sr-parent1', { profiles: { parent: { familyId: 'sr-family1' } } });
    const authed = testEnv.authenticatedContext('sr-parent1');
    const fileRef = ref(authed.storage(), 'verification-documents/sr-family1/1724700000000-scan.pdf');
    await assertSucceeds(
      uploadBytes(fileRef, new Uint8Array([1, 2, 3]), { contentType: 'application/pdf' }),
    );
  });

  it('allows image and octet-stream content types (denylist must not become an allowlist)', async () => {
    // application/octet-stream is what browsers report for valid PDFs on some
    // OS/browser combos — the reason issue #281 rejects an allowlist. It must
    // keep passing, along with ordinary image uploads.
    await seedUser('sr-parent1', { profiles: { parent: { familyId: 'sr-family1' } } });
    const authed = testEnv.authenticatedContext('sr-parent1');
    await assertSucceeds(
      uploadBytes(
        ref(authed.storage(), 'verification-documents/sr-family1/id.jpg'),
        new Uint8Array([1, 2, 3]),
        { contentType: 'image/jpeg' },
      ),
    );
    await assertSucceeds(
      uploadBytes(
        ref(authed.storage(), 'verification-documents/sr-family1/blob.pdf'),
        new Uint8Array([1, 2, 3]),
        { contentType: 'application/octet-stream' },
      ),
    );
  });

  it('denies a text/html upload even from the owning family (admin-phishing surface, issue #281)', async () => {
    await seedUser('sr-parent1', { profiles: { parent: { familyId: 'sr-family1' } } });
    const authed = testEnv.authenticatedContext('sr-parent1');
    const fileRef = ref(authed.storage(), 'verification-documents/sr-family1/evil.html');
    await assertFails(
      uploadBytes(fileRef, new TextEncoder().encode('<script>phish()</script>'), {
        contentType: 'text/html',
      }),
    );
  });

  it('denies application/xhtml+xml and XML types (render live via XHTML / XSLT)', async () => {
    await seedUser('sr-parent1', { profiles: { parent: { familyId: 'sr-family1' } } });
    const authed = testEnv.authenticatedContext('sr-parent1');
    await assertFails(
      uploadBytes(
        ref(authed.storage(), 'verification-documents/sr-family1/evil.xhtml'),
        new Uint8Array([1]),
        { contentType: 'application/xhtml+xml' },
      ),
    );
    await assertFails(
      uploadBytes(
        ref(authed.storage(), 'verification-documents/sr-family1/evil.xml'),
        new Uint8Array([1]),
        { contentType: 'text/xml' },
      ),
    );
    await assertFails(
      uploadBytes(
        ref(authed.storage(), 'verification-documents/sr-family1/evil2.xml'),
        new Uint8Array([1]),
        { contentType: 'application/xml' },
      ),
    );
  });

  it('denies an image/svg+xml upload (scriptable, renders live like HTML)', async () => {
    await seedUser('sr-parent1', { profiles: { parent: { familyId: 'sr-family1' } } });
    const authed = testEnv.authenticatedContext('sr-parent1');
    const fileRef = ref(authed.storage(), 'verification-documents/sr-family1/evil.svg');
    await assertFails(
      uploadBytes(fileRef, new TextEncoder().encode('<svg/>'), {
        contentType: 'image/svg+xml',
      }),
    );
  });

  it('denies case/parameter variants of the denylisted types (no exact-string bypass)', async () => {
    // A raw-SDK attacker controls the contentType string byte-for-byte;
    // browsers treat media types case-insensitively and honor parameters,
    // so 'Text/HTML' and 'text/html; charset=utf-8' render exactly like
    // the canonical spelling.
    await seedUser('sr-parent1', { profiles: { parent: { familyId: 'sr-family1' } } });
    const authed = testEnv.authenticatedContext('sr-parent1');
    await assertFails(
      uploadBytes(
        ref(authed.storage(), 'verification-documents/sr-family1/evil2.html'),
        new Uint8Array([1]),
        { contentType: 'Text/HTML' },
      ),
    );
    await assertFails(
      uploadBytes(
        ref(authed.storage(), 'verification-documents/sr-family1/evil3.html'),
        new Uint8Array([1]),
        { contentType: 'text/html; charset=utf-8' },
      ),
    );
    await assertFails(
      uploadBytes(
        ref(authed.storage(), 'verification-documents/sr-family1/evil4.svg'),
        new Uint8Array([1]),
        { contentType: 'IMAGE/SVG+XML' },
      ),
    );
    // Leading whitespace: HTTP header parsing strips optional whitespace, so
    // ' text/html' still renders — the rule trims before matching.
    await assertFails(
      uploadBytes(
        ref(authed.storage(), 'verification-documents/sr-family1/evil5.html'),
        new Uint8Array([1]),
        { contentType: ' text/html' },
      ),
    );
    // Embedded newline: RE2's '.' does not span '\n' without (?s), so this
    // spelling would slip an un-flagged prefix match.
    await assertFails(
      uploadBytes(
        ref(authed.storage(), 'verification-documents/sr-family1/evil6.html'),
        new Uint8Array([1]),
        { contentType: 'text/html\nx' },
      ),
    );
  });

  it('denies flipping contentType to a renderable type via updateMetadata (update path)', async () => {
    // Every other deny pin goes through uploadBytes (the create path); the
    // cheapest bypass of a write-time type check would be uploading a clean
    // PDF and then flipping the stored type with a metadata-only update.
    // Metadata updates evaluate under `allow create, update` with
    // request.resource.contentType carrying the INCOMING type, so the same
    // denylist applies — this pins that a rules refactor can't quietly
    // split the paths.
    await seedUser('sr-parent1', { profiles: { parent: { familyId: 'sr-family1' } } });
    const authed = testEnv.authenticatedContext('sr-parent1');
    const fileRef = ref(authed.storage(), 'verification-documents/sr-family1/meta.pdf');
    await assertSucceeds(
      uploadBytes(fileRef, new Uint8Array([1, 2, 3]), { contentType: 'application/pdf' }),
    );
    await assertFails(updateMetadata(fileRef, { contentType: 'text/html' }));
  });

  it('denies arbitrary *+xml types via the suffix match (Firefox renders any *+xml as XML)', async () => {
    await seedUser('sr-parent1', { profiles: { parent: { familyId: 'sr-family1' } } });
    const authed = testEnv.authenticatedContext('sr-parent1');
    await assertFails(
      uploadBytes(
        ref(authed.storage(), 'verification-documents/sr-family1/feed.xml'),
        new Uint8Array([1]),
        { contentType: 'application/rss+xml' },
      ),
    );
  });

  it('allows an admin to write into any family path', async () => {
    // Admin docs have no `profiles` — the rule must not error on that shape.
    await seedUser('sr-admin1', { isAdmin: true });
    const authed = testEnv.authenticatedContext('sr-admin1');
    const fileRef = ref(authed.storage(), 'verification-documents/sr-family1/doc.pdf');
    await assertSucceeds(uploadString(fileRef, 'contents', 'raw'));
  });

  // ── TEMPORARY: the issue #153 family-membership check is removed ──
  //
  // These four cases asserted DENIAL until the interim fix for the production
  // upload outage. The check they pinned (`canWriteFamilyDocs(callerData(),
  // familyId)`) is a cross-service `firestore.get()` that FAILS in production —
  // rules fail closed on an errored call, so it 403'd every real parent, not
  // just non-members. See the block comment in storage.rules for the full
  // ruled-out list and the timeline.
  //
  // They now assert the widening is REAL and DELIBERATE rather than silently
  // deleting the coverage: each caller below is one that production genuinely
  // accepts today, so if the membership check comes back (via the signed-URL
  // callable in the follow-up issue, which flips this path to
  // `allow write: if false`) these flip to assertFails and this whole block
  // gets reverted along with the rule. A reviewer reading a bare deletion
  // could not tell the coverage was traded away on purpose; this can.
  //
  // What still holds the line meanwhile, pinned by the tests below this block:
  // unauthenticated writes, the >10MB cap, the renderable-contentType
  // denylist, deletes, and ALL reads (admin/owner only, via the
  // getVerificationDocument callable) — so the residual exposure is write-only
  // integrity, not disclosure.
  it('TEMPORARILY allows a parent to write into ANOTHER family\'s path (#153 check removed)', async () => {
    await seedUser('sr-parent2', { profiles: { parent: { familyId: 'sr-family2' } } });
    const authed = testEnv.authenticatedContext('sr-parent2');
    const fileRef = ref(authed.storage(), 'verification-documents/sr-family1/doc.pdf');
    await assertSucceeds(uploadString(fileRef, 'contents', 'raw'));
  });

  it('TEMPORARILY allows a babysitter (no parent profile) to write into a family path', async () => {
    await seedUser('sr-sitter1', { profiles: { babysitter: { firstName: 'B' } } });
    const authed = testEnv.authenticatedContext('sr-sitter1');
    const fileRef = ref(authed.storage(), 'verification-documents/sr-family1/doc.pdf');
    await assertSucceeds(uploadString(fileRef, 'contents', 'raw'));
  });

  it('TEMPORARILY allows a tutor to write into a family path AND under their own uid', async () => {
    // PR #152 removed the last tutor-side uploader, so nothing legitimate
    // writes these paths as a tutor — this is tolerated exposure, not intent.
    await seedUser('sr-tutor1', { profiles: { tutor: { firstName: 'T' } } });
    const authed = testEnv.authenticatedContext('sr-tutor1');
    await assertSucceeds(
      uploadString(ref(authed.storage(), 'verification-documents/sr-family1/doc.pdf'), 'x', 'raw'),
    );
    await assertSucceeds(
      uploadString(ref(authed.storage(), 'verification-documents/sr-tutor1/doc.pdf'), 'x', 'raw'),
    );
  });

  it('TEMPORARILY allows an authenticated user with no user doc', async () => {
    // The sharpest signal that the cross-service lookup is gone: this used to
    // be denied BY the errored get() on a missing doc, not by a membership
    // comparison. Nothing reads Firestore from these rules anymore.
    const authed = testEnv.authenticatedContext('sr-ghost1');
    const fileRef = ref(authed.storage(), 'verification-documents/sr-family1/doc.pdf');
    await assertSucceeds(uploadString(fileRef, 'contents', 'raw'));
  });

  it('denies unauthenticated writes', async () => {
    const unauthed = testEnv.unauthenticatedContext();
    const fileRef = ref(unauthed.storage(), 'verification-documents/sr-family1/doc.pdf');
    await assertFails(uploadString(fileRef, 'contents', 'raw'));
  });

  it('denies an oversized upload (> 10MB) even from the owning family', async () => {
    await seedUser('sr-parent1', { profiles: { parent: { familyId: 'sr-family1' } } });
    const authed = testEnv.authenticatedContext('sr-parent1');
    const fileRef = ref(authed.storage(), 'verification-documents/sr-family1/big.pdf');
    await assertFails(uploadBytes(fileRef, new Uint8Array(10 * 1024 * 1024 + 1)));
  });

  it('allows an upload of exactly 10MB (the client-side limit is inclusive)', async () => {
    await seedUser('sr-parent1', { profiles: { parent: { familyId: 'sr-family1' } } });
    const authed = testEnv.authenticatedContext('sr-parent1');
    const fileRef = ref(authed.storage(), 'verification-documents/sr-family1/max.pdf');
    await assertSucceeds(uploadBytes(fileRef, new Uint8Array(10 * 1024 * 1024)));
  });

  it('denies deletes even by the owning family (no client deletes; Admin SDK bypasses rules)', async () => {
    await seedUser('sr-parent1', { profiles: { parent: { familyId: 'sr-family1' } } });
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const seedRef = ref(ctx.storage(), 'verification-documents/sr-family1/doc.pdf');
      await uploadString(seedRef, 'seed', 'raw');
    });
    const authed = testEnv.authenticatedContext('sr-parent1');
    const fileRef = ref(authed.storage(), 'verification-documents/sr-family1/doc.pdf');
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

  it('allows authenticated writes', async () => {
    const authed = testEnv.authenticatedContext('user1');
    const fileRef = ref(authed.storage(), 'family-photos/family1/photo.jpg');
    await assertSucceeds(uploadString(fileRef, 'photo', 'raw'));
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
