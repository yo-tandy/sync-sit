/**
 * Firestore security rules tests.
 * Uses @firebase/rules-unit-testing to validate access control.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  const rulesPath = resolve(import.meta.dirname, '../../firestore.rules');
  const rules = readFileSync(rulesPath, 'utf8');

  testEnv = await initializeTestEnvironment({
    projectId: 'demo-rules-test',
    firestore: { rules, host: '127.0.0.1', port: 8080 },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

describe('users collection', () => {
  it('denies unauthenticated read', async () => {
    const unauthed = testEnv.unauthenticatedContext();
    await assertFails(getDoc(doc(unauthed.firestore(), 'users', 'user1')));
  });

  it('allows user to read own profile', async () => {
    // Seed user doc first via admin
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', 'user1'), {
        uid: 'user1', role: 'babysitter', status: 'active', email: 'test@ejm.org',
      });
    });

    const authed = testEnv.authenticatedContext('user1');
    await assertSucceeds(getDoc(doc(authed.firestore(), 'users', 'user1')));
  });

  it('denies user from reading another users profile directly (unless babysitter)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', 'other'), {
        uid: 'other', role: 'parent', status: 'active', email: 'other@test.com',
      });
    });

    const authed = testEnv.authenticatedContext('user1');
    // Parent docs are only readable by owner, admin, or family members
    await assertFails(getDoc(doc(authed.firestore(), 'users', 'other')));
  });

  it('denies user from modifying protected fields (role)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', 'user1'), {
        uid: 'user1', role: 'babysitter', status: 'active', email: 'test@ejm.org',
        firstName: 'Test', lastName: 'User',
      });
    });

    const authed = testEnv.authenticatedContext('user1');
    await assertFails(
      updateDoc(doc(authed.firestore(), 'users', 'user1'), { role: 'admin' })
    );
  });

  it('denies creating user docs from client', async () => {
    const authed = testEnv.authenticatedContext('newuser');
    await assertFails(
      setDoc(doc(authed.firestore(), 'users', 'newuser'), {
        uid: 'newuser', role: 'babysitter', status: 'active',
      })
    );
  });
});

describe('families collection', () => {
  it('allows family member to read family doc', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'families', 'fam1'), {
        familyId: 'fam1', parentIds: ['parent1', 'parent2'],
      });
    });

    const authed = testEnv.authenticatedContext('parent1');
    await assertSucceeds(getDoc(doc(authed.firestore(), 'families', 'fam1')));
  });

  it('denies non-member from reading family doc', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'families', 'fam1'), {
        familyId: 'fam1', parentIds: ['parent1'],
      });
    });

    const authed = testEnv.authenticatedContext('outsider');
    await assertFails(getDoc(doc(authed.firestore(), 'families', 'fam1')));
  });
});

describe('inviteLinks collection', () => {
  it('denies all client reads (validated via Cloud Function)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'inviteLinks', 'token123'), {
        token: 'token123', familyId: 'fam1', used: false,
      });
    });

    const authed = testEnv.authenticatedContext('anyuser');
    await assertFails(getDoc(doc(authed.firestore(), 'inviteLinks', 'token123')));
  });

  it('denies unauthenticated reads', async () => {
    const unauthed = testEnv.unauthenticatedContext();
    await assertFails(getDoc(doc(unauthed.firestore(), 'inviteLinks', 'token123')));
  });

  it('denies all client writes', async () => {
    const authed = testEnv.authenticatedContext('anyuser');
    await assertFails(
      setDoc(doc(authed.firestore(), 'inviteLinks', 'newtoken'), {
        token: 'newtoken', familyId: 'fam1', used: false,
      })
    );
  });
});

describe('verificationCodes collection', () => {
  it('denies all client access', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'verificationCodes', 'test@ejm.org'), {
        code: '123456',
      });
    });

    const authed = testEnv.authenticatedContext('anyuser');
    await assertFails(getDoc(doc(authed.firestore(), 'verificationCodes', 'test@ejm.org')));
  });
});

describe('notifications collection', () => {
  it('allows user to read own notifications', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'notifications', 'notif1'), {
        recipientUserId: 'user1', read: false, type: 'new_request',
      });
    });

    const authed = testEnv.authenticatedContext('user1');
    await assertSucceeds(getDoc(doc(authed.firestore(), 'notifications', 'notif1')));
  });

  it('denies reading other users notifications', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'notifications', 'notif1'), {
        recipientUserId: 'user1', read: false,
      });
    });

    const authed = testEnv.authenticatedContext('user2');
    await assertFails(getDoc(doc(authed.firestore(), 'notifications', 'notif1')));
  });
});

describe('references collection', () => {
  it('allows any authenticated user to read references', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'references', 'ref1'), {
        babysitterUserId: 'bs1',
        type: 'family_submitted',
        status: 'approved',
        submittedByUserId: 'parent1',
      });
    });

    // Both the babysitter and an unrelated authenticated user can read
    const bsCtx = testEnv.authenticatedContext('bs1');
    await assertSucceeds(getDoc(doc(bsCtx.firestore(), 'references', 'ref1')));

    const otherCtx = testEnv.authenticatedContext('someone-else');
    await assertSucceeds(getDoc(doc(otherCtx.firestore(), 'references', 'ref1')));
  });

  it('denies unauthenticated reads', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'references', 'ref-unauth'), {
        babysitterUserId: 'bs1',
        type: 'manual',
        status: 'approved',
      });
    });

    const unauthed = testEnv.unauthenticatedContext();
    await assertFails(getDoc(doc(unauthed.firestore(), 'references', 'ref-unauth')));
  });

  it('allows babysitter to create a reference for themselves (babysitterUserId matches)', async () => {
    const bsCtx = testEnv.authenticatedContext('bs-writer');
    await assertSucceeds(
      setDoc(doc(bsCtx.firestore(), 'references', 'ref-by-bs'), {
        babysitterUserId: 'bs-writer',
        type: 'manual',
        status: 'pending',
      }),
    );
  });

  it('allows submitter to create a reference they submitted (submittedByUserId matches)', async () => {
    const parentCtx = testEnv.authenticatedContext('parent-writer');
    await assertSucceeds(
      setDoc(doc(parentCtx.firestore(), 'references', 'ref-by-parent'), {
        babysitterUserId: 'some-babysitter',
        submittedByUserId: 'parent-writer',
        type: 'family_submitted',
        status: 'pending',
      }),
    );
  });

  it('denies creating a reference where caller is neither babysitter nor submitter', async () => {
    const outsiderCtx = testEnv.authenticatedContext('outsider');
    await assertFails(
      setDoc(doc(outsiderCtx.firestore(), 'references', 'ref-outsider'), {
        babysitterUserId: 'some-babysitter',
        submittedByUserId: 'someone-else',
        type: 'family_submitted',
        status: 'pending',
      }),
    );
  });

  it('allows babysitter to update their own reference (e.g. approve it)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'references', 'ref-approve'), {
        babysitterUserId: 'bs-approver',
        submittedByUserId: 'parent1',
        type: 'family_submitted',
        status: 'pending',
      });
    });

    const bsCtx = testEnv.authenticatedContext('bs-approver');
    await assertSucceeds(
      updateDoc(doc(bsCtx.firestore(), 'references', 'ref-approve'), { status: 'approved' }),
    );
  });

  it('denies updating a reference by an unrelated user', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'references', 'ref-deny-update'), {
        babysitterUserId: 'bs1',
        submittedByUserId: 'parent1',
        type: 'family_submitted',
        status: 'pending',
      });
    });

    const outsiderCtx = testEnv.authenticatedContext('outsider-updater');
    await assertFails(
      updateDoc(doc(outsiderCtx.firestore(), 'references', 'ref-deny-update'), {
        status: 'approved',
      }),
    );
  });

  it('denies deleting references (delete is always false)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'references', 'ref-nodelete'), {
        babysitterUserId: 'bs1',
        type: 'manual',
        status: 'approved',
      });
    });

    const bsCtx = testEnv.authenticatedContext('bs1');
    const { deleteDoc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(bsCtx.firestore(), 'references', 'ref-nodelete')));
  });
});
