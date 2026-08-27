/**
 * hasStarted pins (issue #238): the UX mirror of setAppointmentNote's Paris
 * wall-clock timing gate.
 */
import { describe, expect, it } from 'vitest';
import { hasStarted, parisNowStamp } from '../appointmentTime';

function parisDateOf(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(instant);
}
const DAY = 24 * 60 * 60 * 1000;
const TOMORROW = parisDateOf(new Date(Date.now() + DAY));
const YESTERDAY = parisDateOf(new Date(Date.now() - DAY));

describe('hasStarted', () => {
  it('a yesterday start has started', () => {
    expect(hasStarted(YESTERDAY, '12:00')).toBe(true);
  });

  it('a tomorrow start has not started', () => {
    expect(hasStarted(TOMORROW, '12:00')).toBe(false);
  });

  it('missing date or startTime (a recurring appointment) is NOT started — the caller decides', () => {
    expect(hasStarted(undefined, '12:00')).toBe(false);
    expect(hasStarted(YESTERDAY, undefined)).toBe(false);
    expect(hasStarted()).toBe(false);
  });

  it('parisNowStamp emits a sortable YYYY-MM-DDTHH:MM stamp', () => {
    expect(parisNowStamp()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });
});
