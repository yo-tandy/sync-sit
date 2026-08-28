import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { collection, deleteField, doc, onSnapshot, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { Badge, Button, Card, Dialog, Spinner, TopNav } from '@ejm/shared-ui';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import type { StudyContactRequestDoc, TutorEndorsementDoc } from '@ejm/study-core';

/**
 * Family-side endorsement management, mirroring sync-sit's
 * SubmittedEndorsementsPage (apps/web/src/pages/family/SubmittedEndorsementsPage.tsx):
 * every endorsement this family submitted, with status, edit-while-private and
 * withdraw. Divergences from sit, both forced by study's model:
 * - Tutor display names come from the family's own studyContactRequests docs
 *   (denormalized tutorName) — tutor user docs are not family-readable in
 *   study, unlike sit's active-babysitter docs.
 * - There is no "add new" flow here: study endorsements are submitted from
 *   the request/session cards (EndorseTutorDialog), which enforce the
 *   relationship server-side; the empty state links there instead.
 *
 * Edit and withdraw are direct client writes permitted by the references
 * rules: the submitter may update ONLY while status is 'private' (content
 * freeze after acceptance) and may transition status to 'removed'; the
 * identity tuple is rules-frozen. The buttons are gated to 'private'
 * accordingly — the rules are the boundary, this gating is UX.
 */

const STATUS_VARIANT: Record<string, 'green' | 'amber' | 'gray'> = {
  published: 'green',
  approved: 'green',
  private: 'amber',
  pending: 'amber',
  removed: 'gray',
};

const createdAtSeconds = (v: TutorEndorsementDoc['createdAt']): number =>
  (v as { seconds?: number } | undefined)?.seconds ?? 0;

export function SubmittedEndorsementsPage() {
  const { t } = useTranslation();
  const { userDoc, firebaseUser } = useAuthStore();
  const familyId = userDoc?.profiles?.parent?.familyId ?? null;
  const uid = firebaseUser?.uid ?? null;

  const [rows, setRows] = useState<TutorEndorsementDoc[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [tutorNames, setTutorNames] = useState<Record<string, string>>({});

  // Live list of this family's study endorsements (equality-only query, no
  // composite index; newest first client-side — same shape the requests page
  // used before this page took the section over).
  useEffect(() => {
    if (!familyId) return;
    const unsubscribe = onSnapshot(
      query(
        collection(db, 'references'),
        where('submittedByFamilyId', '==', familyId),
        where('appSource', '==', 'study'),
      ),
      (snap) => {
        const next = snap.docs.map((d) => d.data() as TutorEndorsementDoc);
        next.sort((a, b) => createdAtSeconds(b.createdAt) - createdAtSeconds(a.createdAt));
        setRows(next);
      },
      () => setLoadError(true),
    );
    return unsubscribe;
  }, [familyId]);

  // Tutor display names via the family's own contact-request docs (denormalized
  // tutorName) — the only family-readable source for them in study.
  useEffect(() => {
    if (!familyId) return;
    const unsubscribe = onSnapshot(
      query(collection(db, 'studyContactRequests'), where('familyId', '==', familyId)),
      (snap) => {
        const names: Record<string, string> = {};
        for (const d of snap.docs) {
          const r = d.data() as StudyContactRequestDoc;
          if (r.tutorUserId && r.tutorName) names[r.tutorUserId] = r.tutorName;
        }
        setTutorNames(names);
      },
      () => {
        /* names are decoration; rows render without them */
      },
    );
    return unsubscribe;
  }, [familyId]);

  // Edit-while-private dialog state.
  const [editTarget, setEditTarget] = useState<TutorEndorsementDoc | null>(null);
  const [editText, setEditText] = useState('');
  const [editRefName, setEditRefName] = useState('');
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState(false);

  const openEdit = useCallback((row: TutorEndorsementDoc) => {
    setEditTarget(row);
    setEditText(row.referenceText);
    setEditRefName(row.refName ?? '');
    setActionError(false);
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editTarget || editText.trim().length < 10) return;
    setSaving(true);
    setActionError(false);
    try {
      await updateDoc(doc(db, 'references', editTarget.referenceId), {
        referenceText: editText.trim(),
        refName: editRefName.trim() || deleteField(),
        updatedAt: serverTimestamp(),
      });
      setEditTarget(null);
    } catch {
      setActionError(true);
    } finally {
      setSaving(false);
    }
  }, [editTarget, editText, editRefName]);

  // Withdraw (status -> 'removed') with confirm, exactly sit's semantics.
  const [withdrawTarget, setWithdrawTarget] = useState<TutorEndorsementDoc | null>(null);

  const confirmWithdraw = useCallback(async () => {
    if (!withdrawTarget) return;
    setSaving(true);
    setActionError(false);
    try {
      await updateDoc(doc(db, 'references', withdrawTarget.referenceId), {
        status: 'removed',
        updatedAt: serverTimestamp(),
      });
      setWithdrawTarget(null);
    } catch {
      setActionError(true);
    } finally {
      setSaving(false);
    }
  }, [withdrawTarget]);

  // Removed rows stay VISIBLE (chip only, no actions): the submit callable
  // de-dupes per (tutor, family) with no status filter, so a withdrawn
  // endorsement cannot be re-submitted — hiding it would leave the family
  // with an invisible, unrecoverable state (PR #195 review).
  const visibleRows = rows ?? [];

  return (
    <div>
      <TopNav title={t('family.endorsements.title')} backTo="/family" />
      <div className="mx-auto max-w-md px-5 pb-16 pt-4">
        {loadError && (
          <Card className="mb-4">
            <p className="text-sm text-brand-600">{t('family.endorsements.loadError')}</p>
          </Card>
        )}

        {!loadError && familyId != null && rows === null && (
          <div className="flex justify-center pt-12">
            <Spinner className="h-6 w-6 text-brand-600" />
          </div>
        )}

        {!loadError && (!familyId || (rows !== null && visibleRows.length === 0)) && (
          <div className="pt-10 text-center">
            <h3 className="mb-2 text-lg font-semibold">{t('family.endorsements.empty')}</h3>
            <p className="mb-5 text-sm text-gray-500">{t('family.endorsements.emptyDesc')}</p>
            <Link to="/family/requests" className="text-sm font-semibold text-brand-600 hover:underline">
              {t('family.endorsements.emptyAction')}
            </Link>
          </div>
        )}

        <div className="space-y-3">
          {visibleRows.map((row) => (
            <Card key={row.referenceId}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {tutorNames[row.tutorUserId] && (
                    <p className="text-sm font-semibold text-gray-900">{tutorNames[row.tutorUserId]}</p>
                  )}
                  <p className="mt-1 text-sm text-gray-800">{row.referenceText}</p>
                  {row.refName && <p className="mt-1 text-xs text-gray-500">{row.refName}</p>}
                </div>
                <Badge variant={STATUS_VARIANT[row.status] ?? 'gray'}>
                  {t(`family.endorsements.status.${row.status}`)}
                </Badge>
              </div>
              {row.status === 'private' && row.submittedByUserId === uid && (
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => openEdit(row)}>
                    {t('family.endorsements.edit')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setWithdrawTarget(row)}>
                    {t('family.endorsements.withdraw')}
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>

      {editTarget && (
        <Dialog open onClose={() => setEditTarget(null)} ariaLabel={t('family.endorsements.editTitle')}>
          <h3 className="mb-3 text-lg font-bold">{t('family.endorsements.editTitle')}</h3>
          <label htmlFor="endorsement-text" className="mb-1 block text-sm font-medium text-gray-700">
            {t('family.endorsements.textLabel')}
          </label>
          <textarea
            id="endorsement-text"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            rows={4}
            maxLength={1000}
            className="mb-3 w-full rounded-lg border-[1.5px] border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-600"
          />
          <label htmlFor="endorsement-refname" className="mb-1 block text-sm font-medium text-gray-700">
            {t('family.endorsements.refNameLabel')}
          </label>
          <input
            id="endorsement-refname"
            value={editRefName}
            onChange={(e) => setEditRefName(e.target.value)}
            maxLength={100}
            className="mb-4 h-10 w-full rounded-lg border-[1.5px] border-gray-300 px-3 text-sm outline-none focus:border-brand-600"
          />
          {actionError && <p className="mb-3 text-sm text-brand-600">{t('common.error')}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditTarget(null)} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button onClick={saveEdit} disabled={saving || editText.trim().length < 10}>
              {t('common.save')}
            </Button>
          </div>
        </Dialog>
      )}

      {withdrawTarget && (
        <Dialog open onClose={() => setWithdrawTarget(null)} ariaLabel={t('family.endorsements.confirmTitle')}>
          <h3 className="mb-2 text-lg font-bold">{t('family.endorsements.confirmTitle')}</h3>
          <p className="mb-4 text-sm text-gray-600">
            {t('family.endorsements.confirmWithdraw', {
              name: tutorNames[withdrawTarget.tutorUserId] ?? t('family.endorsements.theTutor'),
            })}
          </p>
          {actionError && <p className="mb-3 text-sm text-brand-600">{t('common.error')}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setWithdrawTarget(null)} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button onClick={confirmWithdraw} disabled={saving}>
              {t('family.endorsements.withdraw')}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
