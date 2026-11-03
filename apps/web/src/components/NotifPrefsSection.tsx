import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { isRunningAsPWA } from '@ejm/sit-core';
import type { NotifCategory, NotifChannels, NotifScope } from '@ejm/sit-core';
import { notifPrefPath, notifPrefRowsForUser, resolveNotifPref, type NotifPrefRow } from '@ejm/sit-core';
import { db } from '@/config/firebase';
import { useAuthStore } from '@/stores/authStore';
import { Card } from '@/components/ui';
import { BellIcon } from '@/components/ui/Icons';

/**
 * The member's notification settings for EVERY app they use, on the one
 * account page (the hub's "My account").
 *
 * Rows come from `notifPrefRowsForUser` whole -- the shared block, then one
 * block per profile held (sit, study, do) -- rather than filtered down to
 * sit's own block. The account is shared across the suite, so this page is
 * where all of a member's notifications are tuned; the study pages still
 * write the same `notifPrefs` paths, so either surface sees the other's
 * changes.
 *
 * Which ROWS a block shows, and their wording, depends on the side of the
 * app the member is on: a parent never receives sit's "new request", a
 * tutor's study "confirmation" means something different from a parent's.
 * `side` is the page's own role; for study it is refined by the profile the
 * member actually holds there.
 */

type Side = 'parent' | 'provider';
type Labels = Partial<Record<NotifCategory, { labelKey: string; descKey: string }>>;

const L = (key: string) => ({ labelKey: `notifHub.${key}`, descKey: `notifHub.${key}Desc` });

const SHARED_LABELS: Record<Side, Labels> = {
  parent: { reminders: L('reminders'), references: L('endorsementsParent') },
  provider: { reminders: L('reminders'), references: L('endorsementsProvider') },
};

const APP_LABELS: Record<Exclude<NotifScope, 'shared'>, Record<Side, Labels>> = {
  // Parents start sit requests, so they get no "new request" row.
  sit: {
    parent: { confirmed: L('sitParentConfirmed'), cancelled: L('sitParentCancelled') },
    provider: { newRequest: L('sitProviderNewRequest'), cancelled: L('sitProviderCancelled') },
  },
  study: {
    parent: {
      newRequest: L('studyParentNewRequest'),
      confirmed: L('studyParentConfirmed'),
      cancelled: L('studyCancelled'),
    },
    provider: {
      newRequest: L('studyProviderNewRequest'),
      confirmed: L('studyProviderConfirmed'),
      cancelled: L('studyCancelled'),
    },
  },
  // Only a doer holds a do block (`notifPrefScopesForUser`).
  do: {
    parent: {},
    provider: {
      newRequest: L('doNewRequest'),
      confirmed: L('doConfirmed'),
      cancelled: L('doCancelled'),
    },
  },
};

const BLOCK_HEADING: Record<NotifScope, string> = {
  shared: 'notifHub.blockShared',
  sit: 'notifHub.blockSit',
  study: 'notifHub.blockStudy',
  do: 'notifHub.blockDo',
};

interface UserProfiles {
  profiles?: { parent?: unknown; tutor?: unknown };
}

export function labelsFor(
  scope: NotifScope,
  pageSide: Side,
  user: UserProfiles | null | undefined,
): Labels {
  if (scope === 'shared') return SHARED_LABELS[pageSide];
  if (scope === 'do') return APP_LABELS.do.provider;
  if (scope === 'study') {
    // The study block exists because the member is a study parent or a tutor
    // there; word it for the profile they hold, preferring this page's side.
    const p = user?.profiles;
    const side: Side =
      pageSide === 'parent' ? (p?.parent ? 'parent' : 'provider') : p?.tutor ? 'provider' : 'parent';
    return APP_LABELS.study[side];
  }
  return APP_LABELS.sit[pageSide];
}

const key = (row: NotifPrefRow) => `${row.scope}.${row.category}`;

export function NotifPrefsSection({ side }: { side: Side }) {
  const { t } = useTranslation();
  const { userDoc, firebaseUser, refreshUserDoc } = useAuthStore();
  const uid = firebaseUser?.uid;
  // Push only functions when the app is installed as a PWA.
  const pwaMode = isRunningAsPWA();

  const rows = useMemo(
    () =>
      notifPrefRowsForUser(userDoc).filter((r) => labelsFor(r.scope, side, userDoc)[r.category]),
    [userDoc, side],
  );

  // Resolved through the SAME resolver the senders use, so a toggle rendered
  // ON is one the server will actually act on. A shared row resolves the same
  // under any app, so 'sit' stands in for it. Seeded from a memo keyed on the
  // stored prefs, which are reference-stable between store updates.
  const notifPrefs = userDoc?.notifPrefs;
  const stored = useMemo(() => {
    const out: Record<string, NotifChannels> = {};
    for (const row of rows) {
      out[key(row)] = resolveNotifPref(notifPrefs, row.scope === 'shared' ? 'sit' : row.scope, row.category);
    }
    return out;
  }, [rows, notifPrefs]);
  const [prefs, setPrefs] = useState(stored);
  useEffect(() => setPrefs(stored), [stored]);

  // Write ONLY the toggled category/channel via a dot-path: a whole-object
  // `notifPrefs` write would clobber blocks another app wrote after mount.
  const save = useCallback(
    async (row: NotifPrefRow, channel: keyof NotifChannels, value: boolean) => {
      if (!uid) return;
      try {
        await updateDoc(doc(db, 'users', uid), {
          [notifPrefPath(row.scope === 'shared' ? 'sit' : row.scope, row.category, channel)]: value,
          updatedAt: serverTimestamp(),
        });
        await refreshUserDoc();
      } catch (err) {
        console.error('[account] save notification prefs failed', err);
        // silent — will retry on next toggle
      }
    },
    [uid, refreshUserDoc],
  );

  const toggle = (row: NotifPrefRow, channel: keyof NotifChannels) => {
    // In web-app mode, push toggles are inert — notifications won't be
    // delivered until the user installs the app to their home screen.
    if (channel === 'push' && !pwaMode) return;
    const current = prefs[key(row)];
    if (!current) return;
    const next = !current[channel];
    setPrefs({ ...prefs, [key(row)]: { ...current, [channel]: next } });
    void save(row, channel, next);
  };

  return (
    <>
      <h3 className="mb-1 text-sm font-semibold text-gray-700">{t('notifications.title')}</h3>
      <p className="mb-4 text-sm text-gray-500">{t('notifications.desc')}</p>

      {/* Constant notice when push isn't available (web-app mode) */}
      {!pwaMode && (
        <Card className="mb-4 border-amber-200 bg-amber-50">
          <div className="flex items-start gap-3">
            <BellIcon className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <p className="text-xs text-amber-800">
              {t('notifications.pushRequiresInstall')}{' '}
              <Link to="/install" className="font-semibold underline">
                {t('notifications.pushRequiresInstallLink')}
              </Link>
            </p>
          </div>
        </Card>
      )}

      <div className="mb-3 flex items-center justify-end gap-6 pr-1">
        <span className="w-10 text-center text-xs font-medium text-gray-500">{t('notifications.push')}</span>
        <span className="w-10 text-center text-xs font-medium text-gray-500">{t('notifications.emailNotif')}</span>
      </div>

      {rows.map((row, i) => {
        const s = labelsFor(row.scope, side, userDoc)[row.category]!;
        const channel = prefs[key(row)] ?? stored[key(row)];
        const isBlockStart = i === 0 || rows[i - 1].scope !== row.scope;
        return (
          <div key={key(row)}>
            {isBlockStart && (
              <h4 className="mb-2 mt-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                {t(BLOCK_HEADING[row.scope])}
              </h4>
            )}
            <div className="mb-4 flex items-center justify-between">
              <div className="flex-1 pr-4">
                <p className="text-sm font-medium text-gray-900">{t(s.labelKey)}</p>
                <p className="text-xs text-gray-500">{t(s.descKey)}</p>
              </div>
              <div className="flex items-center gap-6">
                <button
                  type="button"
                  onClick={() => toggle(row, 'push')}
                  disabled={!pwaMode}
                  aria-disabled={!pwaMode}
                  aria-label={`${t(BLOCK_HEADING[row.scope])} · ${t(s.labelKey)} — ${t('notifications.push')}`}
                  title={!pwaMode ? t('notifications.pushRequiresInstall') : undefined}
                  className={`flex h-6 w-10 items-center rounded-full p-0.5 transition-colors ${channel.push ? 'bg-brand-600' : 'bg-gray-300'} ${!pwaMode ? 'cursor-not-allowed opacity-40' : ''}`}
                >
                  <div className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${channel.push ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
                <button
                  type="button"
                  onClick={() => toggle(row, 'email')}
                  aria-label={`${t(BLOCK_HEADING[row.scope])} · ${t(s.labelKey)} — ${t('notifications.emailNotif')}`}
                  className={`flex h-6 w-10 items-center rounded-full p-0.5 transition-colors ${channel.email ? 'bg-brand-600' : 'bg-gray-300'}`}
                >
                  <div className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${channel.email ? 'translate-x-4' : 'translate-x-0'}`} />
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
