import { TZDate } from '@date-fns/tz';

/**
 * The time zone the household lives in, which "today" and "tomorrow" are counted in.
 *
 * The server's own clock may run in UTC (the add-on container does), so anything that turns a
 * spoken day into times -- a schedule's cadence, a calendar lookup's window -- names it outright.
 */
export const HOUSEHOLD_TIME_ZONE = 'Europe/Copenhagen';

/**
 * A moment as the household's clock shows it, with its offset and zone name:
 * `Sun Oct 25 2026 14:25:00 GMT+0100 (Central European Standard Time)`.
 *
 * `Date#toString` writes the server's zone instead, and the add-on container runs in UTC, so an
 * agent told the time that way was an hour or two behind -- "an alarm in an hour and five
 * minutes" asked at 14:25 rang at 14:30.
 */
export function householdTime(now = new Date()): string {
  return new TZDate(now, HOUSEHOLD_TIME_ZONE).toString();
}
