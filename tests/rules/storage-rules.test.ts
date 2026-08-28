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
import { ref, uploadString, uploadBytes, getBytes, deleteObject } from 'firebase/storage';
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

  it('denies a parent writing into ANOTHER family\'s path', async () => {
    await seedUser('sr-parent2', { profiles: { parent: { familyId: 'sr-family2' } } });
    const authed = testEnv.authenticatedContext('sr-parent2');
    const fileRef = ref(authed.storage(), 'verification-documents/sr-family1/doc.pdf');
    await assertFails(uploadString(fileRef, 'contents', 'raw'));
  });

  it('denies a babysitter (no parent profile) writing into a family path', async () => {
    await seedUser('sr-sitter1', { profiles: { babysitter: { firstName: 'B' } } });
    const authed = testEnv.authenticatedContext('sr-sitter1');
    const fileRef = ref(authed.storage(), 'verification-documents/sr-family1/doc.pdf');
    await assertFails(uploadString(fileRef, 'contents', 'raw'));
  });

  it('denies a tutor writing into a family path AND under their own uid', async () => {
    // PR #152 removed the last tutor-side uploader; tutors keep read access to
    // their legacy docs via the callable but must not write here anymore.
    await seedUser('sr-tutor1', { profiles: { tutor: { firstName: 'T' } } });
    const authed = testEnv.authenticatedContext('sr-tutor1');
    await assertFails(
      uploadString(ref(authed.storage(), 'verification-documents/sr-family1/doc.pdf'), 'x', 'raw'),
    );
    await assertFails(
      uploadString(ref(authed.storage(), 'verification-documents/sr-tutor1/doc.pdf'), 'x', 'raw'),
    );
  });

  it('denies an authenticated user with no user doc', async () => {
    const authed = testEnv.authenticatedContext('sr-ghost1');
    const fileRef = ref(authed.storage(), 'verification-documents/sr-family1/doc.pdf');
    await assertFails(uploadString(fileRef, 'contents', 'raw'));
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
