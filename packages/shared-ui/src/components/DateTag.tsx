import { useTranslation } from 'react-i18next';
import { Badge } from './Badge';

interface DateTagProps {
  tag: string | null;
  className?: string;
}

/**
 * Displays a contextual tag for a babysitting date.
 * - Holiday name → blue badge
 * - "school_night" → amber badge
 * - null → renders nothing
 */
export function DateTag({ tag, className = '' }: DateTagProps) {
  const { t } = useTranslation();

  if (!tag) return null;

  if (tag === 'school_night') {
    return (
      <Badge variant="amber" className={className}>
        {t('search.schoolNight')}
      </Badge>
    );
  }

  return (
    <Badge variant="blue" className={className}>
      {tag}
    </Badge>
  );
}
