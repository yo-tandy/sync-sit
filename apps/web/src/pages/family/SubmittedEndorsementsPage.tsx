import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { doc, getDoc, getDocs, updateDoc, collection, query, where, serverTimestamp } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useSubmittedEndorsements } from '@/hooks/useSubmittedEndorsements';
import { Button, Card, TopNav, Spinner, Dialog } from '@/components/ui';
import { Avatar } from '@/components/ui';
import { SearchIcon, PlusIcon } from '@/components/ui/Icons';
import { EndorsementDialog } from '@/components/endorsements/EndorsementDialog';
import { formatBabysitterName } from '@/lib/formatName';
import type { ReferenceDoc, BabysitterSummary } from '@ejm/shared';

function ReferenceCard({ reference, babysitterName, onEdit, onDelete }: { reference: ReferenceDoc; babysitterName: string; onEdit: () => void; onDelete: () => void }) {
  const { t, i18n } = useTranslation();

  return (
    <Card className="mb-3">
      <div className="min-w-0">
        <p className="text-xs text-gray-500">
          {t('submittedReferences.referenceForBabysitter', { name: babysitterName || '...' })}
        </p>
        {reference.referenceText && (
          <p className="mt-1 text-sm text-gray-700">"{reference.referenceText}"</p>
        )}
        {reference.createdAt && (
          <p className="mt-1 text-xs text-gray-400">
            {reference.createdAt.toDate?.()
              ? reference.createdAt.toDate().toLocaleDateString(i18n.language === 'fr' ? 'fr-FR' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric' })
              : ''}
          </p>
        )}
      </div>
      <div className="mt-3 flex gap-2">
        <Button size="sm" variant="outline" onClick={onEdit}>
          {t('references.editMyReference')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete}>
          {t('common.remove')}
        </Button>
      </div>
    </Card>
  );
}

export function SubmittedEndorsementsPage() {
  const { t } = useTranslation();
  const { references, loading } = useSubmittedEndorsements();
  const [editTarget, setEditTarget] = useState<ReferenceDoc | null>(null);
  const [babysitterNames, setBabysitterNames] = useState<Record<string, string>>({});

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<ReferenceDoc | null>(null);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await updateDoc(doc(db, 'references', deleteTarget.referenceId), {
        status: 'removed',
        updatedAt: serverTimestamp(),
      });
    } catch { /* silent */ }
    setDeleteTarget(null);
  };

  // Add reference flow
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<BabysitterSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedBabysitter, setSelectedBabysitter] = useState<BabysitterSummary | null>(null);

  // Load babysitter names for all references
  useEffect(() => {
    const uids = [...new Set(references.map((r) => r.babysitterUserId).filter(Boolean))];
    const missing = uids.filter((uid) => !babysitterNames[uid]);
    if (missing.length === 0) return;

    Promise.all(
      missing.map(async (uid) => {
        try {
          const snap = await getDoc(doc(db, 'users', uid));
          if (snap.exists()) {
            const d = snap.data();
            return [uid, formatBabysitterName(d.firstName || '', d.lastName || '')] as [string, string];
          }
        } catch { /* skip */ }
        return null;
      })
    ).then((results) => {
      const newNames: Record<string, string> = {};
      for (const r of results) {
        if (r) newNames[r[0]] = r[1];
      }
      if (Object.keys(newNames).length > 0) {
        setBabysitterNames((prev) => ({ ...prev, ...newNames }));
      }
    });
  }, [references]);

  // Search babysitters with debounce
  useEffect(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const snap = await getDocs(
          query(collection(db, 'users'), where('role', '==', 'babysitter'), where('status', '==', 'active'))
        );
        const results: BabysitterSummary[] = [];
        for (const d of snap.docs) {
          const data = d.data();
          const fullName = `${data.firstName || ''} ${data.lastName || ''}`.toLowerCase();
          if (fullName.includes(q)) {
            results.push({
              uid: d.id,
              firstName: data.firstName || '',
              lastName: data.lastName || '',
              photoUrl: data.photoUrl || null,
              classLevel: data.classLevel || '',
            });
          }
          if (results.length >= 10) break;
        }
        setSearchResults(results);
      } catch { /* silent */ }
      finally { setSearching(false); }
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  if (loading) {
    return (
      <div>
        <TopNav title={t('submittedReferences.title')} backTo="/family" />
        <div className="flex justify-center py-20">
          <Spinner className="h-8 w-8 text-red-600" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <TopNav title={t('submittedReferences.title')} backTo="/family" />
      <div className="px-5 pt-4 pb-8">
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="flex-1 text-sm text-gray-500">{t('submittedReferences.desc')}</p>
          <button
            onClick={() => setShowAddDialog(true)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-600 text-white"
          >
            <PlusIcon className="h-4 w-4" />
          </button>
        </div>

        {references.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 text-3xl">⭐</div>
            <h3 className="mb-2 text-lg font-semibold">{t('submittedReferences.noReferences')}</h3>
            <p className="mb-4 max-w-[240px] text-sm text-gray-500">
              {t('submittedReferences.noReferencesDesc')}
            </p>
            <Button size="sm" onClick={() => setShowAddDialog(true)}>
              {t('references.addReference')}
            </Button>
          </div>
        ) : (
          references.map((ref) => (
            <ReferenceCard
              key={ref.referenceId}
              reference={ref}
              babysitterName={babysitterNames[ref.babysitterUserId] || ''}
              onEdit={() => setEditTarget(ref)}
              onDelete={() => setDeleteTarget(ref)}
            />
          ))
        )}
      </div>

      {/* Delete confirmation */}
      {deleteTarget && (
        <Dialog open onClose={() => setDeleteTarget(null)}>
          <h3 className="mb-2 text-lg font-bold">{t('common.confirm')}</h3>
          <p className="mb-5 text-sm text-gray-600">
            {t('submittedReferences.confirmDelete', { name: babysitterNames[deleteTarget.babysitterUserId] || '' })}
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={confirmDelete} className="flex-1">{t('common.remove')}</Button>
            <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(null)} className="flex-1">{t('common.cancel')}</Button>
          </div>
        </Dialog>
      )}

      {/* Edit dialog */}
      {editTarget && (
        <EndorsementDialog
          babysitterUserId={editTarget.babysitterUserId}
          babysitterName={babysitterNames[editTarget.babysitterUserId] || ''}
          appointmentId={editTarget.appointmentId || ''}
          existingReference={editTarget}
          onClose={() => setEditTarget(null)}
        />
      )}

      {/* Add reference: search for babysitter */}
      {showAddDialog && !selectedBabysitter && (
        <Dialog open onClose={() => { setShowAddDialog(false); setSearchQuery(''); setSearchResults([]); }}>
          <h3 className="mb-1 text-lg font-bold">{t('references.addReference')}</h3>
          <p className="mb-3 text-sm text-gray-500">{t('references.addReferenceDesc')}</p>
          <div className="relative mb-3">
            <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('preferred.searchPlaceholder')}
              autoFocus
              className="h-11 w-full rounded-lg border-[1.5px] border-gray-300 bg-white pl-9 pr-4 text-sm text-gray-950 outline-none transition-colors placeholder:text-gray-400 focus:border-red-600"
            />
          </div>
          {searching && (
            <div className="flex justify-center py-4">
              <Spinner className="h-5 w-5 text-red-600" />
            </div>
          )}
          {!searching && searchResults.length > 0 && (
            <div className="max-h-60 space-y-1 overflow-y-auto">
              {searchResults.map((b) => (
                <button
                  key={b.uid}
                  onClick={() => setSelectedBabysitter(b)}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-gray-50 active:bg-gray-100"
                >
                  <Avatar
                    initials={`${(b.firstName || '')[0] || ''}${(b.lastName || '')[0] || ''}`}
                    src={b.photoUrl || undefined}
                    size="sm"
                  />
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{formatBabysitterName(b.firstName, b.lastName)}</p>
                    {b.classLevel && <p className="text-xs text-gray-500">{b.classLevel}</p>}
                  </div>
                </button>
              ))}
            </div>
          )}
          {!searching && searchQuery.trim().length >= 2 && searchResults.length === 0 && (
            <p className="py-4 text-center text-sm text-gray-500">{t('preferred.noResults')}</p>
          )}
        </Dialog>
      )}

      {/* Add reference: write reference for selected babysitter */}
      {selectedBabysitter && (
        <EndorsementDialog
          babysitterUserId={selectedBabysitter.uid}
          babysitterName={formatBabysitterName(selectedBabysitter.firstName, selectedBabysitter.lastName)}
          appointmentId=""
          onClose={() => { setSelectedBabysitter(null); setShowAddDialog(false); setSearchQuery(''); setSearchResults([]); }}
        />
      )}
    </div>
  );
}
