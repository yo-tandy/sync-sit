/**
 * Read-only audit for issue #354: references carrying a `tutorUserId` that the
 * study surface would have rendered but the response callable would refuse.
 *
 * WHY THIS EXISTS. PR #352 closed the mint — a client-created reference may no
 * longer carry `tutorUserId` or `doerUserId` — but documents forged before it
 * shipped are still in the collection. The surface fix (this issue) stops them
 * rendering. This answers the separate question the issue asks: are there any?
 * "There may well be none; worth checking rather than assuming."
 *
 * REPORTS IDS AND COUNTS ONLY, never document content. A forged row's body is
 * attacker-controlled text and its neighbours are real families' endorsements;
 * neither belongs in a terminal or a CI log. If a hit is found, read that one
 * document deliberately rather than having the audit print everything.
 *
 * Read-only by construction: no write, batch or transaction call appears in
 * this file.
 *
 *   pnpm audit:354-forged-endorsements
 */
const SUSPECT_REASONS = {
  FOREIGN_SUBMITTER: 'babysitterUserId present and differs from submittedByUserId',
  WRONG_TYPE: "type is not 'family_submitted'",
  WRONG_APP: "appSource is not 'study'",
};

/**
 * Classify one reference document that carries a `tutorUserId`.
 *
 * Pure, and exported so the classification is unit-tested without touching
 * Firestore — the same split as scripts/backfill-279-orphan-pointers.cjs.
 * Returns the reasons a document looks forged, or [] for a legitimate one.
 */
function suspectReasons(data) {
  const reasons = [];
  if (!data || !data.tutorUserId) return reasons;

  // The injection's signature: a sit-shaped manual reference the attacker wrote
  // about themselves (babysitterUserId is pinned to the caller by the create
  // rule) that ALSO carries a victim's tutorUserId.
  if (data.babysitterUserId && data.babysitterUserId !== data.submittedByUserId) {
    reasons.push(SUSPECT_REASONS.FOREIGN_SUBMITTER);
  }
  if (data.type !== 'family_submitted') reasons.push(SUSPECT_REASONS.WRONG_TYPE);
  if (data.appSource !== 'study') reasons.push(SUSPECT_REASONS.WRONG_APP);
  return reasons;
}

module.exports = { suspectReasons, SUSPECT_REASONS };

async function main() {
  // firebase-admin is not installed at the repo root; resolve it through the
  // functions workspace. Lazy so unit tests can import the pure helper above
  // without the admin SDK (the convention backfill-279 established).
  const { createRequire } = require('module');
  const path = require('path');
  const fnRequire = createRequire(path.resolve(__dirname, '../apps/functions/package.json'));
  const { initializeApp, applicationDefault } = fnRequire('firebase-admin/app');
  const { getFirestore } = fnRequire('firebase-admin/firestore');

  const projectId = process.env.GOOGLE_CLOUD_PROJECT || 'sync-sit';
  initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore();

  // Only documents that carry the recipient key at all — the rest cannot
  // reach the study surface regardless of their shape.
  const snap = await db.collection('references').where('tutorUserId', '!=', null).get();

  let scanned = 0;
  const suspects = [];
  snap.forEach((doc) => {
    scanned += 1;
    const reasons = suspectReasons(doc.data());
    if (reasons.length) suspects.push({ id: doc.id, reasons });
  });

  console.log(`project: ${projectId}`);
  console.log(`references carrying tutorUserId: ${scanned}`);
  console.log(`suspect: ${suspects.length}`);
  for (const s of suspects) {
    console.log(`  ${s.id} — ${s.reasons.join('; ')}`);
  }
  if (suspects.length === 0) {
    console.log('\nNo pre-#352 forged documents found. The surface filter is belt-and-braces.');
  } else {
    console.log(
      '\nRead each document above individually before deciding. A suspect is not ' +
        'automatically an attack: check submittedByUserId against the family, and ' +
        'whether the row predates PR #352.',
    );
  }
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
