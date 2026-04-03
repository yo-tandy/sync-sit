/**
 * Build a data URI for an .ics calendar event.
 * Opens the native calendar app on iOS/Android.
 */
export function buildCalendarUrl(
  date: string,
  startTime: string,
  endTime: string,
  title: string,
  location?: string
): string {
  const start = `${date.replace(/-/g, '')}T${startTime.replace(':', '')}00`;
  const end = `${date.replace(/-/g, '')}T${endTime.replace(':', '')}00`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:Babysitting — ${title}`,
    location ? `LOCATION:${location}` : '',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(lines)}`;
}
