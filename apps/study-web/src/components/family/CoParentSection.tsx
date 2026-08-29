import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { CoParentSettings, callableErrorCode, useFlashTimer, useToast, type CoParentMember } from '@ejm/shared-ui';
import { db, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { SIT_APP_URL } from '@/utils/appSwitch';
import { getParentProfile } from '@ejm/shared-core';

/**
 * study's co-parent container (issue #340: "make sure co-parent settings
 * are available" in sync-study, where they never existed). Firebase access
 * lives here because shared-ui carries no firebase dependency; the
 * presentation is shared so the two apps cannot drift.
 *
 * The invite LINK points at sync-sit: joining a family is a sit-side flow
 * (/invite/:token lives there, and study has no equivalent route), while
 * the family record itself is shared across both apps -- so a co-parent
 * who joins through sit is immediately a co-parent here too. The note
 * below tells the parent that before they send the link, rather than
 * letting the domain change surprise the recipient. A study-side join
 * route is the follow-up if same-app joining is wanted.
 */
/** Map a generateInviteLink rejection to a translated message. Same reasoning
 * as the removal path in CoParentSettings: map the CODE, never the message. */
function generateErrorKey(err: unknown): string {
  switch (callableErrorCode(err)) {
    case 'permission-denied':
      return 'invite.generateErrorNotAllowed';
    case 'not-found':
      return 'invite.generateErrorNoFamily';
    default:
      return 'invite.generateFailed';
  }
}

export function CoParentSection() {
  const { t } = useTranslation();
  const toast = useToast();
  const { userDoc } = useAuthStore();
  const parent = getParentProfile(userDoc);
  const familyId = parent?.familyId;

  const [members, setMembers] = useState<CoParentMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flashAfter = useFlashTimer();

  const loadMembers = useCallback(async () => {
    if (!familyId) { setLoading(false); return; }
    try {
      const familySnap = await getDoc(doc(db, 'families', familyId));
      if (!familySnap.exists()) {
        setError(t('common.error'));
        return;
      }
      const parentIds: string[] = familySnap.data().parentIds || [];
      const list: CoParentMember[] = [];
      for (const pid of parentIds) {
        try {
          const userSnap = await getDoc(doc(db, 'users', pid));
          const u = userSnap.data();
          list.push({ uid: pid, name: u ? `${u.firstName} ${u.lastName}` : t('invite.familyMemberFallback') });
        } catch {
          list.push({ uid: pid, name: t('invite.familyMemberFallback') });
        }
      }
      setMembers(list);
      setError(null);
    } catch {
      // The families/{id} read is gated on isFamilyMember, so permission-denied
      // is reachable for a parent whose family pointer has gone stale -- the
      // same divergence removeCoParent defends against. Without this catch the
      // rejection escaped the effect and the user got the members heading over
      // an empty list with no explanation (PR #343 round 4). Catching HERE also
      // keeps loadMembers non-rejecting, so the refresh after a successful
      // removal can no longer be reported as a failed removal.
      setError(t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [familyId, t]);

  useEffect(() => { loadMembers(); }, [loadMembers]);

  const handleGenerate = async () => {
    if (!familyId) return;
    setGenerating(true);
    setError(null);
    try {
      const fn = httpsCallable(functions, 'generateInviteLink');
      const res = await fn({ familyId });
      const token = (res.data as { token: string }).token;
      setInviteLink(`${SIT_APP_URL}/invite/${token}`);
    } catch (err: unknown) {
      // NOT `err instanceof Error ? err.message : ...`: a FunctionsError IS an
      // Error, so that branch always won and echoed the callable's English-only
      // server text ('Must be logged in', or bare `internal`) at French users,
      // leaving the fallback key unreachable (PR #343 round 5).
      setError(t(generateErrorKey(err)));
    } finally {
      setGenerating(false);
    }
  };

  const handleCopy = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
    } catch {
      const input = document.createElement('input');
      input.value = inviteLink;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
    }
    setCopied(true);
    flashAfter(() => setCopied(false), 3000);
    toast(t('invite.linkCopied'));
  };

  const handleRemove = async (member: CoParentMember) => {
    const fn = httpsCallable(functions, 'removeCoParent');
    await fn({ targetUserId: member.uid });
    await loadMembers();
  };

  if (!familyId) return null;

  return (
    <CoParentSettings
      members={members}
      loading={loading}
      currentUid={userDoc?.uid}
      inviteLink={inviteLink}
      generating={generating}
      error={error}
      copied={copied}
      onGenerate={handleGenerate}
      onCopy={handleCopy}
      onRemove={handleRemove}
      note={
        <p className="mb-3 text-xs text-gray-500">{t('family.coParentCrossApp')}</p>
      }
    />
  );
}
