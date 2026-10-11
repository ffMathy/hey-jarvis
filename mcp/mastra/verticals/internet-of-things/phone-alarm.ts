import type { ClassifierAnswers } from '@mastra/core/classifier';
import { createDirectCommand, type DirectCommandContext } from '../../utils/direct-lookup-factory.js';
import { confidentChoice } from '../../utils/index.js';
import { logger } from '../../utils/logger.js';
import { setPhoneAlarm } from '../notification/tools.js';
import { getHomeCommandClassifier } from './home-commands.js';

/**
 * Alarms set on the phone without the Internet of Things agent.
 *
 * "Wake me at 6:30" is one call of `setUserPhoneAlarm`, but it is not a Home Assistant service
 * that targets entities, so `home-commands.ts` never offers it, and the request used to wait on the
 * agent's tool loop -- a language model reading its instructions and writing the call. What the call
 * needs is an hour and a minute, though, and those are two choices from fixed lists, which is what
 * Jev answers (see `.claude/rules/jev-classifiers.md`):
 *
 * 1. **Is it an alarm.** The command's description is offered on the call routing already makes,
 *    alongside every other vertical's, so spotting one costs no extra round trip.
 * 2. **When.** Once routing is sure, one more short call picks the hour from 24 and the minute from
 *    60, and checks the time was said as a time of day and the alarm was not given a name.
 *
 * Anything Jev is not sure of goes to the agent as before: "set an alarm for 7" is morning or
 * evening, "in twenty minutes" needs the clock, and a label is free text nothing here can write.
 */

/** The key an hour is offered under, so the choice can be read back as a number. */
function hourKey(hour: number): string {
  return `h${hour}`;
}

/** The key a minute is offered under. */
function minuteKey(minute: number): string {
  return `m${minute}`;
}

/** An hour as it is said: "6 in the morning (6 AM)". */
function describeHour(hour: number): string {
  const twelveHour = hour % 12 === 0 ? 12 : hour % 12;
  const meridiem = hour < 12 ? 'AM' : 'PM';
  if (hour === 0) {
    return 'Midnight hour (12 AM)';
  }
  if (hour === 12) {
    return 'Noon hour (12 PM)';
  }
  const partOfDay = hour < 12 ? 'in the morning' : hour < 18 ? 'in the afternoon' : 'in the evening';
  return `${twelveHour} ${partOfDay} (${twelveHour} ${meridiem})`;
}

/** A minute as it is said: "half past", "quarter to the next hour". */
function describeMinute(minute: number): string {
  switch (minute) {
    case 0:
      return "On the hour, o'clock";
    case 15:
      return 'Quarter past';
    case 30:
      return 'Half past';
    case 45:
      return 'Quarter to the next hour';
    default:
      return `${minute} minutes past`;
  }
}

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const MINUTES = Array.from({ length: 60 }, (_, minute) => minute);

/** The questions that settle when an alarm rings, asked once routing is sure the request sets one. */
export function phoneAlarmTimeQuestions() {
  return {
    alarmHour: {
      type: 'choice' as const,
      instructions:
        'Which hour of the day should the alarm ring in? Quarter to seven in the morning rings in the 6 AM hour, ' +
        'and half past six in the 6 AM hour.',
      criteria: Object.fromEntries(HOURS.map((hour) => [hourKey(hour), describeHour(hour)])),
    },
    alarmMinute: {
      type: 'choice' as const,
      instructions: 'How many minutes past that hour should the alarm ring?',
      criteria: Object.fromEntries(MINUTES.map((minute) => [minuteKey(minute), describeMinute(minute)])),
    },
    alarmGivenAsTimeOfDay: {
      type: 'boolean' as const,
      instructions:
        'Does the request say the time of day the alarm should ring, rather than how long from now ("in 20 minutes")?',
    },
    alarmHasLabel: {
      type: 'boolean' as const,
      instructions:
        'Does the request give the alarm a name, or say what it is for ("called laundry", "for the train")?',
    },
  };
}

export type PhoneAlarmTimeAnswers = ClassifierAnswers<ReturnType<typeof phoneAlarmTimeQuestions>>;

/** When an alarm rings, in 24-hour form. */
export interface AlarmTime {
  hour: number;
  minute: number;
}

/**
 * Reads the classifier's answers into when the alarm rings, or into nothing when the agent should
 * set it. Pure, so every way of declining can be tested without a model or a phone.
 */
export function alarmTimeFrom(answers: PhoneAlarmTimeAnswers, minimumConfidence: number): AlarmTime | undefined {
  if (answers.alarmGivenAsTimeOfDay.probability < minimumConfidence) {
    return undefined;
  }
  if (answers.alarmHasLabel.probability > 1 - minimumConfidence) {
    return undefined;
  }

  const hourChoice = confidentChoice(answers.alarmHour, minimumConfidence);
  const minuteChoice = confidentChoice(answers.alarmMinute, minimumConfidence);
  const hour = HOURS.find((candidate) => hourKey(candidate) === hourChoice);
  const minute = MINUTES.find((candidate) => minuteKey(candidate) === minuteChoice);
  return hour === undefined || minute === undefined ? undefined : { hour, minute };
}

/**
 * Sets an alarm on the phone without the agent, and says what came of it in words the voice model
 * can relay.
 *
 * The tool is called through `callTool`, as the agent's `setUserPhoneAlarm` would be, and like it
 * reports nothing for sir's headset to light up: the alarm lives on the phone, not on an entity.
 *
 * Resolves to `undefined` when it declines -- no classifier, or Jev not sure when -- so the request
 * goes to the agent.
 *
 * @throws When the phone cannot be reached, so the request goes to the agent too
 */
export async function setPhoneAlarmDirectly(
  { request, minimumConfidence, callTool }: DirectCommandContext,
  classifier = getHomeCommandClassifier(),
): Promise<string | undefined> {
  if (!classifier) {
    return undefined;
  }

  const { answers } = await classifier.evaluate({
    state: request,
    questions: phoneAlarmTimeQuestions(),
    // A failed call hands the request to the agent, so retrying would only delay that.
    maxRetries: 0,
  });
  const time = alarmTimeFrom(answers, minimumConfidence);
  if (!time) {
    logger.info('Phone alarm left to the agent: unsure when it rings');
    return undefined;
  }

  const { message } = await callTool(setPhoneAlarm, time);
  logger.info('Set a phone alarm without the agent', time);
  return message;
}

/** "Wake me at 6:30", carried out without the agent once routing is sure that is all it asks. */
export const phoneAlarmCommand = createDirectCommand({
  id: 'internetOfThings.phoneAlarm',
  agentId: 'internetOfThings',
  description:
    'Set one alarm or wake-up call on the phone, and nothing else -- not a timer, a reminder, or a change to an ' +
    'existing alarm',
  answer: (context) => setPhoneAlarmDirectly(context),
});
