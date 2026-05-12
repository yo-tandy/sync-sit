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
import { ref, uploadString, getBytes } from 'firebase/storage';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  const rulesPath = resolve(import.meta.dirname, '../../storage.rules');
  const rules = readFileSync(rulesPath, 'utf8');

  testEnv = await initializeTestEnvironment({
    projectId: 'demo-storage-rules-test',
    storage: { rules, host: '127.0.0.1', port: 9199 },
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

  it('allows authenticated writes', async () => {
    const authed = testEnv.authenticatedContext('user1');
    const fileRef = ref(authed.storage(), 'verification-documents/family1/doc.pdf');
    await assertSucceeds(uploadString(fileRef, 'contents', 'raw'));
  });

  it('denies unauthenticated writes', async () => {
    const unauthed = testEnv.unauthenticatedContext();
    const fileRef = ref(unauthed.storage(), 'verification-documents/family1/doc.pdf');
    await assertFails(uploadString(fileRef, 'contents', 'raw'));
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
