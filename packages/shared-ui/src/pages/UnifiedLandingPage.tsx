import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { LanguageSelector } from '../components/LanguageSelector.js';
import { useDocumentGround } from '../hooks/useDocumentGround.js';
import { APP_NAME, BRAND_MARKS, type SyncApp } from '../lib/brandMarks.js';
import { RoleOptionCard } from './RoleOptionCard.js';
import type { SignUpRoleOption } from './SignUpRolePage.js';

export interface UnifiedLandingPageProps {
  /**
   * The parent-vs-student choice, href-based like `SignUpRolePage`'s `roles`
   * prop (issue #435 milestone, PR3) -- same shape deliberately, so a future
   * consumer wiring this page (PR4) can reuse whatever route/copy
   * conventions it already has for role cards. Exactly two entries expected
   * (parent, student); the type doesn't enforce that because the choice of
   * which two roles and their copy is the consuming app's call, not this
   * component's.
   */
  roles: SignUpRoleOption[];
}

/**
 * Apps shown in the brand row, in display order. `do` always renders last,
 * muted, with a "coming soon" badge -- it is decorative only here (platform
 * plan decision 20: do has no reachability from sit/study yet). None of the
 * three tiles are links: this row exists to show "one account across the
 * whole suite", not to navigate anywhere. The actual navigation is the
 * parent/student choice below it.
 */
const DISPLAY_APPS: readonly SyncApp[] = ['sit', 'study', 'do'];

/**
 * The new gray, cross-app landing screen (issue #435 milestone, PR3):
 * three app icons, then a parent-vs-student choice. Pure presentational,
 * like `SignUpRolePage` -- no callables, no routing decisions beyond the
 * hrefs it's handed.
 *
 * Genuinely neutral gray, not any app's brand: stamps `data-ground="admin"`
 * on `<html>` via `useDocumentGround` (the same mechanism AdminLayout and
 * AccountLayout use for the shared, app-agnostic admin/account chrome) and
 * carries `bg-ground-admin` on its own root so the canvas and the card tint
 * both resolve to `--color-ground-admin` instead of whichever brand app.css
 * the host happens to have loaded.
 */
export function UnifiedLandingPage({ roles }: UnifiedLandingPageProps) {
  useDocumentGround('admin');
  const { t } = useTranslation();

  return (
    <div className="bg-ground-admin flex min-h-[100dvh] flex-col px-6 py-4">
      <div className="flex shrink-0 justify-end">
        <LanguageSelector />
      </div>

      <div className="flex flex-1 flex-col justify-center pb-8">
        <h1 className="mb-1 text-center text-2xl font-bold text-gray-950">
          {t('unifiedEnrollment.landingTitle')}
        </h1>
        <p className="mx-auto mb-8 max-w-[320px] text-center text-sm text-gray-500">
          {t('unifiedEnrollment.landingSubtitle')}
        </p>

        <div className="mb-8 flex justify-center gap-6">
          {DISPLAY_APPS.map((app) => {
            const disabled = app === 'do';
            const mark = BRAND_MARKS[app];
            return (
              <div key={app} className="flex w-16 flex-col items-center gap-1.5">
                <img
                  src={mark.md}
                  srcSet={`${mark.sm} 1x, ${mark.md} 2x`}
                  alt=""
                  width={64}
                  height={64}
                  className={`h-14 w-14 rounded-2xl object-contain ${disabled ? 'opacity-40 grayscale' : ''}`}
                />
                <span className={`text-xs font-semibold ${disabled ? 'text-gray-400' : 'text-gray-700'}`}>
                  {APP_NAME[app]}
                </span>
                {disabled && (
                  <span className="rounded-pill bg-gray-200 px-2 py-0.5 text-[10px] font-semibold text-gray-500">
                    {t('unifiedEnrollment.comingSoon')}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {roles.map((role) => (
          <RoleOptionCard key={role.key} option={role} />
        ))}

        <div className="mt-2 text-center">
          <span className="text-sm text-gray-500">{t('welcome.alreadyHaveAccount')} </span>
          <Link to="/login" className="text-sm font-semibold text-brand-600 hover:underline">
            {t('welcome.logIn')}
          </Link>
        </div>
      </div>
    </div>
  );
}
