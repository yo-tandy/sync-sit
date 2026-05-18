import { SCHEDULE_SLOT_MINUTES, SLOTS_PER_DAY } from '../constants/config.js';

/**
 * Convert "HH:MM" time string to slot index (0-95).
 */
export function timeToSlotIndex(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return Math.floor((hours * 60 + minutes) / SCHEDULE_SLOT_MINUTES);
}

/**
 * Convert slot index (0-95) to "HH:MM" time string.
 */
export function slotIndexToTime(index: number): string {
  const totalMinutes = index * SCHEDULE_SLOT_MINUTES;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

/**
 * Check if all slots between startTime and endTime are available.
 */
export function areSlotsAvailable(
  slots: boolean[],
  startTime: string,
  endTime: string
): boolean {
  const startIdx = timeToSlotIndex(startTime);
  const endIdx = timeToSlotIndex(endTime);

  for (let i = startIdx; i < endIdx && i < SLOTS_PER_DAY; i++) {
    if (!slots[i]) return false;
  }
  return true;
}

/**
 * Create an empty schedule (all unavailable).
 */
export function createEmptySlots(): boolean[] {
  return new Array(SLOTS_PER_DAY).fill(false);
}

/**
 * Create a fully available schedule.
 */
export function createFullSlots(): boolean[] {
  return new Array(SLOTS_PER_DAY).fill(true);
}

/**
 * Set a range of slots to a value.
 */
export function setSlotRange(
  slots: boolean[],
  startTime: string,
  endTime: string,
  value: boolean
): boolean[] {
  const result = [...slots];
  const startIdx = timeToSlotIndex(startTime);
  const endIdx = timeToSlotIndex(endTime);

  for (let i = startIdx; i < endIdx && i < SLOTS_PER_DAY; i++) {
    result[i] = value;
  }
  return result;
}
