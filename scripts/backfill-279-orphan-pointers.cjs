/**
 * One-shot backfill — clear stale membership pointer FIELDS left by the
 * pre-#284 removeCoParent (issue #279).
 *
 * The deployed pre-fix callable trimmed families/{id}.parentIds but cleared
 * only the root familyId (a Plan C leftover), so every co-parent removed by
 * it still carries profiles.parent.familyId pointing at their ex-family --
 * the exact field storage.rules#canWriteFamilyDocs and getVerificationDocument
 * key off. They retain upload/read access to the ex-family's
 * verification-documents path until this runs.
 *
 * Selection is PER FIELD (PR #284 round 6): each of the two membership
 * fields -- profiles.parent.familyId and the legacy root familyId -- is
 * checked independently against its named family's parentIds, and only the
 * fields whose membership is stale are deleted. A hybrid doc with a live
 * Plan D membership and a stale root pointer loses only the root; a doc
 * whose root membership is live keeps it even if the Plan D pointer is
 * orphaned. A missing family doc counts as stale (family deleted after
 * removal).
 *
 * Under APPLY, each write runs in a TRANSACTION that re-reads the user doc
 * and the named family docs and re-classifies before deleting -- a user
 * scanned mid-joinFamily (which writes the pointer before the parentIds
 * arrayUnion) must not lose the pointer they just legitimately received.
 * Prefer running in a quiet window regardless; the script is one-shot and
 * idempotent, so re-running after traffic settles only retries skips.
 *
 * DRY-RUN BY DEFAULT: prints what would change and writes nothing. Set APPLY=1
 * to actually write (DRY_RUN=1 forces a dry-run even if APPLY is set).
 *
 * Run from the repo root:
 *   pnpm backfill:279-orphan-pointers [--project <id>]                 # dry-run
 *   APPLY=1 pnpm backfill:279-orphan-pointers -- --project <id>        # write
 * To test against the emulator, export FIRESTORE_EMULATOR_HOST first.
 */

/**
 * Pure per-field classification. familiesById maps familyId -> family data
 * (null/undefined = family doc missing). Returns the list of field paths to
 * delete ([] = doc is consistent).
 */
function staleMembershipFields(userData, familiesById, uid) {
  const stale = [];
  const planD = userData?.profiles?.parent?.familyId;
  const root = userData?.familyId;
  const isMember = (familyId) => {
    const fam = familiesById[familyId];
    return !!fam && Array.isArray(fam.parentIds) && fam.parentIds.includes(uid);
  };
  if (planD && !isMember(planD)) stale.push('profiles.parent.familyId');
  if (root && !isMember(root)) stale.push('familyId');
  return stale;
}

module.exports = { staleMembershipFields };

async function main() {
  // firebase-admin is not installed at the repo root; resolve it through the
  // functions workspace (same pattern as backfill-family-postcode.cjs). Lazy
  // so unit tests can import the pure helper above without the admin SDK.
  const { createRequire } = require('module');
  const path = require('path');
  const fnRequire = createRequire(path.resolve(__dirname, '../apps/functions/package.json'));
  const { initializeApp } = fnRequire('firebase-admin/app');
  const { getFirestore, FieldValue } = fnRequire('firebase-admin/firestore');

  const argv = process.argv.slice(2);
  const projectFlagIdx = argv.indexOf('--project');
  const projectId = projectFlagIdx > -1 ? argv[projectFlagIdx + 1] : undefined;
  const apply = process.env.APPLY === '1' && process.env.DRY_RUN !== '1';

  const db = getFirestore(initializeApp(projectId ? { projectId } : {}));

  const users = await db.collection('users').get();
  const familyCache = new Map();
  const loadFamily = async (id) => {
    if (!familyCache.has(id)) {
      familyCache.set(id, (await db.collection('families').doc(id).get()).data() ?? null);
    }
    return familyCache.get(id);
  };

  let scanned = 0, flagged = 0, cleared = 0;
  for (const snap of users.docs) {
    scanned++;
    const data = snap.data();
    const named = [data.profiles?.parent?.familyId, data.familyId].filter(Boolean);
    if (named.length === 0) continue;
    const familiesById = {};
    for (const id of named) familiesById[id] = await loadFamily(id);
    const stale = staleMembershipFields(data, familiesById, snap.id);
    if (stale.length === 0) continue;
    flagged++;
    console.log(`STALE ${snap.id}: fields=[${stale.join(', ')}] planD=${data.profiles?.parent?.familyId ?? '-'} root=${data.familyId ?? '-'}`);
    if (!apply) continue;
    // Transactional re-read + re-classify: joinFamily writes the pointer
    // BEFORE the parentIds arrayUnion, so a mid-join user can look stale
    // for a moment. Fresh reads inside the transaction close that window.
    await db.runTransaction(async (tx) => {
      const freshUser = (await tx.get(snap.ref)).data();
      if (!freshUser) return;
      const freshNamed = [freshUser.profiles?.parent?.familyId, freshUser.familyId].filter(Boolean);
      const freshFamilies = {};
      for (const id of freshNamed) {
        freshFamilies[id] = (await tx.get(db.collection('families').doc(id))).data() ?? null;
      }
      const freshStale = staleMembershipFields(freshUser, freshFamilies, snap.id);
      if (freshStale.length === 0) return;
      const update = {};
      for (const f of freshStale) update[f] = FieldValue.delete();
      tx.update(snap.ref, update);
      cleared++;
    });
  }
  console.log(`scanned=${scanned} flagged=${flagged} ${apply ? `cleared=${cleared}` : '(dry-run: nothing written)'}`);
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}
