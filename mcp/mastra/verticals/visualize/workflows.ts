import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { getImportantChangeStorage } from '../../storage/index.js';
import { householdTime } from '../../utils/household.js';
import type { GlanceAction } from '../../utils/live-events.js';
import { logger } from '../../utils/logger.js';
import { executeTool } from '../../utils/tool-factory.js';
import { createAgentStep, createStep, createWorkflow } from '../../utils/workflows/workflow-factory.js';
import { getCalendarEvents } from '../calendar/tools.js';
import type { ClaudeCodeModel } from '../coding/claude-code-host.js';
import { getHomeSnapshot, summarizeActionableEntitiesInSnapshot } from '../internet-of-things/home-state-cache.js';
import {
  buildGlanceRequest,
  decideGlanceRebuild,
  describeGlanceContext,
  GLANCE_CALENDAR_LOOKAHEAD_MS,
  GLANCE_PLANNER_INSTRUCTIONS,
  type GlanceContext,
  type GlancePlan,
  glanceContextSchema,
  glancePlanSchema,
  normalizeGlanceActions,
  whyGlancesAreOff,
} from './glance.js';
import { injectGlanceBridge } from './glance-bridge.js';
import { publishGlance, readCurrentGlance } from './glance-store.js';
import { buildArtifactTask, runArtifactSession } from './shortcuts.js';
import { hostSessionPage } from './tools.js';

/**
 * The model a glance's page is built on: a glance is rebuilt many times a day, unasked, so it runs
 * on the smallest model to save subscription credits.
 */
export const GLANCE_SESSION_MODEL = 'haiku' satisfies ClaudeCodeModel;

/** The most calendar events the glance is planned from. */
const MAX_GLANCE_EVENTS = 15;

/** Why a source could not be read, for the log and the planner. */
function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const glanceOutputSchema = z.object({
  rebuilt: z.boolean().describe('Whether a new glance was built and published'),
  message: z.string(),
  url: z.string().optional().describe("Where the new glance's page is hosted"),
});

const recentChangesSchema = z.object({
  changes: z.array(z.object({ summary: z.string(), source: z.string(), notedAt: z.string() })),
  changesUnavailable: z.string().optional(),
});

/** The important changes of the last day, read without marking any told, or why they could not be. */
async function readRecentChanges(now: Date): Promise<z.infer<typeof recentChangesSchema>> {
  try {
    const storage = await getImportantChangeStorage();
    const changes = await storage.listRecent(now);
    return { changes: changes.map(({ summary, source, notedAt }) => ({ summary, source, notedAt })) };
  } catch (error) {
    logger.warn('[GLANCE] Could not read the important changes; deciding and planning without them', {
      error: reasonOf(error),
    });
    return { changes: [], changesUnavailable: reasonOf(error) };
  }
}

/**
 * Decides whether a glance is worth building now, and ends the run at once when it is not: this
 * runs every quarter of an hour, and building one costs minutes of a Claude Code session.
 */
const decideGlanceRebuildStep = createStep({
  id: 'decide-glance-rebuild',
  description: 'Decides whether the glance needs building again, and ends the run when it does not',
  inputSchema: z.object({}),
  outputSchema: recentChangesSchema,
  execute: async ({ bail }) => {
    const now = new Date();
    const [current, recent] = await Promise.all([readCurrentGlance(now), readRecentChanges(now)]);
    const decision = decideGlanceRebuild({ now, current, latestChangeNotedAt: recent.changes[0]?.notedAt });

    if (!decision.rebuild) {
      return bail({ rebuilt: false, message: `No rebuild: ${decision.reason}.` } satisfies z.infer<
        typeof glanceOutputSchema
      >);
    }

    const offBecause = whyGlancesAreOff();
    if (offBecause) {
      return bail({ rebuilt: false, message: `${offBecause}.` } satisfies z.infer<typeof glanceOutputSchema>);
    }

    logger.info('[GLANCE] Building the glance', { reason: decision.reason });
    return recent;
  },
});

/** The calendar's next day, or why it could not be read. */
async function readUpcomingEvents(
  now: Date,
  context: Parameters<typeof executeTool>[2],
): Promise<Pick<GlanceContext, 'events' | 'calendarUnavailable'>> {
  try {
    const { events } = await executeTool(
      getCalendarEvents,
      {
        calendarId: 'primary',
        allCalendars: true,
        maxResults: MAX_GLANCE_EVENTS,
        timeMin: now.toISOString(),
        timeMax: new Date(now.getTime() + GLANCE_CALENDAR_LOOKAHEAD_MS).toISOString(),
      },
      context,
    );
    return { events: events.map(({ summary, start, end, location }) => ({ summary, start, end, location })) };
  } catch (error) {
    logger.warn('[GLANCE] Could not read the calendar; planning without it', { error: reasonOf(error) });
    return { events: [], calendarUnavailable: reasonOf(error) };
  }
}

/** What in the house could be acted on, from the live copy, or why there is none to read. */
function readActionableEntities(): Pick<GlanceContext, 'entities' | 'homeUnavailable'> {
  const snapshot = getHomeSnapshot();
  if (!snapshot) {
    logger.warn('[GLANCE] There is no live copy of the house; planning without its devices');
    return { entities: [], homeUnavailable: 'there is no live copy of the house in this process' };
  }
  return {
    entities: summarizeActionableEntitiesInSnapshot(snapshot).map(({ id, name, area, state }) => ({
      id,
      name,
      area,
      state,
    })),
  };
}

const gatherGlanceContext = createStep({
  id: 'gather-glance-context',
  description: 'Reads what the glance is planned from: the calendar, the house and the important changes',
  inputSchema: recentChangesSchema,
  outputSchema: glanceContextSchema,
  execute: async ({ inputData, mastra }) => {
    const now = new Date();
    const events = await readUpcomingEvents(now, { mastra });

    return {
      readAt: now.toISOString(),
      householdTime: householdTime(now),
      ...inputData,
      ...events,
      ...readActionableEntities(),
    };
  },
});

const planGlance = createAgentStep({
  id: 'plan-glance',
  description: 'Decides what the glance shows and which actions it offers',
  agentConfig: {
    id: 'glance-planner',
    name: 'GlancePlanner',
    instructions: GLANCE_PLANNER_INSTRUCTIONS,
    description: "Plans sir's glance: what his phone shows when he opens Jarvis, and the buttons on it",
  },
  inputSchema: glanceContextSchema,
  outputSchema: glancePlanSchema,
  prompt: ({ inputData }) => describeGlanceContext(inputData),
});

/**
 * Has a Claude Code session build the glance's page from its plan, on {@link GLANCE_SESSION_MODEL}.
 *
 * @internal Exported for tests.
 */
export async function runGlanceSession(
  plan: GlancePlan,
  plannedAt: string,
  actions: GlanceAction[],
  context: Parameters<typeof executeTool>[2],
) {
  return await runArtifactSession(
    buildArtifactTask(buildGlanceRequest(plan, plannedAt), { glance: { actions } }),
    context,
    GLANCE_SESSION_MODEL,
  );
}

const buildGlance = createStep({
  id: 'build-glance',
  description: 'Has a Claude Code session build the page, hosts it with the bridge in, and publishes it',
  inputSchema: glancePlanSchema,
  outputSchema: glanceOutputSchema,
  execute: async ({ inputData, getStepResult, mastra }) => {
    // The glance is as old as what it was planned from, not as old as the build that followed:
    // a change noted while the session worked is newer than the glance, and is built next time.
    const { readAt, householdTime: plannedAt } = getStepResult(gatherGlanceContext);
    const actions = normalizeGlanceActions(inputData.actions);

    const session = await runGlanceSession(inputData, plannedAt, actions, { mastra });
    const page = await hostSessionPage(session, injectGlanceBridge);
    if (!page.success) {
      throw new Error(`The glance could not be built: ${page.message}`);
    }

    const glance = {
      id: randomUUID(),
      url: page.hosted.url,
      artifactId: page.hosted.id,
      title: inputData.title.trim(),
      generatedAt: readAt,
      actions,
    };
    await publishGlance(glance);
    logger.info('[GLANCE] Published a new glance', {
      glanceId: glance.id,
      actionIds: actions.map((action) => action.id),
    });

    return { rebuilt: true, message: `Published the glance "${glance.title}".`, url: glance.url };
  },
});

/**
 * Builds sir's glance ahead of time, when it is worth building (see `glance.ts`): scheduled every
 * quarter of an hour in `schedule-reconciler.ts`, and on startup.
 */
export const glanceWorkflow = createWorkflow({
  id: 'glanceWorkflow',
  inputSchema: z.object({}),
  outputSchema: glanceOutputSchema,
})
  .then(decideGlanceRebuildStep)
  .then(gatherGlanceContext)
  .then(planGlance)
  .then(buildGlance)
  .commit();
