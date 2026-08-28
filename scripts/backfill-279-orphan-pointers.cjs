/**
 * One-shot backfill — clear stale membership pointers left by the pre-#284
 * removeCoParent (issue #279).
 *
 * The deployed pre-fix callable trimmed families/{id}.parentIds but cleared
 * only the root familyId (a Plan C leftover), so every co-parent removed by
 * it still carries profiles.parent.familyId pointing at their ex-family --
 * the exact field storage.rules#canWriteFamilyDocs and getVerificationDocument
 * key off. They retain upload/read access to the ex-family's
 * verification-documents path until this runs.
 *
 * Selection: every users/{uid} whose profiles.parent.familyId (or root
 * familyId) names a family whose parentIds does NOT contain the uid. Both
 * fields are cleared, mirroring what the fixed callable now writes. A
 * missing family doc counts as orphaned (family deleted after removal).
 *
 * Idempotent: consistent docs are never touched; re-running only retries
 * previous skips.
 *
 * DRY-RUN BY DEFAULT: prints what would change and writes nothing. Set APPLY=1
 * to actually write (DRY_RUN=1 forces a dry-run even if APPLY is set).
 *
 * Run from the repo root:
 *   node scripts/backfill-279-orphan-pointers.cjs [--project <id>]      # dry-run
 *   APPLY=1 node scripts/backfill-279-orphan-pointers.cjs --project <id>   # write
 */
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const projectArg = process.argv.indexOf('--project');
const projectId = projectArg > -1 ? process.argv[projectArg + 1] : undefined;
const apply = process.env.APPLY === '1' && process.env.DRY_RUN !== '1';

const db = getFirestore(initializeApp(projectId ? { projectId } : {}));

async function main() {
  const users = await db.collection('users').get();
  const familyCache = new Map();
  let scanned = 0, orphaned = 0, cleared = 0;
  for (const snap of users.docs) {
    scanned++;
    const data = snap.data();
    const pointer = data.profiles?.parent?.familyId || data.familyId;
    if (!pointer) continue;
    let fam = familyCache.get(pointer);
    if (fam === undefined) {
      fam = (await db.collection('families').doc(pointer).get()).data() ?? null;
      familyCache.set(pointer, fam);
    }
    const isMember = !!fam && Array.isArray(fam.parentIds) && fam.parentIds.includes(snap.id);
    if (isMember) continue;
    orphaned++;
    console.log(`ORPHAN ${snap.id}: pointer=${pointer} family=${fam ? 'exists' : 'MISSING'} plandD=${data.profiles?.parent?.familyId ?? '-'} root=${data.familyId ?? '-'}`);
    if (apply) {
      await snap.ref.update({
        'profiles.parent.familyId': FieldValue.delete(),
        familyId: FieldValue.delete(),
      });
      cleared++;
    }
  }
  console.log(`scanned=${scanned} orphaned=${orphaned} ${apply ? `cleared=${cleared}` : '(dry-run: nothing written)'}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
