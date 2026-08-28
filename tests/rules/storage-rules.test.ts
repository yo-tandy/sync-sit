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
import { doc, setDoc } from 'firebase/firestore';

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
    // storage.rules now does a cross-service firestore.get() on the caller's
    // user doc (verification-documents family-membership check, issue #153),
    // so the suite also needs the Firestore emulator to seed those docs.
    // Lane-aware port, same as tests/rules/firestore-rules.test.ts.
    firestore: { host: '127.0.0.1', port: Number(process.env.TEST_FIRESTORE_PORT ?? '8080') },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearStorage();
  await testEnv.clearFirestore();
});

/** Seed a users/{uid} doc (Plan D shape) with rules disabled. */
async function seedUser(uid: string, data: Record<string, unknown>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), data);
  });
}

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

  it('allows a member of the owning family to write into their family path', async () => {
    await seedUser('parent1', { profiles: { parent: { familyId: 'family1' } } });
    const authed = testEnv.authenticatedContext('parent1');
    // Same path shape the web clients build: {familyId}/{Date.now()}-{name}
    const fileRef = ref(authed.storage(), 'verification-documents/family1/1724700000000-id.pdf');
    await assertSucceeds(uploadString(fileRef, 'contents', 'raw'));
  });

  it('allows a family member to overwrite an existing file in their family path', async () => {
    await seedUser('parent1', { profiles: { parent: { familyId: 'family1' } } });
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const seedRef = ref(ctx.storage(), 'verification-documents/family1/doc.pdf');
      await uploadString(seedRef, 'seed', 'raw');
    });
    const authed = testEnv.authenticatedContext('parent1');
    const fileRef = ref(authed.storage(), 'verification-documents/family1/doc.pdf');
    await assertSucceeds(uploadString(fileRef, 'updated', 'raw'));
  });

  it('allows an upload with an explicit content type (rule does not restrict type)', async () => {
    // Clients pass the browser-detected File.type through uploadBytes; the
    // rule deliberately leaves content type open (File.type is unreliable).
    await seedUser('parent1', { profiles: { parent: { familyId: 'family1' } } });
    const authed = testEnv.authenticatedContext('parent1');
    const fileRef = ref(authed.storage(), 'verification-documents/family1/1724700000000-scan.pdf');
    await assertSucceeds(
      uploadBytes(fileRef, new Uint8Array([1, 2, 3]), { contentType: 'application/pdf' }),
    );
  });

  it('allows an admin to write into any family path', async () => {
    // Admin docs have no `profiles` — the rule must not error on that shape.
    await seedUser('admin1', { isAdmin: true });
    const authed = testEnv.authenticatedContext('admin1');
    const fileRef = ref(authed.storage(), 'verification-documents/family1/doc.pdf');
    await assertSucceeds(uploadString(fileRef, 'contents', 'raw'));
  });

  it('denies a parent writing into ANOTHER family\'s path', async () => {
    await seedUser('parent2', { profiles: { parent: { familyId: 'family2' } } });
    const authed = testEnv.authenticatedContext('parent2');
    const fileRef = ref(authed.storage(), 'verification-documents/family1/doc.pdf');
    await assertFails(uploadString(fileRef, 'contents', 'raw'));
  });

  it('denies a babysitter (no parent profile) writing into a family path', async () => {
    await seedUser('sitter1', { profiles: { babysitter: { firstName: 'B' } } });
    const authed = testEnv.authenticatedContext('sitter1');
    const fileRef = ref(authed.storage(), 'verification-documents/family1/doc.pdf');
    await assertFails(uploadString(fileRef, 'contents', 'raw'));
  });

  it('denies a tutor writing into a family path AND under their own uid', async () => {
    // PR #152 removed the last tutor-side uploader; tutors keep read access to
    // their legacy docs via the callable but must not write here anymore.
    await seedUser('tutor1', { profiles: { tutor: { firstName: 'T' } } });
    const authed = testEnv.authenticatedContext('tutor1');
    await assertFails(
      uploadString(ref(authed.storage(), 'verification-documents/family1/doc.pdf'), 'x', 'raw'),
    );
    await assertFails(
      uploadString(ref(authed.storage(), 'verification-documents/tutor1/doc.pdf'), 'x', 'raw'),
    );
  });

  it('denies an authenticated user with no user doc', async () => {
    const authed = testEnv.authenticatedContext('ghost1');
    const fileRef = ref(authed.storage(), 'verification-documents/family1/doc.pdf');
    await assertFails(uploadString(fileRef, 'contents', 'raw'));
  });

  it('denies unauthenticated writes', async () => {
    const unauthed = testEnv.unauthenticatedContext();
    const fileRef = ref(unauthed.storage(), 'verification-documents/family1/doc.pdf');
    await assertFails(uploadString(fileRef, 'contents', 'raw'));
  });

  it('denies an oversized upload (> 10MB) even from the owning family', async () => {
    await seedUser('parent1', { profiles: { parent: { familyId: 'family1' } } });
    const authed = testEnv.authenticatedContext('parent1');
    const fileRef = ref(authed.storage(), 'verification-documents/family1/big.pdf');
    await assertFails(uploadBytes(fileRef, new Uint8Array(10 * 1024 * 1024 + 1)));
  });

  it('allows an upload of exactly 10MB (the client-side limit is inclusive)', async () => {
    await seedUser('parent1', { profiles: { parent: { familyId: 'family1' } } });
    const authed = testEnv.authenticatedContext('parent1');
    const fileRef = ref(authed.storage(), 'verification-documents/family1/max.pdf');
    await assertSucceeds(uploadBytes(fileRef, new Uint8Array(10 * 1024 * 1024)));
  });

  it('denies deletes even by the owning family (no client deletes; Admin SDK bypasses rules)', async () => {
    await seedUser('parent1', { profiles: { parent: { familyId: 'family1' } } });
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
