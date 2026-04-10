import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { useFamilyAppointments } from '@/hooks/useFamilyAppointments';
import { Card, TopNav, Spinner, Badge } from '@/components/ui';
import { Avatar } from '@/components/ui';
import { SearchIcon } from '@/components/ui/Icons';
import { formatBabysitterName } from '@/lib/formatName';
import type { ParentUser, AppointmentDoc } from '@ejm/shared';

interface BabysitterInfo {
  uid: string;
  firstName: string;
  lastName: string;
  photoUrl: string | null;
  classLevel: string;
  languages?: string[];
  aboutMe?: string;
  kidAgeRange?: { min: number; max: number };
  maxKids?: number;
  contactEmail?: string;
  contactPhone?: string;
  whatsapp?: string;
  worksInYourArea?: boolean;
}

const statusBadge: Record<string, { variant: 'amber' | 'green' | 'gray'; label: string }> = {
  pending: { variant: 'amber', label: 'Pending' },
  confirmed: { variant: 'green', label: 'Confirmed' },
  rejected: { variant: 'gray', label: 'Declined' },
  cancelled: { variant: 'gray', label: 'Cancelled' },
};

export function PreferredBabysittersPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith('fr') ? 'fr-FR' : 'en-GB';
  const navigate = useNavigate();
  const { userDoc } = useAuthStore();
  const parent = userDoc as ParentUser | null;
  const { pending, confirmed, rejectedRecent } = useFamilyAppointments();

  const [preferredIds, setPreferredIds] = useState<string[]>([]);
  const [preferredInfos, setPreferredInfos] = useState<BabysitterInfo[]>([]);
  const [loading, setLoading] = useState(true);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<BabysitterInfo[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [expandedUid, setExpandedUid] = useState<string | null>(null);

  // Build a map of babysitterUserId → active appointments
  const activeAppointments = new Map<string, AppointmentDoc[]>();
  for (const apt of [...pending, ...confirmed, ...rejectedRecent]) {
    const bsId = apt.babysitterUserId;
    if (!bsId) continue;
    if (!activeAppointments.has(bsId)) activeAppointments.set(bsId, []);
    activeAppointments.get(bsId)!.push(apt);
  }

  // Listen to family doc for preferred list changes
  useEffect(() => {
    if (!parent?.familyId) return;
    const unsub = onSnapshot(doc(db, 'families', parent.familyId), (snap) => {
      const data = snap.data();
      setPreferredIds(data?.preferredBabysitters || []);
    });
    return unsub;
  }, [parent?.familyId]);

  // Load babysitter info for preferred list
  useEffect(() => {
    if (preferredIds.length === 0) {
      setPreferredInfos([]);
      setLoading(false);
      return;
    }

    async function loadInfos() {
      const infos: BabysitterInfo[] = [];
      for (const uid of preferredIds) {
        try {
          const snap = await getDoc(doc(db, 'users', uid));
          if (snap.exists()) {
            const d = snap.data();
            infos.push({
              uid,
              firstName: d.firstName || '',
              lastName: d.lastName || '',
              photoUrl: d.photoUrl || null,
              classLevel: d.classLevel || '',
              languages: d.languages || [],
              aboutMe: d.aboutMe || undefined,
              kidAgeRange: d.kidAgeRange || undefined,
              maxKids: d.maxKids || undefined,
              contactEmail: d.contactEmail || undefined,
              contactPhone: d.contactPhone || undefined,
              whatsapp: d.whatsapp || undefined,
            });
          }
        } catch {
          // Skip if can't read (permissions)
        }
      }
      setPreferredInfos(infos);
      setLoading(false);
    }
    loadInfos();
  }, [preferredIds]);

  // Auto-search with debounce
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setHasSearched(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const fn = httpsCallable(functions, 'lookupBabysitter');
        const result = await fn({ query: q });
        setSearchResults((result.data as any).results || []);
        setHasSearched(true);
      } catch {
        // silent
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleAdd = async (babysitterUserId: string) => {
    setToggling(babysitterUserId);
    try {
      const fn = httpsCallable(functions, 'addPreferredBabysitter');
      await fn({ babysitterUserId });
    } catch {
      // silent
    } finally {
      setToggling(null);
    }
  };

  const handleRemove = async (babysitterUserId: string) => {
    setToggling(babysitterUserId);
    try {
      const fn = httpsCallable(functions, 'removePreferredBabysitter');
      await fn({ babysitterUserId });
    } catch {
      // silent
    } finally {
      setToggling(null);
    }
  };

  const isPreferred = (uid: string) => preferredIds.includes(uid);

  // Filter preferred list by search query (client-side)
  const query = searchQuery.trim().toLowerCase();
  const filteredPreferred = query.length >= 2
    ? preferredInfos.filter((b) =>
        `${b.firstName} ${b.lastName}`.toLowerCase().includes(query))
    : preferredInfos;

  // Filter search results: hide babysitters already in preferred list
  const filteredResults = searchResults.filter((b) => !isPreferred(b.uid));

  function formatAptDate(apt: AppointmentDoc): string {
    if (!apt.date) return '';
    const d = new Date(apt.date + 'T00:00:00');
    const dateStr = d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
    if (apt.startTime && apt.endTime) return `${dateStr} · ${apt.startTime}–${apt.endTime}`;
    return dateStr;
  }

  function renderCard(b: BabysitterInfo, preferred: boolean) {
    const expanded = expandedUid === b.uid;
    const appointments = activeAppointments.get(b.uid) || [];
    return (
      <Card key={b.uid} className="cursor-pointer" onClick={() => setExpandedUid(expanded ? null : b.uid)}>
        <div className="flex items-center gap-3">
          <Avatar
            initials={`${(b.firstName || '')[0] || ''}${(b.lastName || '')[0] || ''}`}
            src={b.photoUrl || undefined}
            size="sm"
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900">{formatBabysitterName(b.firstName, b.lastName)}</p>
            {b.classLevel && <p className="text-xs text-gray-500">{b.classLevel}</p>}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); preferred ? handleRemove(b.uid) : handleAdd(b.uid); }}
            disabled={toggling === b.uid}
            className="text-lg"
            title={preferred ? t('preferred.remove') : t('preferred.add')}
          >
            {preferred ? '❤️' : '🤍'}
          </button>
        </div>

        {/* Active appointments as compact lines */}
        {appointments.length > 0 && (
          <div className="mt-2 space-y-1">
            {appointments.map((apt) => {
              const badge = statusBadge[apt.status] || statusBadge.pending;
              return (
                <button
                  key={apt.appointmentId}
                  onClick={(e) => { e.stopPropagation(); navigate('/family'); }}
                  className="flex w-full items-center gap-2 rounded-md bg-gray-50 px-2.5 py-1.5 text-left active:bg-gray-100"
                >
                  <span className="text-xs text-gray-500">{formatAptDate(apt)}</span>
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                </button>
              );
            })}
          </div>
        )}

        {expanded && (
          <div className="mt-3 border-t border-gray-100 pt-3 space-y-1.5">
            {b.languages && b.languages.length > 0 && (
              <p className="text-xs text-gray-600">🗣 {b.languages.join(', ')}</p>
            )}
            {b.kidAgeRange && (
              <p className="text-xs text-gray-600">👶 Ages {b.kidAgeRange.min}–{b.kidAgeRange.max}{b.maxKids ? `, up to ${b.maxKids} kids` : ''}</p>
            )}
            {b.worksInYourArea !== undefined && (
              <p className={`text-xs ${b.worksInYourArea ? 'text-green-600' : 'text-amber-600'}`}>
                {b.worksInYourArea ? '📍 Works in your area' : '📍 Outside your area'}
              </p>
            )}
            {b.aboutMe && (
              <p className="text-xs text-gray-600 italic">"{b.aboutMe}"</p>
            )}
            {/* Contact details removed — sharing requires babysitter consent */}
          </div>
        )}
      </Card>
    );
  }

  return (
    <div>
      <TopNav title={t('preferred.title')} backTo="/family" />

      <div className="px-5 pt-4 pb-8">
        {/* Search bar */}
        <div className="relative mb-5">
          <SearchIcon className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('preferred.searchPlaceholder')}
            className="h-12 w-full rounded-lg border-[1.5px] border-gray-300 bg-white pl-10 pr-4 text-base text-gray-950 outline-none transition-colors placeholder:text-gray-400 focus:border-red-600"
          />
        </div>

        {/* Preferred babysitters list (always on top) */}
        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner className="h-8 w-8 text-red-600" />
          </div>
        ) : filteredPreferred.length > 0 ? (
          <div className="mb-5">
            <h3 className="mb-3 text-sm font-semibold text-red-600">❤️ {t('preferred.title')} ({filteredPreferred.length})</h3>
            <div className="space-y-2">
              {filteredPreferred.map((b) => renderCard(b, true))}
            </div>
          </div>
        ) : preferredInfos.length === 0 ? (
          <div className="mb-5 flex flex-col items-center py-8 text-center">
            <div className="mb-3 text-3xl">❤️</div>
            <p className="mb-1 text-sm font-medium text-gray-700">{t('preferred.noPreferred')}</p>
            <p className="max-w-[260px] text-xs text-gray-500">{t('preferred.noPreferredDesc')}</p>
          </div>
        ) : null}

        {/* Search results (non-preferred only, shown below preferred) */}
        {searching && (
          <div className="mt-3 flex justify-center">
            <Spinner className="h-6 w-6 text-red-600" />
          </div>
        )}
        {!searching && hasSearched && filteredResults.length > 0 && (
          <div>
            {filteredPreferred.length > 0 && <hr className="mb-4 border-gray-200" />}
            <h3 className="mb-3 text-sm font-semibold text-gray-700">{t('search.results')} ({filteredResults.length})</h3>
            <div className="space-y-2">
              {filteredResults.map((b) => renderCard(b, false))}
            </div>
          </div>
        )}
        {!searching && hasSearched && filteredResults.length === 0 && filteredPreferred.length === 0 && (
          <p className="mt-3 text-center text-sm text-gray-500">{t('preferred.noResults')}</p>
        )}
      </div>
    </div>
  );
}
