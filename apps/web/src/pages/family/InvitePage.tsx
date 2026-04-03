import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { Button, Card, TopNav, InfoBanner, Spinner, Dialog } from '@/components/ui';
import type { ParentUser } from '@ejm/shared';

interface MemberInfo {
  uid: string;
  name: string;
}

export function InvitePage() {
  const { t } = useTranslation();
  const { userDoc } = useAuthStore();
  const parent = userDoc as ParentUser | null;
  const familyId = parent?.familyId;

  const [members, setMembers] = useState<MemberInfo[]>([]);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<{ uid: string; name: string } | null>(null);
  const [removing, setRemoving] = useState(false);

  // Load member names
  const loadMembers = useCallback(async () => {
    if (!familyId) return;
    const familySnap = await getDoc(doc(db, 'families', familyId));
    if (!familySnap.exists()) return;
    const parentIds: string[] = familySnap.data().parentIds || [];
    const memberList: MemberInfo[] = [];
    for (const pid of parentIds) {
      try {
        const userSnap = await getDoc(doc(db, 'users', pid));
        if (userSnap.exists()) {
          const u = userSnap.data();
          memberList.push({ uid: pid, name: `${u.firstName} ${u.lastName}` });
        }
      } catch {
        memberList.push({ uid: pid, name: 'Family member' });
      }
    }
    setMembers(memberList);
  }, [familyId]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  const handleGenerateLink = async () => {
    if (!familyId) return;
    setGenerating(true);
    setError(null);
    try {
      const generateFn = httpsCallable(functions, 'generateInviteLink');
      const result = await generateFn({ familyId });
      const token = (result.data as { token: string }).token;
      const link = `${window.location.origin}/invite/${token}`;
      setInviteLink(link);
    } catch (err: any) {
      setError(err.message || 'Failed to generate invite link');
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
    setTimeout(() => setCopied(false), 3000);
  };

  const handleRemove = async () => {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      const fn = httpsCallable(functions, 'removeCoParent');
      await fn({ targetUserId: removeTarget.uid });
      setRemoveTarget(null);
      loadMembers();
    } catch (err: any) {
      alert(err.message || 'Failed to remove');
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div>
      <TopNav title={t('menu.coParent')} backTo="/family" />
      <div className="px-5 pt-4 pb-8">
        <p className="mb-6 text-sm text-gray-500">
          {t('invite.desc')}
        </p>

        {/* Generate invite link */}
        {!inviteLink ? (
          <Card className="mb-6">
            <p className="mb-3 text-sm text-gray-700">
              {t('invite.linkDesc')}
            </p>
            {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
            <Button onClick={handleGenerateLink} disabled={generating}>
              {generating ? t('invite.generating') : t('invite.generateLink')}
            </Button>
          </Card>
        ) : (
          <Card className="mb-6">
            <p className="mb-1 text-xs font-medium text-gray-500">{t('invite.inviteLink')}</p>
            <div className="mb-2 rounded-lg bg-gray-50 px-3 py-2">
              <p className="break-all text-sm font-mono text-gray-900">{inviteLink}</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleCopy} className="flex-1">
                {copied ? t('invite.copied') : t('invite.copyLink')}
              </Button>
              <Button size="sm" variant="outline" onClick={handleGenerateLink} disabled={generating} className="flex-1">
                {generating ? '...' : t('invite.newLink')}
              </Button>
            </div>
            <p className="mt-2 text-xs text-gray-400">
              {t('invite.linkDesc')}
            </p>
          </Card>
        )}

        {copied && <InfoBanner className="mb-4">{t('invite.linkCopied')}</InfoBanner>}

        {/* Current members */}
        <h3 className="mb-3 text-sm font-semibold text-gray-700">{t('invite.familyMembers')}</h3>
        {members.length === 0 ? (
          <div className="flex justify-center py-4">
            <Spinner className="h-5 w-5 text-gray-400" />
          </div>
        ) : (
          members.map((member, i) => (
            <Card key={i} className="mb-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-900">{member.name}</p>
                {userDoc && member.uid === userDoc.uid ? (
                  <span className="text-xs text-gray-400">{t('invite.you')}</span>
                ) : (
                  <button
                    type="button"
                    className="text-xs text-red-600 hover:underline"
                    onClick={() => setRemoveTarget({ uid: member.uid, name: member.name })}
                  >
                    {t('coParent.remove')}
                  </button>
                )}
              </div>
            </Card>
          ))
        )}
      </div>

      <Dialog open={!!removeTarget} onClose={() => setRemoveTarget(null)}>
        <h3 className="mb-2 text-lg font-semibold">{t('coParent.removeTitle')}</h3>
        <p className="mb-6 text-sm text-gray-600">
          {t('coParent.removeConfirm', { name: removeTarget?.name })}
        </p>
        <div className="flex gap-3">
          <Button variant="outline" size="sm" onClick={() => setRemoveTarget(null)}>{t('common.cancel')}</Button>
          <Button size="sm" onClick={handleRemove} disabled={removing}>{removing ? '...' : t('coParent.confirmRemove')}</Button>
        </div>
      </Dialog>
    </div>
  );
}
