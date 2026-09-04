import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { SignUpRoleOption } from './SignUpRolePage.js';

interface RoleOptionCardProps {
  option: SignUpRoleOption;
}

/**
 * One large tappable role card: icon + label + description, linking to
 * `option.href`.
 *
 * Extracted from `SignUpRolePage` (issue #435 milestone, PR3) so
 * `UnifiedLandingPage`'s parent-vs-student choice renders with the exact
 * same visual weight and markup as SignUpRolePage's existing role cards
 * (babysitter/parent on sit, tutor/family on study, doer/family on do),
 * instead of a second copy of this markup that could drift out of sync with
 * the first. `SignUpRolePage` itself now composes this component too.
 */
export function RoleOptionCard({ option }: RoleOptionCardProps) {
  const { t } = useTranslation();
  const Icon = option.icon;

  return (
    <Link
      to={option.href}
      className="mb-4 rounded-xl border-[1.5px] border-gray-200 bg-white p-5 transition-colors hover:border-brand-300 hover:bg-brand-50 active:bg-brand-50"
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100">
          <Icon className="h-5 w-5 text-brand-600" />
        </div>
        <div>
          <p className="text-base font-semibold text-gray-950">{t(option.labelKey)}</p>
        </div>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-gray-500">{t(option.descKey)}</p>
    </Link>
  );
}
