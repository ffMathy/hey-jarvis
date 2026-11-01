/**
 * The glance: a page sir's phone shows when he opens Jarvis from the launcher, rather than with the
 * assistant button, built ahead of time from what has been going on — an email said a parcel comes
 * this afternoon, so the page shows the delivery and a button to unlock the front door.
 *
 * Building one costs minutes of a Claude Code session, so `glanceWorkflow` (`workflows.ts`) runs on
 * a schedule and first decides here whether a rebuild is worth it at all. Everything in this module
 * is the deciding and the wording; the workflow does the fetching and the building.
 *
 * **The action guard.** A button on the page only names an action by its id, and the server runs
 * an action only when it is on the *current* glance (`api/live-socket.ts`): a device can trigger
 * nothing but a prompt the server itself planned, and a page that has since been replaced triggers
 * nothing at all.
 */

import { TZDate } from '@date-fns/tz';
import { uniqBy } from 'lodash-es';
import { z } from 'zod';
import { HOUSEHOLD_TIME_ZONE } from '../../utils/household.js';
import type { GlanceAction } from '../../utils/live-events.js';
import { getMissingClaudeCodeHostVariables } from '../coding/claude-code-host.js';
import { hasPublicBaseUrl } from './artifact-hosting.js';
import type { StoredGlance } from './glance-store.js';

/** How old a glance may grow, with nothing new to show, before it is built afresh anyway. */
export const GLANCE_MAX_AGE_MS = 3 * 60 * 60 * 1000;

/**
 * The household hours in which a glance is not rebuilt, unless there is none: from 23:00 until
 * 06:00 nobody is looking, and whatever happens overnight is still news in the morning.
 */
export const GLANCE_QUIET_HOURS = { fromHour: 23, untilHour: 6 } as const;

/** The most buttons a glance offers: more than a thumb's worth is a menu, not a glance. */
export const MAX_GLANCE_ACTIONS = 4;

/** How far ahead the calendar is read. */
export const GLANCE_CALENDAR_LOOKAHEAD_MS = 24 * 60 * 60 * 1000;

export type GlanceRebuildDecision = { rebuild: boolean; reason: string };

/** Whether `now` falls in {@link GLANCE_QUIET_HOURS}, on the household's clock. */
export function isGlanceQuietHour(now: Date): boolean {
  const hour = new TZDate(now, HOUSEHOLD_TIME_ZONE).getHours();
  return hour >= GLANCE_QUIET_HOURS.fromHour || hour < GLANCE_QUIET_HOURS.untilHour;
}

/**
 * Whether the current glance should be built again: when there is none, when an important change
 * was noted after it was built, or when it is older than {@link GLANCE_MAX_AGE_MS} — and never in
 * the quiet hours unless there is none at all.
 */
export function decideGlanceRebuild({
  now,
  current,
  latestChangeNotedAt,
}: {
  now: Date;
  current: Pick<StoredGlance, 'generatedAt'> | undefined;
  /** When the newest important change of the last day was noted, if there is one. */
  latestChangeNotedAt: string | undefined;
}): GlanceRebuildDecision {
  if (!current) {
    return { rebuild: true, reason: 'there is no current glance' };
  }
  if (isGlanceQuietHour(now)) {
    return { rebuild: false, reason: 'it is the quiet hours, and there is a glance already' };
  }

  const generatedAt = Date.parse(current.generatedAt);
  if (latestChangeNotedAt !== undefined && Date.parse(latestChangeNotedAt) > generatedAt) {
    return { rebuild: true, reason: 'an important change was noted since the glance was built' };
  }
  if (now.getTime() - generatedAt >= GLANCE_MAX_AGE_MS) {
    return { rebuild: true, reason: 'the glance is more than three hours old' };
  }
  return { rebuild: false, reason: 'the glance is up to date' };
}

/** Why no glance can be built in this process, naming what is missing (never a value), or nothing. */
export function whyGlancesAreOff(): string | undefined {
  const missing = [...getMissingClaudeCodeHostVariables(), ...(hasPublicBaseUrl() ? [] : ['HEY_JARVIS_PUBLIC_URL'])];
  return missing.length > 0 ? `Glances are off: ${missing.join(', ')} not set` : undefined;
}

/** What the glance is planned from. Each source that could not be read says why instead. */
export const glanceContextSchema = z.object({
  /** When it was read, as an ISO 8601 timestamp: what the glance's age is counted from. */
  readAt: z.string(),
  /** The household's clock at that moment, written out. */
  householdTime: z.string(),
  changes: z.array(z.object({ summary: z.string(), source: z.string(), notedAt: z.string() })),
  changesUnavailable: z.string().optional(),
  events: z.array(
    z.object({ summary: z.string(), start: z.string(), end: z.string(), location: z.string().optional() }),
  ),
  calendarUnavailable: z.string().optional(),
  entities: z.array(z.object({ id: z.string(), name: z.string(), area: z.string().nullable(), state: z.string() })),
  homeUnavailable: z.string().optional(),
});

export type GlanceContext = z.infer<typeof glanceContextSchema>;

/** What the planner decides: the page's title, the brief it is built from, and its buttons. */
export const glancePlanSchema = z.object({
  title: z.string().describe('A few words naming what matters right now, e.g. "Your parcel arrives at 14"'),
  brief: z
    .string()
    .describe(
      'Everything the page should show, in full: the facts, times and names it needs, since the page builder sees nothing else',
    ),
  actions: z
    .array(
      z.object({
        id: z.string().describe('A short slug of lowercase letters, digits and hyphens, e.g. "unlock-front-door"'),
        label: z.string().describe('The button text, two to four words, e.g. "Unlock the door"'),
        prompt: z
          .string()
          .describe('A plain imperative request to Jarvis, as sir would say it: "Unlock the front door"'),
      }),
    )
    .describe(`At most ${MAX_GLANCE_ACTIONS} actions that are timely now; none is fine`),
});

export type GlancePlan = z.infer<typeof glancePlanSchema>;

/** What the planner is told to do, beside the context it is handed. */
export const GLANCE_PLANNER_INSTRUCTIONS = `You plan sir's glance: the page his phone shows when he opens Jarvis from the launcher. It shows what he is likely to need in the next few hours, and offers a button for anything he would plausibly want done about it.

Decide from the context you are given:
- title: a few words naming what matters most right now.
- brief: everything the page should show, written out in full with the facts, times and names it needs, most important first. The page builder sees nothing but this brief. Write times in the household's clock.
- actions: at most ${MAX_GLANCE_ACTIONS}, and only ones that are timely given the context — a delivery arriving soon makes unlocking the front door timely; a lock with nothing going on does not. Each prompt is a plain imperative request to Jarvis, as sir would say it ("Unlock the front door"), and may only act on a device listed in the context, by its name. Never offer to buy, send, pay or delete anything. No actions is a perfectly good answer.

When nothing notable is going on, the brief is a calm page saying nothing needs him right now, with the current time and the next calendar item, if there is one, and no actions.

Never invent facts that are not in the context. When a source is marked unavailable, leave it out of the page rather than guessing.`;

/** The context written out for the planner. */
export function describeGlanceContext(context: GlanceContext): string {
  const changes = context.changesUnavailable
    ? `Unavailable: ${context.changesUnavailable}`
    : context.changes
        .map((change) => `- ${change.summary} (from ${change.source}, noted ${change.notedAt})`)
        .join('\n') || 'None.';
  const events = context.calendarUnavailable
    ? `Unavailable: ${context.calendarUnavailable}`
    : context.events
        .map(
          (event) =>
            `- ${event.summary}: ${event.start} to ${event.end}${event.location ? ` at ${event.location}` : ''}`,
        )
        .join('\n') || 'Nothing in the next 24 hours.';
  const entities = context.homeUnavailable
    ? `Unavailable: ${context.homeUnavailable}`
    : context.entities
        .map((entity) => `- ${entity.name}${entity.area ? ` (${entity.area})` : ''}: ${entity.state}`)
        .join('\n') || 'None.';

  return `The household's time is ${context.householdTime}.

# What happened in the last 24 hours that sir would want to know
${changes}

# His calendar for the next 24 hours
${events}

# Devices in the house he could act on, and their state now
${entities}`;
}

/** Turns anything a model wrote as an id into the slug a glance action is named by. */
function toActionId(id: string): string {
  return id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/**
 * The planner's actions, made fit for a page: ids made slugs, empty ones and repeats dropped, and
 * no more than {@link MAX_GLANCE_ACTIONS}. A model told the rules still breaks them now and then,
 * and the page and the device need them kept.
 */
export function normalizeGlanceActions(actions: GlancePlan['actions']): GlanceAction[] {
  const cleaned = actions
    .map((action) => ({ id: toActionId(action.id), label: action.label.trim(), prompt: action.prompt.trim() }))
    .filter((action) => action.id.length > 0 && action.label.length > 0 && action.prompt.length > 0);
  return uniqBy(cleaned, (action) => action.id).slice(0, MAX_GLANCE_ACTIONS);
}

/** What the page builder is asked for, from the plan. */
export function buildGlanceRequest(plan: GlancePlan, householdTime: string): string {
  return `Build sir's glance, titled "${plan.title.trim()}", as of ${householdTime}.

${plan.brief.trim()}`;
}
