import { logger } from '../../utils/logger.js';
import { callHomeAssistantApi, type HomeArea } from './tools.js';

/**
 * Smart home commands carried out without the Internet of Things agent.
 *
 * "Turn off the living room lights" is one Home Assistant service call, and the agent already
 * makes it in a single step (see `agent.ts`). But that step is still a language model reading its
 * instructions and writing a tool call, after the routing planner has read the request once
 * already -- two model round trips before the lights change. Everything the call needs is a
 * choice from two short lists: which of a handful of everyday actions, and which room. That is a
 * classifier's question, and routing already asks Jev one about every request (see
 * `routing/classifier.ts`), so these questions ride along on the same call and cost no extra round
 * trip at all.
 *
 * Only the plainest commands qualify: an on/off, open/close or play/pause of everything of one
 * kind in one room, or in the whole home. Anything with a value (brightness, colour, a
 * temperature), a device named on its own, an exception ("all but the kitchen"), or no room at
 * all goes to the agent, which is exactly as good at it as before. The classifier picks from
 * fixed lists, so the service it can call is always one of those below and the target is always a
 * real area: it cannot write anything Home Assistant was not already going to be asked.
 */

/** The everyday actions a command can be, keyed by the Home Assistant service they call. */
export const HOME_ACTIONS = {
  'light.turn_on': 'Turn lights on, with no brightness, colour or warmth given',
  'light.turn_off': 'Turn lights off',
  'switch.turn_on': 'Turn on the switches or plugs',
  'switch.turn_off': 'Turn off the switches or plugs',
  'fan.turn_on': 'Turn the fans on',
  'fan.turn_off': 'Turn the fans off',
  'cover.open_cover': 'Open the blinds, curtains, shutters or garage door',
  'cover.close_cover': 'Close the blinds, curtains, shutters or garage door',
  'media_player.media_pause': 'Pause the music or whatever is playing',
  'media_player.media_play': 'Resume the music or whatever was playing',
} as const;

export type HomeAction = keyof typeof HOME_ACTIONS;

/** Anything that is not one of {@link HOME_ACTIONS} as it stands. */
const OTHER_ACTION = 'other';
/** The whole home: "turn off all the lights". */
const EVERYWHERE = 'everywhere';
/** No room named, and not all of them either. */
const UNSPECIFIED = 'unspecified';

function isHomeAction(value: string): value is HomeAction {
  return value in HOME_ACTIONS;
}

/** The questions that settle a command, for routing's classifier to ask alongside its own. */
export function homeCommandQuestions(areas: HomeArea[]) {
  const actionCriteria: Record<string, string> = {
    ...HOME_ACTIONS,
    [OTHER_ACTION]:
      'Anything else: a brightness, colour, warmth, temperature or volume; a scene; one device named on its own ' +
      '("the desk lamp", "the TV"); an exception ("all but the kitchen"); more than one action; a question rather ' +
      'than a command',
  };
  const areaCriteria: Record<string, string> = {
    ...Object.fromEntries(areas.map((area) => [area.id, area.name])),
    [EVERYWHERE]: 'The whole home, or all of them: "turn off all the lights"',
    [UNSPECIFIED]: 'No room is named, and it does not say all of them',
  };

  return {
    homeAction: {
      type: 'choice' as const,
      instructions:
        'If this is a smart home command, which one is it? Choose other unless it is exactly one of these, ' +
        'applied to everything of that kind in a room or in the whole home.',
      criteria: actionCriteria,
    },
    homeArea: {
      type: 'choice' as const,
      instructions: 'Which room of the home does this command apply to?',
      criteria: areaCriteria,
    },
  };
}

/** A command settled well enough to carry out without the agent. */
export interface HomeCommand {
  action: HomeAction;
  /** The area it applies to, or `undefined` for the whole home. */
  area: HomeArea | undefined;
}

/** How sure the classifier is of one choice. */
interface ChoiceAnswer {
  choice: string;
  probabilities?: Record<string, number>;
}

function confidenceOf(answer: ChoiceAnswer): number {
  return answer.probabilities?.[answer.choice] ?? 0;
}

/**
 * Reads the classifier's answers into a command, or into nothing when the agent should decide.
 *
 * Pure, so every way of declining can be tested without a model or a house.
 */
export function homeCommandFrom(
  answers: { homeAction: ChoiceAnswer; homeArea: ChoiceAnswer },
  areas: HomeArea[],
  minimumConfidence: number,
): HomeCommand | undefined {
  const { homeAction, homeArea } = answers;
  if (!isHomeAction(homeAction.choice) || confidenceOf(homeAction) < minimumConfidence) {
    return undefined;
  }
  if (confidenceOf(homeArea) < minimumConfidence) {
    return undefined;
  }

  if (homeArea.choice === EVERYWHERE) {
    return { action: homeAction.choice, area: undefined };
  }

  const area = areas.find((candidate) => candidate.id === homeArea.choice);
  return area ? { action: homeAction.choice, area } : undefined;
}

/** How a command is described, to the user and in the logs. */
export function describeHomeCommand({ action, area }: HomeCommand): string {
  const what = HOME_ACTIONS[action].replace(/, with no .*$/, '');
  return `${what} ${area ? `in the ${area.name}` : 'everywhere in the home'}`;
}

/**
 * Carries a command out, and says what came of it in words the voice model can relay.
 *
 * Home Assistant answers a service call with the states that changed. None changing is not an
 * error -- the lights may already have been off -- but it is not proof that anything happened
 * either, so the result says so rather than claiming success.
 *
 * @throws When Home Assistant refuses the call, so the caller can hand the request to the agent
 */
export async function runHomeCommand(command: HomeCommand): Promise<string> {
  const [domain, service] = command.action.split('.');
  const target = command.area ? { area_id: command.area.id } : { entity_id: 'all' };

  const calledAt = Date.now();
  const changed = await callHomeAssistantApi(`services/${domain}/${service}`, 'POST', target);
  const changedCount = Array.isArray(changed) ? changed.length : 0;
  logger.info('Carried out a home command without the agent', {
    service: command.action,
    target,
    changedCount,
    durationMs: Date.now() - calledAt,
  });

  const description = describeHomeCommand(command);
  return changedCount > 0
    ? `Done: ${description}. ${changedCount} device${changedCount === 1 ? '' : 's'} changed state.`
    : `Asked Home Assistant to ${description.charAt(0).toLowerCase()}${description.slice(1)}, and nothing changed state: they may already have been that way, or there are none of that kind there.`;
}
