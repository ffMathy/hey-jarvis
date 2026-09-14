/**
 * Cron expressions for the cadences {@link ../../scheduler.ts} actually schedules.
 *
 * Named rather than inline so a schedule reads as its intent — `EVERY_3_HOURS` rather
 * than a five-field expression — and so two workflows meant to share a cadence cannot
 * drift apart.
 *
 * Only the cadences in use are listed. Mastra validates the expression when the schedule
 * row is created, so a new one can be added here verbatim in standard 5-field form; it
 * also accepts croner nicknames (`@hourly`, `@daily`) where one fits.
 */
export const CronPatterns = {
  EVERY_MINUTE: '* * * * *',
  EVERY_3_HOURS: '0 */3 * * *',
  DAILY_AT_MIDNIGHT: '0 0 * * *',
  WEEKLY_SUNDAY_8AM: '0 8 * * 0',
} as const;
