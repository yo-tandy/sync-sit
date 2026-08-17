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
import { doc, getDoc, setDoc, updateDoc, deleteDoc, deleteField, collection, query, where, getDocs, limit, orderBy } from 'firebase/firestore';

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

  // endorsementCount is a server-owned counter: written ONLY by
  // respondToTutorEndorsement on accept. A tutor inflating it would fake social
  // proof and distort search ranking.
  it('tutor may NOT change profiles.tutor.endorsementCount', async () => {
    await seed('tu8', {
      status: 'active', email: 't@ejm.org',
      profiles: {
        tutor: {
          ejemEmail: 't@ejm.org',
          enrollmentComplete: false,
          searchable: false,
          subjects: ['math'],
          endorsementCount: 0,
          verification: { identityStatus: 'not_submitted' },
        },
      },
    });
    const authed = testEnv.authenticatedContext('tu8');
    await assertFails(
      updateDoc(doc(authed.firestore(), 'users', 'tu8'), { 'profiles.tutor.endorsementCount': 99 })
    );
  });

  // Tutor self-service editing (issue #123): the four enrollment-frozen fields
  // are owner-editable. Seeds mirror enrollTutor's stored shape (absent-mode
  // fields explicit null, arrondissements []) with the server-owned siblings
  // present, and the payloads are the EXACT dot-path writes the Account
  // session-preferences section and the Area editor issue — proving the rules
  // accept them without touching approvedFamilies/endorsementCount.
  function seedLegacyDistanceTutor(id: string) {
    return seed(id, {
      status: 'active', email: 't@ejm.org',
      profiles: {
        tutor: {
          ejemEmail: 't@ejm.org',
          enrollmentComplete: true,
          searchable: true,
          subjects: ['math'],
          sessionLengthsMin: [45, 60],
          locationPrefs: ['online'],
          paddingMin: 15,
          // Legacy pre-fix enrollee: distance mode but NO coordinates.
          areaMode: 'distance',
          arrondissements: [],
          areaAddress: null,
          areaLatLng: null,
          areaRadiusKm: null,
          approvedFamilies: ['famA'],
          endorsementCount: 3,
          verification: { identityStatus: 'approved' },
        },
      },
    });
  }

  it('tutor may save the session-preferences payload (lengths/locations/padding dot-paths)', async () => {
    await seedLegacyDistanceTutor('tu10');
    const authed = testEnv.authenticatedContext('tu10');
    await assertSucceeds(
      updateDoc(doc(authed.firestore(), 'users', 'tu10'), {
        'profiles.tutor.sessionLengthsMin': [60, 75],
        'profiles.tutor.locationPrefs': ['online', 'tutor_home'],
        'profiles.tutor.paddingMin': 30,
        updatedAt: new Date(),
      })
    );
  });

  it('legacy no-coordinates tutor may self-service their areaLatLng (distance-mode save)', async () => {
    await seedLegacyDistanceTutor('tu11');
    const authed = testEnv.authenticatedContext('tu11');
    await assertSucceeds(
      updateDoc(doc(authed.firestore(), 'users', 'tu11'), {
        'profiles.tutor.areaMode': 'distance',
        'profiles.tutor.arrondissements': [],
        'profiles.tutor.areaAddress': '16 rue de Passy, 75016 Paris',
        'profiles.tutor.areaLatLng': { lat: 48.8571, lng: 2.2795 },
        'profiles.tutor.areaRadiusKm': 5,
        updatedAt: new Date(),
      })
    );
  });

  it('tutor may switch area mode, nulling the distance fields like enrollment stores them', async () => {
    await seedLegacyDistanceTutor('tu12');
    const authed = testEnv.authenticatedContext('tu12');
    await assertSucceeds(
      updateDoc(doc(authed.firestore(), 'users', 'tu12'), {
        'profiles.tutor.areaMode': 'arrondissement',
        'profiles.tutor.arrondissements': ['75016', '75017'],
        'profiles.tutor.areaAddress': null,
        'profiles.tutor.areaLatLng': null,
        'profiles.tutor.areaRadiusKm': null,
        updatedAt: new Date(),
      })
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

// References READ hardening (Hardening PR H2).
// Before H2 the read rule was `allow read: if isAuth()`, so ANY authenticated
// user could read PRIVATE and REMOVED endorsements — referenceText,
// submittedByName, submittedByFamilyId — for both sit and study, and the
// tutor/babysitter-keyed composite made harvesting efficient. H2 restricts
// reads to: publicly-visible statuses ('approved'/'published') OR an involved
// party (recipient babysitter/tutor, the submitter, or a member of the
// submitting family) OR an admin. Because a LIST is allowed only if the rules
// engine can prove the read rule for every matching doc from the QUERY
// CONSTRAINTS alone, every audited client query is replayed here in list mode
// with its real filters (see the PR audit matrix). The stranger-reads-private
// tests are RED against the pre-H2 rule (they assert a deny the old rule
// allowed) and GREEN after.
describe('references collection — read hardening (H2)', () => {
  async function seed(id: string, data: Record<string, unknown>) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'references', id), data);
    });
  }
  async function seedFamily(id: string, parentIds: string[]) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'families', id), { familyId: id, parentIds });
    });
  }
  async function seedAdmin(id: string) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', id), {
        uid: id, isAdmin: true, status: 'active', email: `${id}@x.com`, profiles: {},
      });
    });
  }

  // ── Exposure closure: RED against the pre-H2 `if isAuth()` rule ──
  it('denies a stranger reading a PRIVATE study endorsement', async () => {
    await seed('h2-priv-study', {
      tutorUserId: 'tutorA', appSource: 'study', submittedByUserId: 'parentSub',
      submittedByFamilyId: 'famSub', type: 'family_submitted', status: 'private',
      referenceText: 'Private endorsement text',
    });
    const stranger = testEnv.authenticatedContext('stranger');
    await assertFails(getDoc(doc(stranger.firestore(), 'references', 'h2-priv-study')));
  });

  it('denies a stranger reading a PRIVATE sit reference', async () => {
    await seed('h2-priv-sit', {
      babysitterUserId: 'bsA', submittedByUserId: 'parentSub', submittedByFamilyId: 'famSub',
      type: 'family_submitted', status: 'private', referenceText: 'Private reference text',
    });
    const stranger = testEnv.authenticatedContext('stranger');
    await assertFails(getDoc(doc(stranger.firestore(), 'references', 'h2-priv-sit')));
  });

  it('denies a stranger reading a REMOVED reference', async () => {
    await seed('h2-removed', {
      babysitterUserId: 'bsA', type: 'manual', status: 'removed', referenceText: 'redacted',
    });
    const stranger = testEnv.authenticatedContext('stranger');
    await assertFails(getDoc(doc(stranger.firestore(), 'references', 'h2-removed')));
  });

  // ── Public statuses stay world-readable (green before & after) ──
  it('allows a stranger to read an APPROVED reference', async () => {
    await seed('h2-approved', { babysitterUserId: 'bsA', type: 'family_submitted', status: 'approved' });
    const stranger = testEnv.authenticatedContext('stranger');
    await assertSucceeds(getDoc(doc(stranger.firestore(), 'references', 'h2-approved')));
  });

  it('allows a stranger to read a PUBLISHED study endorsement', async () => {
    await seed('h2-published', { tutorUserId: 'tutorA', appSource: 'study', status: 'published' });
    const stranger = testEnv.authenticatedContext('stranger');
    await assertSucceeds(getDoc(doc(stranger.firestore(), 'references', 'h2-published')));
  });

  // ── Involved parties read their own private docs ──
  it('allows the recipient babysitter to read their own private reference', async () => {
    await seed('h2-bs-own', {
      babysitterUserId: 'bsOwner', submittedByUserId: 'parentSub', type: 'family_submitted', status: 'private',
    });
    const bs = testEnv.authenticatedContext('bsOwner');
    await assertSucceeds(getDoc(doc(bs.firestore(), 'references', 'h2-bs-own')));
  });

  it('allows the recipient tutor to read their own private endorsement', async () => {
    await seed('h2-tutor-own', {
      tutorUserId: 'tutorOwner', appSource: 'study', submittedByUserId: 'parentSub',
      submittedByFamilyId: 'famSub', type: 'family_submitted', status: 'private',
    });
    const tutor = testEnv.authenticatedContext('tutorOwner');
    await assertSucceeds(getDoc(doc(tutor.firestore(), 'references', 'h2-tutor-own')));
  });

  it('allows the submitter to read their own private endorsement', async () => {
    await seed('h2-sub-own', {
      tutorUserId: 'tutorA', appSource: 'study', submittedByUserId: 'parentSub',
      submittedByFamilyId: 'famSub', type: 'family_submitted', status: 'private',
    });
    const sub = testEnv.authenticatedContext('parentSub');
    await assertSucceeds(getDoc(doc(sub.firestore(), 'references', 'h2-sub-own')));
  });

  it("allows a member of the submitting family to read the family's private endorsement (submitted by the OTHER parent)", async () => {
    await seedFamily('famTwo', ['parentSub', 'parentOther']);
    await seed('h2-fam', {
      tutorUserId: 'tutorA', appSource: 'study', submittedByUserId: 'parentSub',
      submittedByFamilyId: 'famTwo', type: 'family_submitted', status: 'private',
    });
    const other = testEnv.authenticatedContext('parentOther'); // NOT the submitter
    await assertSucceeds(getDoc(doc(other.firestore(), 'references', 'h2-fam')));
  });

  // ── Admin ──
  it('allows an admin to read a private reference', async () => {
    await seedAdmin('adminH2');
    await seed('h2-admin-read', { babysitterUserId: 'bsA', type: 'family_submitted', status: 'private' });
    const admin = testEnv.authenticatedContext('adminH2');
    await assertSucceeds(getDoc(doc(admin.firestore(), 'references', 'h2-admin-read')));
  });

  // isFamilyMember-on-sentinel behavior (explicit): a sit MANUAL doc carries NO
  // submittedByFamilyId. The family disjunct must resolve to a clean false for
  // such a doc and must NOT hard-error the whole || chain — otherwise a LATER
  // disjunct (isAdmin) is never reached. This test pins that: an admin reading a
  // manual doc lacking submittedByFamilyId must be ALLOWED via the isAdmin()
  // disjunct that follows the family disjunct. If this FAILS, the family
  // disjunct is erroring the chain and must be guarded with a has-key check.
  it('allows an admin to read a manual reference lacking submittedByFamilyId (family disjunct must not error the chain)', async () => {
    await seedAdmin('adminH2b');
    await seed('h2-manual-nofam', { babysitterUserId: 'bsA', type: 'manual', status: 'private' });
    const admin = testEnv.authenticatedContext('adminH2b');
    await assertSucceeds(getDoc(doc(admin.firestore(), 'references', 'h2-manual-nofam')));
  });

  it('denies a stranger reading a manual reference lacking submittedByFamilyId', async () => {
    await seed('h2-manual-nofam2', { babysitterUserId: 'bsA', type: 'manual', status: 'private' });
    const stranger = testEnv.authenticatedContext('stranger');
    await assertFails(getDoc(doc(stranger.firestore(), 'references', 'h2-manual-nofam2')));
  });

  // ── Audited client queries replayed as list-mode rules tests ──
  // (site → proving disjunct; see the PR audit matrix)
  it('LIST #1/#2 public-status: babysitterUserId + status in [approved,published] (SearchPage / ExpandableBabysitterCard)', async () => {
    await seed('h2-l1a', { babysitterUserId: 'bsL', type: 'family_submitted', status: 'approved' });
    await seed('h2-l1b', { babysitterUserId: 'bsL', type: 'manual', status: 'published' });
    const searcher = testEnv.authenticatedContext('searcher');
    await assertSucceeds(getDocs(query(
      collection(searcher.firestore(), 'references'),
      where('babysitterUserId', '==', 'bsL'),
      where('status', 'in', ['approved', 'published']),
      limit(10),
    )));
  });

  it('LIST #3/#4 involved: babysitterUserId == own uid (useEndorsements / babysitter DashboardPage)', async () => {
    await seed('h2-l3', { babysitterUserId: 'bsSelf', type: 'manual', status: 'private' });
    const bs = testEnv.authenticatedContext('bsSelf');
    await assertSucceeds(getDocs(query(
      collection(bs.firestore(), 'references'),
      where('babysitterUserId', '==', 'bsSelf'),
    )));
  });

  it('LIST #5 involved: submittedByUserId == own uid (useSubmittedEndorsements / family DashboardPage after fix)', async () => {
    await seed('h2-l5', {
      babysitterUserId: 'bsX', submittedByUserId: 'parentSelf', submittedByFamilyId: 'famZ',
      type: 'family_submitted', status: 'private',
    });
    const sub = testEnv.authenticatedContext('parentSelf');
    await assertSucceeds(getDocs(query(
      collection(sub.firestore(), 'references'),
      where('submittedByUserId', '==', 'parentSelf'),
    )));
  });

  it('LIST #7 public-status: tutorUserId + status in [approved,published] (TutorCard)', async () => {
    await seed('h2-l7', { tutorUserId: 'tutorL', appSource: 'study', status: 'approved' });
    const viewer = testEnv.authenticatedContext('familyViewer');
    await assertSucceeds(getDocs(query(
      collection(viewer.firestore(), 'references'),
      where('tutorUserId', '==', 'tutorL'),
      where('status', 'in', ['approved', 'published']),
      limit(10),
    )));
  });

  it('LIST #8/#9 involved: tutorUserId == own uid (EndorsementsPage / tutor DashboardPage)', async () => {
    await seed('h2-l8', {
      tutorUserId: 'tutorSelf', appSource: 'study', submittedByUserId: 'p', submittedByFamilyId: 'f',
      type: 'family_submitted', status: 'private', createdAt: new Date(),
    });
    const tutor = testEnv.authenticatedContext('tutorSelf');
    await assertSucceeds(getDocs(query(
      collection(tutor.firestore(), 'references'),
      where('tutorUserId', '==', 'tutorSelf'),
      orderBy('createdAt', 'desc'),
    )));
  });

  it('LIST #10 family: submittedByFamilyId == mine + appSource == study (family RequestsPage)', async () => {
    await seedFamily('famReq', ['parentReq']);
    await seed('h2-l10', {
      tutorUserId: 'tutorA', appSource: 'study', submittedByUserId: 'parentReq',
      submittedByFamilyId: 'famReq', type: 'family_submitted', status: 'private',
    });
    const fam = testEnv.authenticatedContext('parentReq');
    await assertSucceeds(getDocs(query(
      collection(fam.firestore(), 'references'),
      where('submittedByFamilyId', '==', 'famReq'),
      where('appSource', '==', 'study'),
    )));
  });

  it('LIST admin: an unfiltered list is allowed for an admin (isAdmin is doc-independent)', async () => {
    await seedAdmin('adminList');
    await seed('h2-la1', { babysitterUserId: 'bsA', type: 'manual', status: 'private' });
    await seed('h2-la2', { tutorUserId: 'tutorA', appSource: 'study', status: 'private' });
    const admin = testEnv.authenticatedContext('adminList');
    await assertSucceeds(getDocs(collection(admin.firestore(), 'references')));
  });

  it('LIST denied: an unfiltered non-admin list is not provable', async () => {
    await seed('h2-ld1', { babysitterUserId: 'bsA', type: 'manual', status: 'approved' });
    const stranger = testEnv.authenticatedContext('stranger');
    await assertFails(getDocs(collection(stranger.firestore(), 'references')));
  });

  it("LIST denied: querying another family's endorsements (not a member) is denied", async () => {
    await seedFamily('famNotMine', ['someoneElse']);
    await seed('h2-ld2', {
      tutorUserId: 'tutorA', appSource: 'study', submittedByUserId: 'someoneElse',
      submittedByFamilyId: 'famNotMine', type: 'family_submitted', status: 'private',
    });
    const outsider = testEnv.authenticatedContext('outsiderFam');
    await assertFails(getDocs(query(
      collection(outsider.firestore(), 'references'),
      where('submittedByFamilyId', '==', 'famNotMine'),
      where('appSource', '==', 'study'),
    )));
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

// study-sessions: booking docs written exclusively by callables via the Admin
// SDK. Readable by the involved tutor, the booking family's members, or an
// admin; never writable from the client SDK.
describe('study-sessions collection', () => {
  async function seedSession() {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'study-sessions', 'sess1'), {
        sessionId: 'sess1',
        tutorUserId: 'tutorS',
        familyId: 'famS',
        status: 'pending',
      });
      await setDoc(doc(ctx.firestore(), 'families', 'famS'), {
        familyId: 'famS', parentIds: ['parentS'],
      });
    });
  }

  it('allows the involved tutor to read their session', async () => {
    await seedSession();
    const authed = testEnv.authenticatedContext('tutorS');
    await assertSucceeds(getDoc(doc(authed.firestore(), 'study-sessions', 'sess1')));
  });

  it('allows a family member to read their family session', async () => {
    await seedSession();
    const authed = testEnv.authenticatedContext('parentS');
    await assertSucceeds(getDoc(doc(authed.firestore(), 'study-sessions', 'sess1')));
  });

  it('denies a stranger from reading a session', async () => {
    await seedSession();
    const authed = testEnv.authenticatedContext('stranger');
    await assertFails(getDoc(doc(authed.firestore(), 'study-sessions', 'sess1')));
  });

  it('denies unauthenticated reads', async () => {
    await seedSession();
    const unauthed = testEnv.unauthenticatedContext();
    await assertFails(getDoc(doc(unauthed.firestore(), 'study-sessions', 'sess1')));
  });

  it('denies client create even by the involved tutor', async () => {
    const authed = testEnv.authenticatedContext('tutorS');
    await assertFails(
      setDoc(doc(authed.firestore(), 'study-sessions', 'sess-new'), {
        sessionId: 'sess-new', tutorUserId: 'tutorS', familyId: 'famS', status: 'pending',
      }),
    );
  });

  it('denies client update even by the involved tutor', async () => {
    await seedSession();
    const authed = testEnv.authenticatedContext('tutorS');
    await assertFails(
      updateDoc(doc(authed.firestore(), 'study-sessions', 'sess1'), { status: 'confirmed' }),
    );
  });

  it('denies client delete even by the involved family member', async () => {
    await seedSession();
    const authed = testEnv.authenticatedContext('parentS');
    const { deleteDoc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(authed.firestore(), 'study-sessions', 'sess1')));
  });
});

// study-session instances: concrete recurring occurrences, written only by the
// callables (Admin SDK). Read via the instance's OWN denormalized fields —
// party reads, no client writes. (Nested path only; no collection-group rule.)
describe('study-session instances subcollection', () => {
  const INST_PATH = ['study-sessions', 'seriesR', 'instances', '2027-06-07'] as const;
  async function seedInstance() {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), ...INST_PATH), {
        instanceId: '2027-06-07', sessionId: 'seriesR',
        tutorUserId: 'tutorR', familyId: 'famR', status: 'scheduled',
      });
      await setDoc(doc(ctx.firestore(), 'families', 'famR'), {
        familyId: 'famR', parentIds: ['parentR'],
      });
    });
  }

  it('allows the involved tutor to read an instance', async () => {
    await seedInstance();
    const authed = testEnv.authenticatedContext('tutorR');
    await assertSucceeds(getDoc(doc(authed.firestore(), ...INST_PATH)));
  });

  it('allows a family member to read an instance', async () => {
    await seedInstance();
    const authed = testEnv.authenticatedContext('parentR');
    await assertSucceeds(getDoc(doc(authed.firestore(), ...INST_PATH)));
  });

  it('denies a stranger from reading an instance', async () => {
    await seedInstance();
    const authed = testEnv.authenticatedContext('stranger');
    await assertFails(getDoc(doc(authed.firestore(), ...INST_PATH)));
  });

  it('denies unauthenticated instance reads', async () => {
    await seedInstance();
    const unauthed = testEnv.unauthenticatedContext();
    await assertFails(getDoc(doc(unauthed.firestore(), ...INST_PATH)));
  });

  it('denies client create even by the involved tutor', async () => {
    const authed = testEnv.authenticatedContext('tutorR');
    await assertFails(
      setDoc(doc(authed.firestore(), 'study-sessions', 'seriesR', 'instances', 'new'), {
        instanceId: 'new', sessionId: 'seriesR', tutorUserId: 'tutorR', familyId: 'famR', status: 'scheduled',
      }),
    );
  });

  it('denies client update even by the involved tutor', async () => {
    await seedInstance();
    const authed = testEnv.authenticatedContext('tutorR');
    await assertFails(
      updateDoc(doc(authed.firestore(), ...INST_PATH), { status: 'cancelled' }),
    );
  });

  it('denies client delete even by the involved family member', async () => {
    await seedInstance();
    const authed = testEnv.authenticatedContext('parentR');
    const { deleteDoc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(authed.firestore(), ...INST_PATH)));
  });
});

// Enrollment exemptions: admin-managed waivers for the DOB/grad-year
// consistency check. Read is admin-only; ALL writes go through the admin
// callables (Admin SDK), so client writes are denied even for admins.
describe('enrollmentExemptions collection', () => {
  const EXEMPTION_PATH = ['enrollmentExemptions', 'kid29@ejm.org'] as const;

  async function seedExemption() {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), ...EXEMPTION_PATH), {
        createdByUid: 'adminE', createdAt: new Date(), note: 'repeated a year',
      });
    });
  }

  async function seedUser(id: string, data: Record<string, unknown>) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', id), { uid: id, ...data });
    });
  }

  it('admin can read an exemption doc', async () => {
    await seedExemption();
    await seedUser('adminE', { isAdmin: true, status: 'active', email: 'a@x.com', profiles: {} });
    const authed = testEnv.authenticatedContext('adminE');
    await assertSucceeds(getDoc(doc(authed.firestore(), ...EXEMPTION_PATH)));
  });

  it('non-admin authed user cannot read', async () => {
    await seedExemption();
    await seedUser('plainE', { status: 'active', email: 'p@x.com', profiles: { parent: { familyId: 'famE' } } });
    const authed = testEnv.authenticatedContext('plainE');
    await assertFails(getDoc(doc(authed.firestore(), ...EXEMPTION_PATH)));
  });

  it('the exempted student themself cannot read their exemption', async () => {
    await seedExemption();
    await seedUser('kidE', { status: 'active', email: 'kid29@ejm.org', profiles: {} });
    const authed = testEnv.authenticatedContext('kidE');
    await assertFails(getDoc(doc(authed.firestore(), ...EXEMPTION_PATH)));
  });

  it('unauthenticated cannot read', async () => {
    await seedExemption();
    const unauthed = testEnv.unauthenticatedContext();
    await assertFails(getDoc(doc(unauthed.firestore(), ...EXEMPTION_PATH)));
  });

  it('even an admin cannot write client-side (callable-only)', async () => {
    await seedUser('adminE', { isAdmin: true, status: 'active', email: 'a@x.com', profiles: {} });
    const authed = testEnv.authenticatedContext('adminE');
    await assertFails(
      setDoc(doc(authed.firestore(), ...EXEMPTION_PATH), {
        createdByUid: 'adminE', createdAt: new Date(),
      }),
    );
  });

  it('non-admin cannot write', async () => {
    await seedUser('plainE', { status: 'active', email: 'p@x.com', profiles: {} });
    const authed = testEnv.authenticatedContext('plainE');
    await assertFails(
      setDoc(doc(authed.firestore(), ...EXEMPTION_PATH), { createdByUid: 'plainE', createdAt: new Date() }),
    );
  });

  it('non-admin cannot delete', async () => {
    await seedExemption();
    await seedUser('plainE', { status: 'active', email: 'p@x.com', profiles: {} });
    const authed = testEnv.authenticatedContext('plainE');
    const { deleteDoc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(authed.firestore(), ...EXEMPTION_PATH)));
  });
});

// ---------------------------------------------------------------------------
// Guardian foundation (governance PR 2): kidInvites / guardianLinks /
// adminAlerts access matrices, plus the users-doc governedBy/identityLocked
// pins. All guardian writes are callable-only (Admin SDK bypasses rules).
// ---------------------------------------------------------------------------

describe('guardian collections', () => {
  async function seedUser(id: string, data: Record<string, unknown>) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', id), { uid: id, ...data });
    });
  }

  async function seedFamily(id: string, parentIds: string[]) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'families', id), {
        familyId: id, familyName: 'G', parentIds, status: 'active',
      });
    });
  }

  async function seedRaw(path: [string, string], data: Record<string, unknown>) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), ...path), data);
    });
  }

  /** famG (parentG1, parentG2), famX (parentX), an admin, and a stranger. */
  async function seedActors() {
    await seedFamily('famG', ['parentG1', 'parentG2']);
    await seedFamily('famX', ['parentX']);
    await seedUser('parentG1', { status: 'active', email: 'g1@x.com', profiles: { parent: { familyId: 'famG', enrollmentComplete: true } } });
    await seedUser('parentG2', { status: 'active', email: 'g2@x.com', profiles: { parent: { familyId: 'famG', enrollmentComplete: true } } });
    await seedUser('parentX', { status: 'active', email: 'x@x.com', profiles: { parent: { familyId: 'famX', enrollmentComplete: true } } });
    await seedUser('adminG', { isAdmin: true, status: 'active', email: 'a@x.com', profiles: {} });
    await seedUser('strangerG', { status: 'active', email: 's@x.com', profiles: {} });
  }

  const INVITE: [string, string] = ['kidInvites', 'inv1'];
  function inviteDoc() {
    return seedRaw(INVITE, {
      kidEmailLower: 'kid29@ejm.org', firstName: 'Kid', lastName: 'G',
      dateOfBirth: '2013-05-01', familyId: 'famG', createdByParentUid: 'parentG1',
      tokenHash: 'deadbeef', status: 'pending',
      createdAt: new Date(), expiresAt: new Date(Date.now() + 7 * 86400_000),
      consent: { tosVersion: '1.0', privacyVersion: '1.0', supervisionAgreementVersion: '1.0', approvedAt: new Date(), approvedByUid: 'parentG1' },
    });
  }

  describe('kidInvites', () => {
    it('creating family parent can read', async () => {
      await seedActors(); await inviteDoc();
      const authed = testEnv.authenticatedContext('parentG1');
      await assertSucceeds(getDoc(doc(authed.firestore(), ...INVITE)));
    });

    it('co-parent of the same family can read', async () => {
      await seedActors(); await inviteDoc();
      const authed = testEnv.authenticatedContext('parentG2');
      await assertSucceeds(getDoc(doc(authed.firestore(), ...INVITE)));
    });

    it('admin can read', async () => {
      await seedActors(); await inviteDoc();
      const authed = testEnv.authenticatedContext('adminG');
      await assertSucceeds(getDoc(doc(authed.firestore(), ...INVITE)));
    });

    it('parent of a DIFFERENT family cannot read', async () => {
      await seedActors(); await inviteDoc();
      const authed = testEnv.authenticatedContext('parentX');
      await assertFails(getDoc(doc(authed.firestore(), ...INVITE)));
    });

    it('a stranger cannot read', async () => {
      await seedActors(); await inviteDoc();
      const authed = testEnv.authenticatedContext('strangerG');
      await assertFails(getDoc(doc(authed.firestore(), ...INVITE)));
    });

    it('the invited kid (authed under some uid) cannot read — token path only', async () => {
      await seedActors(); await inviteDoc();
      await seedUser('kidUid', { status: 'active', email: 'kid29@ejm.org', profiles: {} });
      const authed = testEnv.authenticatedContext('kidUid');
      await assertFails(getDoc(doc(authed.firestore(), ...INVITE)));
    });

    it('unauthenticated cannot read', async () => {
      await seedActors(); await inviteDoc();
      await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), ...INVITE)));
    });

    it('family parent cannot create an invite client-side', async () => {
      await seedActors();
      const authed = testEnv.authenticatedContext('parentG1');
      await assertFails(setDoc(doc(authed.firestore(), ...INVITE), { familyId: 'famG', status: 'pending' }));
    });

    it('family parent cannot update (e.g. un-expire) an invite', async () => {
      await seedActors(); await inviteDoc();
      const authed = testEnv.authenticatedContext('parentG1');
      await assertFails(updateDoc(doc(authed.firestore(), ...INVITE), { status: 'cancelled' }));
    });

    it('even admin cannot write client-side (callable-only)', async () => {
      await seedActors(); await inviteDoc();
      const authed = testEnv.authenticatedContext('adminG');
      await assertFails(updateDoc(doc(authed.firestore(), ...INVITE), { status: 'cancelled' }));
      await assertFails(deleteDoc(doc(authed.firestore(), ...INVITE)));
    });
  });

  const LINK: [string, string] = ['guardianLinks', 'kidUid'];
  function linkDoc(status = 'active') {
    return seedRaw(LINK, {
      childUid: 'kidUid', familyId: 'famG', createdByParentUid: 'parentG1',
      status, origin: 'claim', requestedAt: new Date(),
      consent: { tosVersion: '1.0', privacyVersion: '1.0', supervisionAgreementVersion: '1.0', approvedAt: new Date(), approvedByUid: 'parentG1' },
    });
  }

  describe('guardianLinks', () => {
    it('the child can read their own link', async () => {
      await seedActors(); await linkDoc();
      await seedUser('kidUid', { status: 'active', email: 'kid29@ejm.org', profiles: {} });
      const authed = testEnv.authenticatedContext('kidUid');
      await assertSucceeds(getDoc(doc(authed.firestore(), ...LINK)));
    });

    it('supervising family parents can read', async () => {
      await seedActors(); await linkDoc();
      await assertSucceeds(getDoc(doc(testEnv.authenticatedContext('parentG1').firestore(), ...LINK)));
      await assertSucceeds(getDoc(doc(testEnv.authenticatedContext('parentG2').firestore(), ...LINK)));
    });

    it('admin can read', async () => {
      await seedActors(); await linkDoc();
      await assertSucceeds(getDoc(doc(testEnv.authenticatedContext('adminG').firestore(), ...LINK)));
    });

    it('a parent from a DIFFERENT family cannot read', async () => {
      await seedActors(); await linkDoc();
      await assertFails(getDoc(doc(testEnv.authenticatedContext('parentX').firestore(), ...LINK)));
    });

    it('a stranger cannot read', async () => {
      await seedActors(); await linkDoc();
      await assertFails(getDoc(doc(testEnv.authenticatedContext('strangerG').firestore(), ...LINK)));
    });

    it('unauthenticated cannot read', async () => {
      await seedActors(); await linkDoc();
      await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), ...LINK)));
    });

    it('the child cannot self-activate a pending link', async () => {
      await seedActors(); await linkDoc('pending');
      await seedUser('kidUid', { status: 'active', email: 'kid29@ejm.org', profiles: {} });
      const authed = testEnv.authenticatedContext('kidUid');
      await assertFails(updateDoc(doc(authed.firestore(), ...LINK), { status: 'active' }));
    });

    it('a parent cannot create a link client-side', async () => {
      await seedActors();
      const authed = testEnv.authenticatedContext('parentG1');
      await assertFails(setDoc(doc(authed.firestore(), ...LINK), { childUid: 'kidUid', familyId: 'famG', status: 'active' }));
    });

    it('the child cannot delete their link (no self-revoke)', async () => {
      await seedActors(); await linkDoc();
      await seedUser('kidUid', { status: 'active', email: 'kid29@ejm.org', profiles: {} });
      await assertFails(deleteDoc(doc(testEnv.authenticatedContext('kidUid').firestore(), ...LINK)));
    });
  });

  const ALERT: [string, string] = ['adminAlerts', 'alert1'];
  function alertDoc() {
    return seedRaw(ALERT, {
      type: 'guardian_conflicting_claim', createdAt: new Date(),
      data: { attemptedByUid: 'parentX', familyId: 'famX', kidEmailLower: 'kid29@ejm.org', existingLinkFamilyId: 'famG' },
    });
  }

  describe('adminAlerts', () => {
    it('admin can read', async () => {
      await seedActors(); await alertDoc();
      await assertSucceeds(getDoc(doc(testEnv.authenticatedContext('adminG').firestore(), ...ALERT)));
    });

    it('the parent whose claim raised the alert cannot read it', async () => {
      await seedActors(); await alertDoc();
      await assertFails(getDoc(doc(testEnv.authenticatedContext('parentX').firestore(), ...ALERT)));
    });

    it('a stranger cannot read', async () => {
      await seedActors(); await alertDoc();
      await assertFails(getDoc(doc(testEnv.authenticatedContext('strangerG').firestore(), ...ALERT)));
    });

    it('unauthenticated cannot read', async () => {
      await seedActors(); await alertDoc();
      await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), ...ALERT)));
    });

    it('even admin cannot write client-side', async () => {
      await seedActors();
      const authed = testEnv.authenticatedContext('adminG');
      await assertFails(setDoc(doc(authed.firestore(), ...ALERT), { type: 'guardian_conflicting_claim', createdAt: new Date(), data: {} }));
    });
  });

  // users-doc pins: governedBy + identityLocked are server-owned; when
  // identityLocked, the parent-attested identity fields are frozen.
  describe('users governedBy / identityLocked pins', () => {
    function kidBase(extra: Record<string, unknown> = {}) {
      return {
        status: 'active', email: 'kid29@ejm.org',
        firstName: 'Kid', lastName: 'G', dateOfBirth: new Date('2013-05-01'),
        profiles: { babysitter: { ejemEmail: 'kid29@ejm.org', enrollmentComplete: true, searchable: false } },
        ...extra,
      };
    }

    it('owner cannot set governedBy on themselves', async () => {
      await seedUser('kidU1', kidBase());
      const authed = testEnv.authenticatedContext('kidU1');
      await assertFails(updateDoc(doc(authed.firestore(), 'users', 'kidU1'), {
        governedBy: { familyId: 'famEvil', linkedAt: new Date() },
      }));
    });

    it('owner cannot clear an existing governedBy mirror', async () => {
      await seedUser('kidU2', kidBase({ governedBy: { familyId: 'famG', linkedAt: new Date() } }));
      const authed = testEnv.authenticatedContext('kidU2');
      await assertFails(updateDoc(doc(authed.firestore(), 'users', 'kidU2'), { governedBy: deleteField() }));
    });

    it('owner cannot set identityLocked', async () => {
      await seedUser('kidU3', kidBase());
      const authed = testEnv.authenticatedContext('kidU3');
      await assertFails(updateDoc(doc(authed.firestore(), 'users', 'kidU3'), { identityLocked: true }));
    });

    it('owner cannot clear identityLocked', async () => {
      await seedUser('kidU4', kidBase({ identityLocked: true }));
      const authed = testEnv.authenticatedContext('kidU4');
      await assertFails(updateDoc(doc(authed.firestore(), 'users', 'kidU4'), { identityLocked: deleteField() }));
    });

    it('identity-locked owner cannot change firstName', async () => {
      await seedUser('kidU5', kidBase({ identityLocked: true }));
      const authed = testEnv.authenticatedContext('kidU5');
      await assertFails(updateDoc(doc(authed.firestore(), 'users', 'kidU5'), { firstName: 'Other' }));
    });

    it('identity-locked owner cannot change lastName', async () => {
      await seedUser('kidU6', kidBase({ identityLocked: true }));
      const authed = testEnv.authenticatedContext('kidU6');
      await assertFails(updateDoc(doc(authed.firestore(), 'users', 'kidU6'), { lastName: 'Other' }));
    });

    it('identity-locked owner cannot change dateOfBirth', async () => {
      await seedUser('kidU7', kidBase({ identityLocked: true }));
      const authed = testEnv.authenticatedContext('kidU7');
      await assertFails(updateDoc(doc(authed.firestore(), 'users', 'kidU7'), { dateOfBirth: new Date('2009-01-01') }));
    });

    it('identity-locked owner CAN still edit photoUrl and profile fields', async () => {
      await seedUser('kidU8', kidBase({ identityLocked: true }));
      const authed = testEnv.authenticatedContext('kidU8');
      await assertSucceeds(updateDoc(doc(authed.firestore(), 'users', 'kidU8'), {
        photoUrl: 'https://firebasestorage.googleapis.com/v0/b/x/o/p.png',
        'profiles.babysitter.searchable': true,
      }));
    });

    it('an UNLOCKED owner can still change their own name (regression guard)', async () => {
      await seedUser('kidU9', kidBase());
      const authed = testEnv.authenticatedContext('kidU9');
      await assertSucceeds(updateDoc(doc(authed.firestore(), 'users', 'kidU9'), { firstName: 'NewName' }));
    });

    it('a governed owner without identityLocked can also change their name (claim path)', async () => {
      await seedUser('kidU10', kidBase({ governedBy: { familyId: 'famG', linkedAt: new Date() } }));
      const authed = testEnv.authenticatedContext('kidU10');
      await assertSucceeds(updateDoc(doc(authed.firestore(), 'users', 'kidU10'), { firstName: 'NewName' }));
    });
  });
});

// ---------------------------------------------------------------------------
// Cross-app session handoff codes: NOBODY — not even admin — reads or writes
// these from a client. The docs hold sha256 hashes of one-time switch codes;
// the mint/redeem callables (Admin SDK, bypasses rules) are the only path.
// ---------------------------------------------------------------------------

describe('appHandoffCodes', () => {
  const CODE: [string, string] = ['appHandoffCodes', 'code1'];

  async function seedHandoff() {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), ...CODE), {
        uid: 'minterH', tokenHash: 'deadbeef',
        createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000),
      });
      await setDoc(doc(ctx.firestore(), 'users', 'adminH'), {
        uid: 'adminH', isAdmin: true, status: 'active', email: 'a@x.com', profiles: {},
      });
      await setDoc(doc(ctx.firestore(), 'users', 'minterH'), {
        uid: 'minterH', status: 'active', email: 'm@x.com', profiles: {},
      });
    });
  }

  it('the minter cannot read their own code doc', async () => {
    await seedHandoff();
    await assertFails(getDoc(doc(testEnv.authenticatedContext('minterH').firestore(), ...CODE)));
  });

  it('even admin cannot read', async () => {
    await seedHandoff();
    await assertFails(getDoc(doc(testEnv.authenticatedContext('adminH').firestore(), ...CODE)));
  });

  it('even admin cannot query the collection', async () => {
    await seedHandoff();
    await assertFails(
      getDocs(query(collection(testEnv.authenticatedContext('adminH').firestore(), 'appHandoffCodes'))),
    );
  });

  it('unauthenticated cannot read', async () => {
    await seedHandoff();
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), ...CODE)));
  });

  it('no client can create a code doc', async () => {
    await seedHandoff();
    await assertFails(setDoc(doc(testEnv.authenticatedContext('minterH').firestore(), 'appHandoffCodes', 'forged'), {
      uid: 'minterH', tokenHash: 'beef', createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000),
    }));
  });

  it('even admin cannot update or delete (callable-only)', async () => {
    await seedHandoff();
    const authed = testEnv.authenticatedContext('adminH');
    await assertFails(updateDoc(doc(authed.firestore(), ...CODE), { expiresAt: new Date(Date.now() + 3600_000) }));
    await assertFails(deleteDoc(doc(authed.firestore(), ...CODE)));
  });
});

describe('users update — tutor numeric bounds (issue #123 hardening)', () => {
  const uid = 'bounds-tutor-1';
  const base = {
    uid,
    email: 'bounds@ejm-test.org',
    status: 'active',
    profiles: {
      tutor: {
        enrollmentComplete: true,
        ejemEmail: 'bounds@ejm-test.org',
        paddingMin: 15,
        areaRadiusKm: 5,
      },
    },
  };

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`users/${uid}`).set(base);
    });
  });

  it('rejects an out-of-range paddingMin (owner write)', async () => {
    const db = testEnv.authenticatedContext(uid).firestore();
    await assertFails(
      updateDoc(doc(db, 'users', uid), { 'profiles.tutor.paddingMin': 500 }),
    );
  });

  it('rejects an out-of-range areaRadiusKm (owner write)', async () => {
    const db = testEnv.authenticatedContext(uid).firestore();
    await assertFails(
      updateDoc(doc(db, 'users', uid), { 'profiles.tutor.areaRadiusKm': 100000 }),
    );
  });

  it('accepts in-range values and explicit null radius', async () => {
    const db = testEnv.authenticatedContext(uid).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'users', uid), {
        'profiles.tutor.paddingMin': 60,
        'profiles.tutor.areaRadiusKm': null,
      }),
    );
  });

  it('rejects an over-long aboutMe (owner write) — the account page is the only writer', async () => {
    const db = testEnv.authenticatedContext(uid).firestore();
    await assertFails(
      updateDoc(doc(db, 'users', uid), { 'profiles.tutor.aboutMe': 'x'.repeat(1001) }),
    );
  });

  it('photoUrl: owner may set a bounded URL on OUR storage hosts, or null', async () => {
    const db = testEnv.authenticatedContext(uid).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'users', uid), {
        photoUrl: 'https://firebasestorage.googleapis.com/v0/b/x/o/p.jpg',
      }),
    );
    await assertSucceeds(updateDoc(doc(db, 'users', uid), { photoUrl: null }));
    // Emulator download URLs are plain-http localhost — allowed.
    await assertSucceeds(
      updateDoc(doc(db, 'users', uid), { photoUrl: 'http://127.0.0.1:9199/v0/b/x/o/p.jpg' }),
    );
    // Third-party hosts are NOT: a public search card must not become a
    // beacon logging every family that views it.
    await assertFails(
      updateDoc(doc(db, 'users', uid), { photoUrl: 'https://evil.example/pixel.png' }),
    );
    await assertFails(
      updateDoc(doc(db, 'users', uid), { photoUrl: 'data:image/svg+xml;base64,AAAA' }),
    );
    await assertFails(updateDoc(doc(db, 'users', uid), { photoUrl: 12345 }));
  });

  it('an UNCHANGED odd legacy photoUrl never locks the owner out of other edits', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc(`users/legacy-photo-1`).set({
        uid: 'legacy-photo-1', status: 'active', photoUrl: 'gopher://weird',
        profiles: { tutor: { enrollmentComplete: true, ejemEmail: 'l@ejm-test.org', paddingMin: 10 } },
      });
    });
    const db = testEnv.authenticatedContext('legacy-photo-1').firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'users', 'legacy-photo-1'), { 'profiles.tutor.paddingMin': 20 }),
    );
  });

  it('accepts a bounded aboutMe and explicit null', async () => {
    const db = testEnv.authenticatedContext(uid).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'users', uid), { 'profiles.tutor.aboutMe': 'x'.repeat(1000) }),
    );
    await assertSucceeds(
      updateDoc(doc(db, 'users', uid), { 'profiles.tutor.aboutMe': null }),
    );
  });

  it('rejects out-of-range and NaN coordinates (owner write)', async () => {
    const db = testEnv.authenticatedContext(uid).firestore();
    await assertFails(
      updateDoc(doc(db, 'users', uid), { 'profiles.tutor.areaLatLng': { lat: 91, lng: 2.35 } }),
    );
    await assertFails(
      updateDoc(doc(db, 'users', uid), { 'profiles.tutor.areaLatLng': { lat: NaN, lng: 2.35 } }),
    );
  });

  it('accepts valid coordinates and explicit null', async () => {
    const db = testEnv.authenticatedContext(uid).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'users', uid), { 'profiles.tutor.areaLatLng': { lat: 48.85, lng: 2.35 } }),
    );
    await assertSucceeds(
      updateDoc(doc(db, 'users', uid), { 'profiles.tutor.areaLatLng': null }),
    );
  });

  it('does not affect users without a tutor profile', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await ctx.firestore().doc('users/bounds-parent-1').set({
        uid: 'bounds-parent-1', email: 'p@test.com', status: 'active',
        profiles: { parent: { enrollmentComplete: true, familyId: 'famB' } },
      });
    });
    const db = testEnv.authenticatedContext('bounds-parent-1').firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'users', 'bounds-parent-1'), { firstName: 'New' }),
    );
  });
});
