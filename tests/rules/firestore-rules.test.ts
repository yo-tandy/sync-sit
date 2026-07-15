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
        uid: 'user1', status: 'active', email: 'test@ejm.org',
        profiles: { babysitter: { enrollmentComplete: true, ejemEmail: 'test@ejm.org' } },
      });
    });

    const authed = testEnv.authenticatedContext('user1');
    await assertSucceeds(getDoc(doc(authed.firestore(), 'users', 'user1')));
  });

  it('denies user from reading another users profile directly (unless babysitter)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', 'other'), {
        uid: 'other', status: 'active', email: 'other@test.com',
        profiles: { parent: { familyId: 'famOther' } },
      });
    });

    const authed = testEnv.authenticatedContext('user1');
    // Parent docs are only readable by owner, admin, or family members
    await assertFails(getDoc(doc(authed.firestore(), 'users', 'other')));
  });

  it('denies creating user docs from client', async () => {
    const authed = testEnv.authenticatedContext('newuser');
    await assertFails(
      setDoc(doc(authed.firestore(), 'users', 'newuser'), {
        uid: 'newuser', status: 'active', profiles: { babysitter: { enrollmentComplete: false } },
      })
    );
  });
});

// Plan D user-read gates: identity at top level, role data under profiles.{role}.
describe('users collection — Plan D reads', () => {
  async function seed(id: string, data: Record<string, unknown>) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', id), { uid: id, ...data });
    });
  }

  it('admin (isAdmin:true) can read another user doc', async () => {
    await seed('adminN', { isAdmin: true, status: 'active', email: 'a@x.com', profiles: {} });
    await seed('someParent', { status: 'active', email: 'p@x.com', profiles: { parent: { familyId: 'famZ' } } });
    const authed = testEnv.authenticatedContext('adminN');
    await assertSucceeds(getDoc(doc(authed.firestore(), 'users', 'someParent')));
  });

  it('active babysitter is readable by any authed user', async () => {
    await seed('bsN', { status: 'active', email: 'b@ejm.org', profiles: { babysitter: { ejemEmail: 'b@ejm.org', searchable: true } } });
    await seed('caller', { status: 'active', email: 'c@x.com', profiles: { parent: { familyId: 'famC' } } });
    const authed = testEnv.authenticatedContext('caller');
    await assertSucceeds(getDoc(doc(authed.firestore(), 'users', 'bsN')));
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

  it('parent canNOT read a different-family parent doc', async () => {
    await seed('otherFamN', { status: 'active', email: 'o@x.com', profiles: { parent: { familyId: 'famOther' } } });
    await seed('meN', { status: 'active', email: 'me@x.com', profiles: { parent: { familyId: 'famMine' } } });
    const authed = testEnv.authenticatedContext('meN');
    await assertFails(getDoc(doc(authed.firestore(), 'users', 'otherFamN')));
  });

  // The babysitter-read gate backs the client babysitter-search query
  // (SubmittedEndorsementsPage). Under Plan D the client filters the new
  // profiles.babysitter shape; the rule must keep that list query provably
  // allowed. Regression guard for the rule's query-provability.
  it('allows the Plan D babysitter list query (status + profiles.babysitter)', async () => {
    await seed('bsQ', { status: 'active', email: 'b@ejm.org', profiles: { babysitter: { ejemEmail: 'b@ejm.org', enrollmentComplete: true, searchable: true } } });
    await seed('callerQ', { status: 'active', email: 'c@x.com', profiles: { parent: { familyId: 'famQ' } } });
    const authed = testEnv.authenticatedContext('callerQ');
    const q = query(
      collection(authed.firestore(), 'users'),
      where('status', '==', 'active'),
      where('profiles.babysitter.enrollmentComplete', 'in', [true, false]),
    );
    await assertSucceeds(getDocs(q));
  });
});

// Plan D owner-update guards: owners may edit mutable fields inside their own
// profile, but may not escalate roles or mutate server-owned identity fields.
describe('users collection — Plan D owner-update guards', () => {
  async function seed(id: string, data: Record<string, unknown>) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', id), { uid: id, ...data });
    });
  }

  it('babysitter may toggle their own searchable flag', async () => {
    await seed('bs1', { status: 'active', email: 'b@ejm.org', profiles: { babysitter: { ejemEmail: 'b@ejm.org', enrollmentComplete: true, searchable: false } } });
    const authed = testEnv.authenticatedContext('bs1');
    await assertSucceeds(
      updateDoc(doc(authed.firestore(), 'users', 'bs1'), { 'profiles.babysitter.searchable': true })
    );
  });

  it('babysitter may edit mutable profile fields (hourlyRate, contactEmail)', async () => {
    await seed('bs2', { status: 'active', email: 'b@ejm.org', profiles: { babysitter: { ejemEmail: 'b@ejm.org', enrollmentComplete: true } } });
    const authed = testEnv.authenticatedContext('bs2');
    await assertSucceeds(
      updateDoc(doc(authed.firestore(), 'users', 'bs2'), {
        'profiles.babysitter.hourlyRate': 20,
        'profiles.babysitter.contactEmail': 'me@x.com',
      })
    );
  });

  it('babysitter may NOT change profiles.babysitter.ejemEmail', async () => {
    await seed('bs3', { status: 'active', email: 'b@ejm.org', profiles: { babysitter: { ejemEmail: 'b@ejm.org', enrollmentComplete: true } } });
    const authed = testEnv.authenticatedContext('bs3');
    await assertFails(
      updateDoc(doc(authed.firestore(), 'users', 'bs3'), { 'profiles.babysitter.ejemEmail': 'evil@x.com' })
    );
  });

  it('babysitter may NOT change profiles.babysitter.approvedFamilies', async () => {
    await seed('bs4', { status: 'active', email: 'b@ejm.org', profiles: { babysitter: { ejemEmail: 'b@ejm.org', enrollmentComplete: true, approvedFamilies: [] } } });
    const authed = testEnv.authenticatedContext('bs4');
    await assertFails(
      updateDoc(doc(authed.firestore(), 'users', 'bs4'), { 'profiles.babysitter.approvedFamilies': ['famX'] })
    );
  });

  it('parent may NOT inject a babysitter profile (role escalation)', async () => {
    await seed('par1', { status: 'active', email: 'p@x.com', profiles: { parent: { familyId: 'famP', enrollmentComplete: true } } });
    const authed = testEnv.authenticatedContext('par1');
    await assertFails(
      updateDoc(doc(authed.firestore(), 'users', 'par1'), { 'profiles.babysitter.searchable': true })
    );
  });

  it('parent may NOT change their profiles.parent.familyId', async () => {
    await seed('par2', { status: 'active', email: 'p@x.com', profiles: { parent: { familyId: 'famP', enrollmentComplete: true } } });
    const authed = testEnv.authenticatedContext('par2');
    await assertFails(
      updateDoc(doc(authed.firestore(), 'users', 'par2'), { 'profiles.parent.familyId': 'famOther' })
    );
  });

  it('owner may NOT grant themselves isAdmin', async () => {
    await seed('bs5', { status: 'active', email: 'b@ejm.org', profiles: { babysitter: { ejemEmail: 'b@ejm.org', enrollmentComplete: true } } });
    const authed = testEnv.authenticatedContext('bs5');
    await assertFails(
      updateDoc(doc(authed.firestore(), 'users', 'bs5'), { isAdmin: true })
    );
  });

  it('owner may NOT change their own status (ban gate)', async () => {
    await seed('bs6', { status: 'active', email: 'b@ejm.org', profiles: { babysitter: { ejemEmail: 'b@ejm.org', enrollmentComplete: true } } });
    const authed = testEnv.authenticatedContext('bs6');
    await assertFails(
      updateDoc(doc(authed.firestore(), 'users', 'bs6'), { status: 'blocked' })
    );
  });

  // Tutor state machine is server-owned: enrollmentComplete is flipped only by
  // admin approval (reviewVerification), ejemEmail by enrollTutor, and the
  // verification block by the verification callables. Owners may edit the rest
  // of their tutor profile freely.
  function seedTutor(id: string) {
    return seed(id, {
      status: 'active', email: 't@ejm.org',
      profiles: {
        tutor: {
          ejemEmail: 't@ejm.org',
          enrollmentComplete: false,
          searchable: false,
          subjects: ['math'],
          contactEmail: 't@x.com',
          verification: { identityStatus: 'not_submitted' },
        },
      },
    });
  }

  it('tutor may edit their own subjects', async () => {
    await seedTutor('tu1');
    const authed = testEnv.authenticatedContext('tu1');
    await assertSucceeds(
      updateDoc(doc(authed.firestore(), 'users', 'tu1'), { 'profiles.tutor.subjects': ['math', 'physics'] })
    );
  });

  it('tutor may edit their own contactEmail', async () => {
    await seedTutor('tu2');
    const authed = testEnv.authenticatedContext('tu2');
    await assertSucceeds(
      updateDoc(doc(authed.firestore(), 'users', 'tu2'), { 'profiles.tutor.contactEmail': 'new@x.com' })
    );
  });

  it('tutor may toggle their own searchable flag', async () => {
    await seedTutor('tu3');
    const authed = testEnv.authenticatedContext('tu3');
    await assertSucceeds(
      updateDoc(doc(authed.firestore(), 'users', 'tu3'), { 'profiles.tutor.searchable': true })
    );
  });

  it('tutor may NOT change profiles.tutor.enrollmentComplete', async () => {
    await seedTutor('tu4');
    const authed = testEnv.authenticatedContext('tu4');
    await assertFails(
      updateDoc(doc(authed.firestore(), 'users', 'tu4'), { 'profiles.tutor.enrollmentComplete': true })
    );
  });

  it('tutor may NOT change profiles.tutor.ejemEmail', async () => {
    await seedTutor('tu5');
    const authed = testEnv.authenticatedContext('tu5');
    await assertFails(
      updateDoc(doc(authed.firestore(), 'users', 'tu5'), { 'profiles.tutor.ejemEmail': 'evil@x.com' })
    );
  });

  it('tutor may NOT change profiles.tutor.verification.identityStatus', async () => {
    await seedTutor('tu6');
    const authed = testEnv.authenticatedContext('tu6');
    await assertFails(
      updateDoc(doc(authed.firestore(), 'users', 'tu6'), { 'profiles.tutor.verification.identityStatus': 'approved' })
    );
  });

  // approvedFamilies is the consent audit trail: written ONLY by
  // respondToTutorContactRequest on accept. A tutor granting themselves a
  // family would bypass the contact-request flow and its audit record.
  it('tutor may NOT change profiles.tutor.approvedFamilies', async () => {
    await seed('tu7', {
      status: 'active', email: 't@ejm.org',
      profiles: {
        tutor: {
          ejemEmail: 't@ejm.org',
          enrollmentComplete: false,
          searchable: false,
          subjects: ['math'],
          approvedFamilies: [],
          verification: { identityStatus: 'not_submitted' },
        },
      },
    });
    const authed = testEnv.authenticatedContext('tu7');
    await assertFails(
      updateDoc(doc(authed.firestore(), 'users', 'tu7'), { 'profiles.tutor.approvedFamilies': ['famX'] })
    );
  });

  // The tutor guard must default safely for users WITHOUT a tutor profile,
  // otherwise a parent-only user's ordinary profile edit would break.
  it('parent-only user may still edit their own profile (tutor guard defaults safely)', async () => {
    await seed('par3', { status: 'active', email: 'p@x.com', profiles: { parent: { familyId: 'famP', enrollmentComplete: true } } });
    const authed = testEnv.authenticatedContext('par3');
    await assertSucceeds(
      updateDoc(doc(authed.firestore(), 'users', 'par3'), { 'profiles.parent.note': 'hello' })
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

  // Tutor endorsements reuse the references collection keyed by
  // (tutorUserId, appSource:'study', submittedByFamilyId). Those keys are the
  // identity tuple for a study endorsement — a submitter must not transfer their
  // endorsement to a different tutor, relabel its app, or move it to a different
  // family, exactly as babysitterUserId is pinned for sit references.
  it('denies a study-endorsement submitter from flipping tutorUserId', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'references', 'ref-study-1'), {
        babysitterUserId: null,
        tutorUserId: 'tutor-a',
        appSource: 'study',
        submittedByUserId: 'parentSub',
        submittedByFamilyId: 'famSub',
        type: 'family_submitted',
        status: 'private',
      });
    });
    const subCtx = testEnv.authenticatedContext('parentSub');
    await assertFails(
      updateDoc(doc(subCtx.firestore(), 'references', 'ref-study-1'), { tutorUserId: 'tutor-b' }),
    );
  });

  it('denies a study-endorsement submitter from flipping appSource', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'references', 'ref-study-2'), {
        babysitterUserId: null,
        tutorUserId: 'tutor-a',
        appSource: 'study',
        submittedByUserId: 'parentSub',
        submittedByFamilyId: 'famSub',
        type: 'family_submitted',
        status: 'private',
      });
    });
    const subCtx = testEnv.authenticatedContext('parentSub');
    await assertFails(
      updateDoc(doc(subCtx.firestore(), 'references', 'ref-study-2'), { appSource: 'sit' }),
    );
  });

  it('denies a study-endorsement submitter from flipping submittedByFamilyId', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'references', 'ref-study-3'), {
        babysitterUserId: null,
        tutorUserId: 'tutor-a',
        appSource: 'study',
        submittedByUserId: 'parentSub',
        submittedByFamilyId: 'famSub',
        type: 'family_submitted',
        status: 'private',
      });
    });
    const subCtx = testEnv.authenticatedContext('parentSub');
    await assertFails(
      updateDoc(doc(subCtx.firestore(), 'references', 'ref-study-3'), { submittedByFamilyId: 'famOther' }),
    );
  });

  it('still allows a study-endorsement submitter to edit the reference body', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'references', 'ref-study-4'), {
        babysitterUserId: null,
        tutorUserId: 'tutor-a',
        appSource: 'study',
        submittedByUserId: 'parentSub',
        submittedByFamilyId: 'famSub',
        type: 'family_submitted',
        status: 'private',
      });
    });
    const subCtx = testEnv.authenticatedContext('parentSub');
    await assertSucceeds(
      updateDoc(doc(subCtx.firestore(), 'references', 'ref-study-4'), { referenceText: 'Updated endorsement text' }),
    );
  });

  // Content freeze after acceptance: once the tutor/babysitter accepts an
  // endorsement its text becomes profile-visible. If the submitter could still
  // rewrite referenceText post-approval, "approve-innocuous-then-edit" would
  // defeat the consent model. Submitter edits are therefore private-only.
  it('denies a study-endorsement submitter from editing referenceText after acceptance', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'references', 'ref-frozen-study'), {
        babysitterUserId: null,
        tutorUserId: 'tutor-a',
        appSource: 'study',
        submittedByUserId: 'parentSub',
        submittedByFamilyId: 'famSub',
        type: 'family_submitted',
        status: 'approved',
        referenceText: 'Original innocuous text.',
      });
    });
    const subCtx = testEnv.authenticatedContext('parentSub');
    await assertFails(
      updateDoc(doc(subCtx.firestore(), 'references', 'ref-frozen-study'), { referenceText: 'Rewritten after approval.' }),
    );
  });

  it('denies a sit-endorsement submitter from editing referenceText after acceptance', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'references', 'ref-frozen-sit'), {
        babysitterUserId: 'bs-a',
        submittedByUserId: 'parentSub',
        type: 'family_submitted',
        status: 'approved',
        referenceText: 'Original innocuous text.',
      });
    });
    const subCtx = testEnv.authenticatedContext('parentSub');
    await assertFails(
      updateDoc(doc(subCtx.firestore(), 'references', 'ref-frozen-sit'), { referenceText: 'Rewritten after approval.' }),
    );
  });

  it('still allows a submitter to edit referenceText while the doc is private', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'references', 'ref-private-edit'), {
        babysitterUserId: 'bs-a',
        submittedByUserId: 'parentSub',
        type: 'family_submitted',
        status: 'private',
        referenceText: 'Original text.',
      });
    });
    const subCtx = testEnv.authenticatedContext('parentSub');
    await assertSucceeds(
      updateDoc(doc(subCtx.firestore(), 'references', 'ref-private-edit'), { referenceText: 'Edited while private.' }),
    );
  });

  it('still allows a submitter to remove their own private endorsement', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'references', 'ref-private-remove'), {
        babysitterUserId: 'bs-a',
        submittedByUserId: 'parentSub',
        type: 'family_submitted',
        status: 'private',
        referenceText: 'Some text.',
      });
    });
    const subCtx = testEnv.authenticatedContext('parentSub');
    await assertSucceeds(
      updateDoc(doc(subCtx.firestore(), 'references', 'ref-private-remove'), { status: 'removed' }),
    );
  });
});

// studyContactRequests: consent-flow docs written exclusively by callables via
// the Admin SDK. Readable by the involved tutor, the requesting family's
// members, or an admin; never writable from the client SDK.
describe('studyContactRequests collection', () => {
  async function seedRequest() {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'studyContactRequests', 'req1'), {
        requestId: 'req1',
        tutorUserId: 'tutorX',
        familyId: 'famX',
        status: 'pending',
      });
      await setDoc(doc(ctx.firestore(), 'families', 'famX'), {
        familyId: 'famX', parentIds: ['parentX'],
      });
    });
  }

  it('allows the involved tutor to read their contact request', async () => {
    await seedRequest();
    const authed = testEnv.authenticatedContext('tutorX');
    await assertSucceeds(getDoc(doc(authed.firestore(), 'studyContactRequests', 'req1')));
  });

  it('allows a family member to read their family contact request', async () => {
    await seedRequest();
    const authed = testEnv.authenticatedContext('parentX');
    await assertSucceeds(getDoc(doc(authed.firestore(), 'studyContactRequests', 'req1')));
  });

  it('denies a stranger from reading a contact request', async () => {
    await seedRequest();
    const authed = testEnv.authenticatedContext('stranger');
    await assertFails(getDoc(doc(authed.firestore(), 'studyContactRequests', 'req1')));
  });

  it('denies unauthenticated reads', async () => {
    await seedRequest();
    const unauthed = testEnv.unauthenticatedContext();
    await assertFails(getDoc(doc(unauthed.firestore(), 'studyContactRequests', 'req1')));
  });

  it('denies client create even by the involved tutor', async () => {
    const authed = testEnv.authenticatedContext('tutorX');
    await assertFails(
      setDoc(doc(authed.firestore(), 'studyContactRequests', 'req-new'), {
        requestId: 'req-new', tutorUserId: 'tutorX', familyId: 'famX', status: 'pending',
      }),
    );
  });

  it('denies client update even by the involved tutor', async () => {
    await seedRequest();
    const authed = testEnv.authenticatedContext('tutorX');
    await assertFails(
      updateDoc(doc(authed.firestore(), 'studyContactRequests', 'req1'), { status: 'accepted' }),
    );
  });

  it('denies client delete even by the involved family member', async () => {
    await seedRequest();
    const authed = testEnv.authenticatedContext('parentX');
    const { deleteDoc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(authed.firestore(), 'studyContactRequests', 'req1')));
  });
});
