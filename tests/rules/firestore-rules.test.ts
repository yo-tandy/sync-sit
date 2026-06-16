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
import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';

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

// Plan D: the user-read gates must tolerate BOTH the legacy flat shape
// (top-level role/familyId) and the new shape (profiles.{role}, isAdmin).
describe('users collection — Plan D dual-shape reads', () => {
  async function seed(id: string, data: Record<string, unknown>) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', id), { uid: id, ...data });
    });
  }

  it('new-shape admin (isAdmin:true, no role) can read another user doc', async () => {
    await seed('adminN', { isAdmin: true, status: 'active', email: 'a@x.com', profiles: {} });
    await seed('someParent', { status: 'active', email: 'p@x.com', profiles: { parent: { familyId: 'famZ' } } });
    const authed = testEnv.authenticatedContext('adminN');
    await assertSucceeds(getDoc(doc(authed.firestore(), 'users', 'someParent')));
  });

  it('legacy admin (role:admin) still reads another user doc', async () => {
    await seed('adminL', { role: 'admin', status: 'active', email: 'a@x.com' });
    await seed('someParent', { role: 'parent', status: 'active', familyId: 'famZ', email: 'p@x.com' });
    const authed = testEnv.authenticatedContext('adminL');
    await assertSucceeds(getDoc(doc(authed.firestore(), 'users', 'someParent')));
  });

  it('new-shape active babysitter is readable by any authed user', async () => {
    await seed('bsN', { status: 'active', email: 'b@ejm.org', profiles: { babysitter: { ejemEmail: 'b@ejm.org', searchable: true } } });
    await seed('caller', { status: 'active', email: 'c@x.com', profiles: { parent: { familyId: 'famC' } } });
    const authed = testEnv.authenticatedContext('caller');
    await assertSucceeds(getDoc(doc(authed.firestore(), 'users', 'bsN')));
  });

  it('legacy active babysitter is still readable', async () => {
    await seed('bsL', { role: 'babysitter', status: 'active', email: 'b@ejm.org' });
    await seed('caller', { role: 'parent', status: 'active', familyId: 'famC', email: 'c@x.com' });
    const authed = testEnv.authenticatedContext('caller');
    await assertSucceeds(getDoc(doc(authed.firestore(), 'users', 'bsL')));
  });

  it('inactive new-shape babysitter is NOT readable by others', async () => {
    await seed('bsInactive', { status: 'blocked', email: 'b@ejm.org', profiles: { babysitter: { ejemEmail: 'b@ejm.org' } } });
    await seed('caller', { status: 'active', email: 'c@x.com', profiles: { parent: { familyId: 'famC' } } });
    const authed = testEnv.authenticatedContext('caller');
    await assertFails(getDoc(doc(authed.firestore(), 'users', 'bsInactive')));
  });

  it('new-shape parent reads a same-family member doc', async () => {
    await seed('coN', { status: 'active', email: 'co@x.com', profiles: { parent: { familyId: 'famSame' } } });
    await seed('meN', { status: 'active', email: 'me@x.com', profiles: { parent: { familyId: 'famSame' } } });
    const authed = testEnv.authenticatedContext('meN');
    await assertSucceeds(getDoc(doc(authed.firestore(), 'users', 'coN')));
  });

  it('legacy parent reads a same-family member doc', async () => {
    await seed('coL', { role: 'parent', status: 'active', familyId: 'famSame', email: 'co@x.com' });
    await seed('meL', { role: 'parent', status: 'active', familyId: 'famSame', email: 'me@x.com' });
    const authed = testEnv.authenticatedContext('meL');
    await assertSucceeds(getDoc(doc(authed.firestore(), 'users', 'coL')));
  });

  it('parent canNOT read a different-family parent doc', async () => {
    await seed('otherFamN', { status: 'active', email: 'o@x.com', profiles: { parent: { familyId: 'famOther' } } });
    await seed('meN', { status: 'active', email: 'me@x.com', profiles: { parent: { familyId: 'famMine' } } });
    const authed = testEnv.authenticatedContext('meN');
    await assertFails(getDoc(doc(authed.firestore(), 'users', 'otherFamN')));
  });

  // The babysitter-read gate backs the searchBabysitters client query. The
  // rewritten rule must keep that query provably allowed (the query still
  // filters the legacy role/status/searchable fields during the pre-Tier-D
  // window). Regression guard for the rule's query-provability.
  it('allows the searchBabysitters client query (role+status+searchable)', async () => {
    await seed('bsQ', { role: 'babysitter', status: 'active', searchable: true, email: 'b@ejm.org' });
    await seed('callerQ', { role: 'parent', status: 'active', familyId: 'famQ', email: 'c@x.com' });
    const authed = testEnv.authenticatedContext('callerQ');
    const q = query(
      collection(authed.firestore(), 'users'),
      where('role', '==', 'babysitter'),
      where('status', '==', 'active'),
      where('searchable', '==', true),
    );
    await assertSucceeds(getDocs(q));
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
        status: 'private',
      }),
    );
  });

  it('denies creating a manual reference where caller is not the babysitter', async () => {
    const outsiderCtx = testEnv.authenticatedContext('outsider');
    await assertFails(
      setDoc(doc(outsiderCtx.firestore(), 'references', 'ref-outsider'), {
        babysitterUserId: 'some-babysitter',
        type: 'manual',
        status: 'private',
      }),
    );
  });

  it('allows babysitter to update their own reference body but not promote status', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'references', 'ref-edit'), {
        babysitterUserId: 'bs-editor',
        submittedByUserId: 'parent1',
        type: 'family_submitted',
        status: 'private',
      });
    });

    const bsCtx = testEnv.authenticatedContext('bs-editor');
    // Editing body content is allowed
    await assertSucceeds(
      updateDoc(doc(bsCtx.firestore(), 'references', 'ref-edit'), { body: 'Updated text' }),
    );
    // Promoting to approved is denied per BL-4 (publish/approve must go through a future callable)
    await assertFails(
      updateDoc(doc(bsCtx.firestore(), 'references', 'ref-edit'), { status: 'approved' }),
    );
  });

  it('denies creating a reference with non-private initial status (BL-3 closure)', async () => {
    const bsCtx = testEnv.authenticatedContext('bs-puffer');
    await assertFails(
      setDoc(doc(bsCtx.firestore(), 'references', 'ref-puffery'), {
        babysitterUserId: 'bs-puffer',
        type: 'manual',
        status: 'approved',  // attempted self-puffery via initial-state bypass
      }),
    );
  });

  it('denies promoting status to published via direct client write (BL-4 closure)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'references', 'ref-promote'), {
        babysitterUserId: 'bs-promoter',
        type: 'manual',
        status: 'private',
      });
    });
    const bsCtx = testEnv.authenticatedContext('bs-promoter');
    await assertFails(
      updateDoc(doc(bsCtx.firestore(), 'references', 'ref-promote'), { status: 'published' }),
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

  it('still allows a babysitter to create a manual reference about themselves', async () => {
    const authed = testEnv.authenticatedContext('babysitter1');
    await assertSucceeds(
      setDoc(doc(authed.firestore(), 'references', 'man1'), {
        babysitterUserId: 'babysitter1',
        type: 'manual',
        status: 'private',
        refName: 'Famille Bonjour',
        createdAt: new Date(),
      })
    );
  });

  it('denies a parent from creating a family_submitted reference via client SDK', async () => {
    const authed = testEnv.authenticatedContext('parent1');
    await assertFails(
      setDoc(doc(authed.firestore(), 'references', 'fs1'), {
        babysitterUserId: 'babysitter1',
        submittedByUserId: 'parent1',
        type: 'family_submitted',
        status: 'private',
        referenceText: 'I would have written this without the callable.',
        createdAt: new Date(),
      })
    );
  });

  it('still denies babysitter self-create with family_submitted type', async () => {
    const authed = testEnv.authenticatedContext('babysitter1');
    await assertFails(
      setDoc(doc(authed.firestore(), 'references', 'fs-self'), {
        babysitterUserId: 'babysitter1',
        submittedByUserId: 'babysitter1',
        type: 'family_submitted',
        status: 'private',
        referenceText: 'Trying self-puffery via the removed branch.',
        createdAt: new Date(),
      })
    );
  });

  it('still denies status transitions to approved/published from any client', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'references', 'r1'), {
        babysitterUserId: 'babysitter1',
        type: 'manual',
        status: 'private',
        createdAt: new Date(),
      });
    });

    const authed = testEnv.authenticatedContext('babysitter1');
    await assertFails(
      updateDoc(doc(authed.firestore(), 'references', 'r1'), { status: 'published' })
    );
    await assertFails(
      updateDoc(doc(authed.firestore(), 'references', 'r1'), { status: 'approved' })
    );
  });
});
