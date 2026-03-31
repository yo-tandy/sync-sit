import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { doc, getDoc, collection, getDocs, addDoc } from 'firebase/firestore';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { useVerificationStore } from '@/stores/verificationStore';
import { useFamilyAppointments } from '@/hooks/useFamilyAppointments';
import { Button, Badge, Card, Dialog, Spinner, Input } from '@/components/ui';
import { CalendarIcon, ChevronRightIcon, PlusIcon } from '@/components/ui/Icons';
import { Avatar } from '@/components/ui';
import type { AppointmentDoc, BabysitterUser } from '@ejm/shared';
import { formatBabysitterName, capitalize, formatFamilyTitle } from '@/lib/formatName';
import {
  SearchIcon,
  SettingsIcon,
  LogOutIcon,
  UserIcon,
  UserPlusIcon,
  InfoIcon,
  ShieldIcon,
  FileTextIcon,
  ShareIcon,
  BellIcon,
  MailIcon,
} from '@/components/ui/Icons';

function MenuIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

function MenuItem({ icon, label, to, onClick }: { icon: React.ReactNode; label: string; to?: string; onClick?: () => void }) {
  const inner = (
    <div className="flex items-center gap-3 px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 active:bg-gray-100">
      <span className="text-gray-400">{icon}</span>
      <span>{label}</span>
    </div>
  );
  if (to) return <Link to={to} className="block">{inner}</Link>;
  return <button type="button" onClick={onClick} className="w-full text-left">{inner}</button>;
}

interface BabysitterInfo {
  name: string;
  age?: number;
  classLevel?: string;
  languages?: string[];
  photoUrl?: string;
  aboutMe?: string;
  contactEmail?: string;
  contactPhone?: string;
  kidAgeRange?: { min: number; max: number };
  maxKids?: number;
}

const borderColors: Record<string, string> = {
  pending: '#f59e0b',
  confirmed: '#22c55e',
  past: '#9ca3af',
  rejected: '#9ca3af',
};

const badgeVariants: Record<string, 'amber' | 'green' | 'gray'> = {
  pending: 'amber',
  confirmed: 'green',
  past: 'gray',
  rejected: 'gray',
};

function useBadgeLabels() {
  const { t } = useTranslation();
  return {
    pending: t('familyDashboard.badgePending'),
    confirmed: t('familyDashboard.badgeConfirmed'),
    past: t('familyDashboard.badgeCompleted'),
    rejected: t('familyDashboard.badgeDeclined'),
  } as Record<string, string>;
}

function ExpandableBabysitterCard({
  appointment,
  info,
  variant,
  isReturning,
}: {
  appointment: AppointmentDoc;
  info?: BabysitterInfo;
  variant: string;
  isReturning?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith('fr') ? 'fr-FR' : 'en-GB';
  const [expanded, setExpanded] = useState(false);
  const badgeLabels = useBadgeLabels();
  const name = info?.name || t('familyDashboard.babysitterFallback');

  // Format date/time for confirmed/past cards
  const dateTimeStr = appointment.date
    ? new Date(appointment.date + 'T00:00:00').toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' })
      + (appointment.startTime && appointment.endTime ? ` · ${appointment.startTime}–${appointment.endTime}` : '')
    : null;

  return (
    <Card borderColor={borderColors[variant]} className="mb-2">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between text-left"
      >
        <div className="flex items-center gap-3">
          <Avatar name={name} src={info?.photoUrl || undefined} size="sm" />
          <div>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold text-gray-900">{name}</p>
              {isReturning && <span className="text-blue-500" title="Returning">⭐</span>}
            </div>
            {/* Pending: show age + class */}
            {variant === 'pending' && info?.age && (
              <span className="text-xs text-gray-500">
                {info.age} {t('familyDashboard.ageSuffix')}{info.classLevel ? ` · ${info.classLevel}` : ''}
              </span>
            )}
            {/* Confirmed/past/rejected: show date + time */}
            {variant !== 'pending' && dateTimeStr && (
              <span className="text-xs text-gray-500">{dateTimeStr}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={badgeVariants[variant]}>{badgeLabels[variant]}</Badge>
          <ChevronRightIcon className={`h-4 w-4 text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </div>
      </button>

      {expanded && info && (
        <div className="mt-3 border-t border-gray-100 pt-3 space-y-2">
          {info.classLevel && (
            <p className="text-xs text-gray-600">{t('familyDashboard.classLabel')} {info.classLevel}</p>
          )}
          {info.languages && info.languages.length > 0 && (
            <p className="text-xs text-gray-600">🗣 {info.languages.join(', ')}</p>
          )}
          {info.kidAgeRange && (
            <p className="text-xs text-gray-600">👶 {t('familyDashboard.agesRange', { min: info.kidAgeRange.min, max: info.kidAgeRange.max })}{info.maxKids ? t('familyDashboard.upToKids', { count: info.maxKids }) : ''}</p>
          )}
          {info.aboutMe && (
            <p className="text-xs text-gray-600 italic">"{info.aboutMe}"</p>
          )}
          {appointment.offeredRate && (
            <p className="text-xs text-gray-600">💰 {t('familyDashboard.rateOffered', { rate: appointment.offeredRate })}</p>
          )}
          {appointment.message && (
            <p className="text-xs text-gray-600">💬 {appointment.message}</p>
          )}

          {/* Contact details */}
          {(info.contactEmail || info.contactPhone) && (
            <div className="mt-2 rounded-lg bg-gray-50 p-2.5">
              <p className="mb-1 text-xs font-medium text-gray-500">{t('familyDashboard.contactLabel')}</p>
              {info.contactEmail && (
                <p className="text-xs text-gray-700">
                  📧 <a href={`mailto:${info.contactEmail}`} className="text-red-600 hover:underline">{info.contactEmail}</a>
                </p>
              )}
              {info.contactPhone && (
                <p className="text-xs text-gray-700">
                  📞 <a href={`tel:${info.contactPhone}`} className="text-red-600 hover:underline">{info.contactPhone}</a>
                </p>
              )}
            </div>
          )}

          {/* Date/time for non-grouped sections */}
          {variant !== 'pending' && appointment.date && (
            <p className="text-xs text-gray-500">
              📅 {new Date(appointment.date + 'T00:00:00').toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' })}
              {appointment.startTime && appointment.endTime && ` · ${appointment.startTime}–${appointment.endTime}`}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

function ShareMenuItem() {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const shareText = t('menu.shareText', { link: window.location.origin });
  const shareSubject = 'EJM Babysitting';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
    } catch {
      const input = document.createElement('input');
      input.value = shareText;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="px-4 py-3">
      <p className="mb-2 text-sm font-medium text-gray-700">{t('menu.shareApp')}</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleCopy}
          className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50"
        >
          {copied ? t('invite.copied') : t('menu.copyMessage')}
        </button>
        <a
          href={`mailto:?subject=${encodeURIComponent(shareSubject)}&body=${encodeURIComponent(shareText)}`}
          className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-center text-xs font-medium text-gray-600 hover:bg-gray-50"
        >
          {t('menu.shareByEmail')}
        </a>
      </div>
    </div>
  );
}

function LanguageSelectorMenu() {
  const { i18n } = useTranslation();
  return (
    <div className="px-4 py-3">
      <p className="mb-2 text-xs text-gray-500">Language</p>
      <div className="flex gap-2">
        {['en', 'fr'].map((lang) => (
          <button
            key={lang}
            type="button"
            onClick={() => { i18n.changeLanguage(lang); localStorage.setItem('ejm_language', lang); }}
            className={`rounded-lg border-[1.5px] px-3 py-1.5 text-xs font-medium transition-colors ${
              (i18n.language || 'en').startsWith(lang) ? 'border-red-600 bg-red-50 text-red-600' : 'border-gray-300 text-gray-700'
            }`}
          >
            {lang === 'en' ? 'English' : 'Fran\u00e7ais'}
          </button>
        ))}
      </div>
    </div>
  );
}

function groupByDateTime(
  appointments: AppointmentDoc[],
  locale: string,
  dayNames: Record<string, string>,
  recurringLabel: string,
): { label: string; appointments: AppointmentDoc[] }[] {
  const groups = new Map<string, AppointmentDoc[]>();
  for (const apt of appointments) {
    let key: string;
    if (apt.date) {
      const dateStr = new Date(apt.date + 'T00:00:00').toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' });
      key = apt.startTime && apt.endTime ? `${dateStr} · ${apt.startTime}–${apt.endTime}` : dateStr;
    } else {
      if (apt.recurringSlots?.length > 0) {
        key = apt.recurringSlots.map((s: any) => `${dayNames[s.day] || s.day} ${s.startTime}–${s.endTime}`).join(', ');
      } else {
        key = recurringLabel;
      }
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(apt);
  }
  return [...groups.entries()].map(([label, appointments]) => ({ label, appointments }));
}

export function FamilyDashboard() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language?.startsWith('fr') ? 'fr-FR' : 'en-GB';
  const dayNamesForGroup: Record<string, string> = {
    mon: t('days.mondays'), tue: t('days.tuesdays'), wed: t('days.wednesdays'), thu: t('days.thursdays'),
    fri: t('days.fridays'), sat: t('days.saturdays'), sun: t('days.sundays'),
  };
  const { userDoc, logout } = useAuthStore();
  const { familyVerification, fetchStatus: fetchVerificationStatus } = useVerificationStore();
  const [familyName, setFamilyName] = useState('');
  const [kids, setKids] = useState<{ kidId: string; firstName: string; age: number }[]>([]);
  const [kidsLoaded, setKidsLoaded] = useState(false);
  const [newKidName, setNewKidName] = useState('');
  const [newKidAge, setNewKidAge] = useState('');
  const [addingKid, setAddingKid] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const { pending, confirmed, pastRecent, rejectedRecent, loading: aptsLoading } = useFamilyAppointments();

  const [babysitters, setBabysitters] = useState<Record<string, BabysitterInfo>>({});

  // Babysitters who have had a confirmed appointment with this family
  const returningBabysitterIds = new Set(
    [...confirmed, ...pastRecent].map((a) => a.babysitterUserId).filter(Boolean)
  );

  // Look up babysitter profiles for all appointments
  useEffect(() => {
    const allApts = [...pending, ...confirmed, ...pastRecent, ...rejectedRecent];
    const uids = [...new Set(allApts.map((a) => a.babysitterUserId).filter(Boolean))];
    const missing = uids.filter((uid) => !babysitters[uid]);
    if (missing.length === 0) return;

    Promise.all(
      missing.map(async (uid) => {
        try {
          const snap = await getDoc(doc(db, 'users', uid));
          if (snap.exists()) {
            const u = snap.data() as BabysitterUser;
            const dob = typeof u.dateOfBirth === 'string' ? new Date(u.dateOfBirth) : u.dateOfBirth?.toDate?.() ? u.dateOfBirth.toDate() : null;
            let age: number | undefined;
            if (dob) {
              age = new Date().getFullYear() - dob.getFullYear();
              const m = new Date().getMonth() - dob.getMonth();
              if (m < 0 || (m === 0 && new Date().getDate() < dob.getDate())) age--;
            }
            const info: BabysitterInfo = {
              name: formatBabysitterName(u.firstName, u.lastName),
              age,
              classLevel: u.classLevel,
              languages: u.languages,
              photoUrl: u.photoUrl,
              aboutMe: u.aboutMe,
              contactEmail: u.contactEmail,
              contactPhone: u.contactPhone,
              kidAgeRange: u.kidAgeRange,
              maxKids: u.maxKids,
            };
            return [uid, info] as [string, BabysitterInfo];
          }
        } catch { /* permission error */ }
        return [uid, { name: t('familyDashboard.babysitterFallback') }] as [string, BabysitterInfo];
      })
    ).then((entries) => {
      const newData = Object.fromEntries(entries);
      setBabysitters((prev) => ({ ...prev, ...newData }));
    });
  }, [pending, confirmed, pastRecent, rejectedRecent]);

  useEffect(() => {
    async function loadFamily() {
      if (userDoc?.role === 'parent' && userDoc.familyId) {
        const familySnap = await getDoc(doc(db, 'families', userDoc.familyId));
        if (familySnap.exists()) {
          setFamilyName(familySnap.data().familyName || '');
        }
        const kidsSnap = await getDocs(collection(db, 'families', userDoc.familyId, 'kids'));
        setKids(kidsSnap.docs.map((d) => ({ kidId: d.id, firstName: d.data().firstName, age: d.data().age })));
        setKidsLoaded(true);
      }
    }
    loadFamily();
  }, [userDoc]);

  useEffect(() => {
    if (userDoc?.role === 'parent') {
      fetchVerificationStatus();
    }
  }, []);

  return (
    <div className="px-5 pt-4 pb-8">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-lg font-bold">{t('babysitterDashboard.hello')} {capitalize(userDoc?.firstName) || 'there'} 👋</h2>
        <p className="text-xs text-gray-500">{formatFamilyTitle(familyName)} {t('familyDashboard.family')}</p>
      </div>

      {/* Verification banner */}
      {familyVerification && !familyVerification.isFullyVerified && (
        <Card className="mb-4 border-amber-200 bg-amber-50">
          <div className="text-center">
            <p className="mb-2 text-sm font-semibold text-amber-800">{t('verification.required')}</p>
            <p className="mb-3 text-xs text-amber-600">{t('verification.requiredDesc')}</p>
            <Link to="/family/verification">
              <Button size="sm">{t('verification.completeVerification')}</Button>
            </Link>
          </div>
        </Card>
      )}

      {/* Kids management — shown prominently when no kids exist */}
      {kidsLoaded && kids.length === 0 && (
        <Card className="mb-4 border-red-200 bg-red-50">
          <h3 className="mb-2 text-sm font-semibold text-red-800">{t('familyDashboard.addKidsTitle')}</h3>
          <p className="mb-4 text-xs text-red-600">{t('familyDashboard.addKidsDesc')}</p>
          <div className="flex gap-2">
            <div className="flex-1">
              <Input
                placeholder={t('enrollment.kidName')}
                value={newKidName}
                onChange={(e) => setNewKidName(e.target.value)}
              />
            </div>
            <div className="w-20">
              <Input
                type="number"
                placeholder={t('enrollment.kidAge')}
                value={newKidAge}
                onChange={(e) => setNewKidAge(e.target.value)}
                min={0}
                max={18}
              />
            </div>
          </div>
          <Button
            size="sm"
            disabled={addingKid || !newKidName.trim() || !newKidAge}
            onClick={async () => {
              if (!userDoc?.familyId) return;
              setAddingKid(true);
              try {
                await addDoc(collection(db, 'families', userDoc.familyId, 'kids'), {
                  firstName: newKidName.trim(),
                  age: parseInt(newKidAge) || 0,
                  languages: [],
                });
                setKids([...kids, { kidId: '', firstName: newKidName.trim(), age: parseInt(newKidAge) || 0 }]);
                setNewKidName('');
                setNewKidAge('');
              } finally {
                setAddingKid(false);
              }
            }}
          >
            <PlusIcon className="h-4 w-4" />
            {addingKid ? '...' : t('enrollment.addChild')}
          </Button>
        </Card>
      )}

      {/* Find a Babysitter — only when verified AND has kids */}
      {(!familyVerification || familyVerification.isFullyVerified) && kidsLoaded && kids.length > 0 && (
        <Button className="mb-6 h-14 text-lg" onClick={() => navigate('/family/search')}>
          <SearchIcon className="h-5 w-5" />
          {t('search.findBabysitter')}
        </Button>
      )}

      {/* Appointments */}
      {aptsLoading ? (
        <div className="flex justify-center py-12">
          <Spinner className="h-8 w-8 text-red-600" />
        </div>
      ) : pending.length > 0 || confirmed.length > 0 || pastRecent.length > 0 || rejectedRecent.length > 0 ? (
        <>
          {pending.length > 0 && (
            <div className="mb-5">
              <div className="mb-2 flex items-center gap-2">
                <h3 className="text-sm font-semibold text-gray-700">{t('familyDashboard.pendingRequests')}</h3>
                <Badge variant="amber">{pending.length}</Badge>
              </div>
              {groupByDateTime(pending, locale, dayNamesForGroup, t('request.recurring')).map(({ label, appointments }) => (
                <div key={label} className="mb-3">
                  <div className="mb-2 flex items-center gap-2 text-xs text-gray-500">
                    <CalendarIcon className="h-3.5 w-3.5" />
                    <span>{label}</span>
                  </div>
                  {appointments.map((apt) => (
                    <ExpandableBabysitterCard
                      key={apt.appointmentId}
                      appointment={apt}
                      info={babysitters[apt.babysitterUserId]}
                      variant="pending"
                      isReturning={returningBabysitterIds.has(apt.babysitterUserId)}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
          {confirmed.length > 0 && (
            <div className="mb-5">
              <div className="mb-2 flex items-center gap-2">
                <h3 className="text-sm font-semibold text-gray-700">{t('babysitterDashboard.confirmed')}</h3>
                <Badge variant="green">{confirmed.length}</Badge>
              </div>
              {confirmed.map((apt) => (
                <ExpandableBabysitterCard
                  key={apt.appointmentId}
                  appointment={apt}
                  info={babysitters[apt.babysitterUserId]}
                  variant="confirmed"
                  isReturning={returningBabysitterIds.has(apt.babysitterUserId)}
                />
              ))}
            </div>
          )}
          {pastRecent.length > 0 && (
            <div className="mb-5">
              <h3 className="mb-2 text-sm font-semibold text-gray-700">{t('babysitterDashboard.past')}</h3>
              {pastRecent.map((apt) => (
                <ExpandableBabysitterCard key={apt.appointmentId} appointment={apt} info={babysitters[apt.babysitterUserId]} variant="past" />
              ))}
            </div>
          )}
          {rejectedRecent.length > 0 && (
            <div className="mb-5">
              <h3 className="mb-2 text-sm font-semibold text-gray-700">{t('familyDashboard.declined')}</h3>
              {rejectedRecent.map((apt) => (
                <ExpandableBabysitterCard key={apt.appointmentId} appointment={apt} info={babysitters[apt.babysitterUserId]} variant="rejected" />
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 text-3xl">👶</div>
          <h3 className="mb-2 text-lg font-semibold">{t('familyDashboard.noAppointments')}</h3>
          <p className="max-w-[240px] text-sm text-gray-500">
            {t('familyDashboard.noAppointmentsDesc')}
          </p>
        </div>
      )}

    </div>
  );
}
