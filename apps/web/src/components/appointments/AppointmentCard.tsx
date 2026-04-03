import { useTranslation } from 'react-i18next';
import { Card, Badge, Button } from '@/components/ui';
import { CalendarIcon } from '@/components/ui/Icons';
import { PhotoLightbox } from '@/components/ui/PhotoLightbox';
import { useHolidays } from '@/hooks/useHolidays';
import { getDateTag } from '@/lib/dateTag';
import { DateTag } from '@/components/ui/DateTag';
import type { AppointmentDoc } from '@ejm/shared';

type Variant = 'pending' | 'confirmed' | 'past' | 'rejected';

interface AppointmentCardProps {
  appointment: AppointmentDoc;
  variant: Variant;
  familyName?: string;
  onClick?: () => void;
  onAccept?: () => void;
  onDecline?: () => void;
  onCancel?: () => void;
}

const borderColors: Record<Variant, string> = {
  pending: '#f59e0b',   // amber
  confirmed: '#22c55e', // green
  past: '#9ca3af',      // gray
  rejected: '#9ca3af',
};

const badgeVariants: Record<Variant, 'amber' | 'green' | 'gray'> = {
  pending: 'amber',
  confirmed: 'green',
  past: 'gray',
  rejected: 'gray',
};

const badgeLabels: Record<Variant, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  past: 'Completed',
  rejected: 'Declined',
};

function formatTime(start?: string, end?: string): string {
  if (!start || !end) return '';
  return `${start} – ${end}`;
}

export function AppointmentCard({
  appointment,
  variant,
  familyName,
  onClick,
  onAccept,
  onDecline,
  onCancel,
}: AppointmentCardProps) {
  const { t, i18n } = useTranslation();
  const { periods: holidayPeriods } = useHolidays();
  const locale = i18n.language?.startsWith('fr') ? 'fr-FR' : 'en-GB';

  const dayNames: Record<string, string> = {
    mon: t('days.mondays'), tue: t('days.tuesdays'), wed: t('days.wednesdays'), thu: t('days.thursdays'),
    fri: t('days.fridays'), sat: t('days.saturdays'), sun: t('days.sundays'),
  };

  const formatDate = (dateStr?: string): string => {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' });
  };

  const formatRecurringSlots = (slots?: { day: string; startTime: string; endTime: string }[]): string => {
    if (!slots || slots.length === 0) return t('request.recurring');
    return slots.map((s) => `${dayNames[s.day] || s.day} ${s.startTime}–${s.endTime}`).join(', ');
  };

  const apt = appointment;
  const rawName = familyName || (apt as any).familyName;
  const familyPhoto = (apt as any).familyPhotoUrl;
  const title = rawName ? t('familyDashboard.familyTitle', { name: rawName.toUpperCase() }) : t('request.title');
  const kidCount = apt.kidIds?.length || 0;
  const familyInitials = rawName ? rawName.split(' ').map((w: string) => w[0] || '').join('').slice(0, 2).toUpperCase() : '?';

  return (
    <Card borderColor={borderColors[variant]} className="mb-3" interactive={!!onClick} onClick={onClick}>
      <div className="flex items-start gap-3">
        <PhotoLightbox src={familyPhoto} initials={familyInitials} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between">
            <p className="font-semibold text-gray-900">{title}</p>
            <Badge variant={badgeVariants[variant]}>{badgeLabels[variant]}</Badge>
            {(apt as any).modified && (
              <Badge variant="amber" className="ml-1">
                {t('appointment.modified')}
              </Badge>
            )}
            {(apt as any).isResubmission && (
              <Badge variant="blue" className="ml-1">
                {t('appointment.resubmitted')}
              </Badge>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2 text-sm text-gray-500">
            <CalendarIcon className="h-4 w-4 shrink-0" />
            {apt.date ? (
              <>
                <span>{formatDate(apt.date)}</span>
                {apt.startTime && apt.endTime && (
                  <span className="text-gray-400">{formatTime(apt.startTime, apt.endTime)}</span>
                )}
              </>
            ) : (
              <span className="text-gray-500">{t('request.recurringLabel')}: {formatRecurringSlots(apt.recurringSlots)}</span>
            )}
          </div>
          <DateTag tag={getDateTag(apt.date || '', apt.startTime || '', holidayPeriods)} className="mt-1" />
          {kidCount > 0 && (
            <p className="mt-1 text-sm text-gray-500">
              {kidCount} {kidCount === 1 ? 'child' : 'children'}
            </p>
          )}
        </div>
      </div>

      {variant === 'pending' && (onAccept || onDecline) && (
        <div className="mt-3 flex gap-2">
          {onAccept && (
            <Button size="sm" onClick={onAccept} className="flex-1">
              Accept
            </Button>
          )}
          {onDecline && (
            <Button size="sm" variant="outline" onClick={onDecline} className="flex-1">
              Decline
            </Button>
          )}
        </div>
      )}

      {variant === 'confirmed' && onCancel && (
        <div className="mt-3">
          <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onCancel(); }} className="w-full">
            {t('appointment.cancel')}
          </Button>
        </div>
      )}
    </Card>
  );
}
