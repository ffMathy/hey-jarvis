/**
 * The time zone the household lives in, which "today" and "tomorrow" are counted in.
 *
 * The server's own clock may run in UTC (the add-on container does), so anything that turns a
 * spoken day into times -- a schedule's cadence, a calendar lookup's window -- names it outright.
 */
export const HOUSEHOLD_TIME_ZONE = 'Europe/Copenhagen';
