/**
 * Alarms set on the phone without the agent: the time Jev is asked to pick, and every way of
 * declining to act on its answer.
 *
 * Declining is always safe -- the agent sets the alarm instead -- so most of what is pinned here is
 * that it declines whenever it is not sure. Home Assistant is faked at `fetch`, scoped to each test.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { Classifier } from '@mastra/core/classifier';
import type { LookupToolCaller } from '../../utils/direct-lookup-factory.js';
import { executeTool } from '../../utils/tool-factory.js';
import {
  alarmTimeFrom,
  type PhoneAlarmTimeAnswers,
  phoneAlarmTimeQuestions,
  setPhoneAlarmDirectly,
} from './phone-alarm.js';

const SURE = 0.85;

function sure(choice: string, confidence = 0.97) {
  return { type: 'choice' as const, choice, probabilities: { [choice]: confidence } };
}

/** Jev's answers for "wake me at 6:30", with any of them overridden. */
function halfPastSix(overrides: Partial<PhoneAlarmTimeAnswers> = {}): PhoneAlarmTimeAnswers {
  return {
    alarmHour: sure('h6'),
    alarmMinute: sure('m30'),
    alarmGivenAsTimeOfDay: { type: 'boolean', probability: 0.98 },
    alarmHasLabel: { type: 'boolean', probability: 0.02 },
    ...overrides,
  };
}

describe('phoneAlarmTimeQuestions', () => {
  it('offers every hour of the day and every minute of the hour', () => {
    const { alarmHour, alarmMinute } = phoneAlarmTimeQuestions();

    expect(Object.keys(alarmHour.criteria)).toHaveLength(24);
    expect(Object.keys(alarmMinute.criteria)).toHaveLength(60);
    expect(alarmHour.criteria.h6).toContain('6 AM');
    expect(alarmHour.criteria.h18).toContain('6 PM');
    expect(alarmMinute.criteria.m30).toBe('Half past');
  });
});

describe('alarmTimeFrom', () => {
  it('reads the hour and minute Jev is sure of', () => {
    expect(alarmTimeFrom(halfPastSix(), SURE)).toEqual({ hour: 6, minute: 30 });
    expect(alarmTimeFrom(halfPastSix({ alarmHour: sure('h0'), alarmMinute: sure('m0') }), SURE)).toEqual({
      hour: 0,
      minute: 0,
    });
  });

  it('declines a morning-or-evening hour, an unsure minute, a time from now, or a named alarm', () => {
    const declined = [
      halfPastSix({ alarmHour: { type: 'choice', choice: 'h7', probabilities: { h7: 0.5, h19: 0.5 } } }),
      halfPastSix({ alarmMinute: sure('m30', 0.6) }),
      halfPastSix({ alarmGivenAsTimeOfDay: { type: 'boolean', probability: 0.3 } }),
      halfPastSix({ alarmHasLabel: { type: 'boolean', probability: 0.5 } }),
      halfPastSix({ alarmHour: { type: 'choice', choice: 'h6' } }),
    ];

    for (const answers of declined) {
      expect(alarmTimeFrom(answers, SURE)).toBeUndefined();
    }
  });
});

describe('setPhoneAlarmDirectly', () => {
  /**
   * Spreads what a choice's probabilities leave over the options they leave out, since a real
   * evaluation model returns the whole distribution and the classifier refuses anything less.
   */
  function withCompleteDistributions(answers: PhoneAlarmTimeAnswers): PhoneAlarmTimeAnswers {
    const questions = phoneAlarmTimeQuestions();
    function complete(answer: PhoneAlarmTimeAnswers['alarmHour'], options: string[]) {
      const given = answer.probabilities ?? {};
      const missing = options.filter((option) => !(option in given));
      const left = 1 - Object.values(given).reduce((sum, probability) => sum + probability, 0);
      return {
        ...answer,
        probabilities: { ...given, ...Object.fromEntries(missing.map((option) => [option, left / missing.length])) },
      };
    }
    return {
      ...answers,
      alarmHour: complete(answers.alarmHour, Object.keys(questions.alarmHour.criteria)),
      alarmMinute: complete(answers.alarmMinute, Object.keys(questions.alarmMinute.criteria)),
    };
  }

  function classifierAnswering(answers: PhoneAlarmTimeAnswers) {
    return new Classifier({
      id: 'homeCommandClassifier',
      model: {
        specificationVersion: 'v4',
        provider: 'fake',
        modelId: 'jev-fake',
        supportedQuestionTypes: ['choice', 'boolean'],
        doEvaluate: async () => ({ answers: withCompleteDistributions(answers), warnings: [] }),
      },
    });
  }

  const ENVIRONMENT = [
    'HEY_JARVIS_HOME_ASSISTANT_URL',
    'HEY_JARVIS_HOME_ASSISTANT_TOKEN',
    'HEY_JARVIS_PRIMARY_USER_NOTIFY_SERVICE',
  ] as const;
  const saved = new Map<string, string | undefined>();
  /** What the phone was sent, through Home Assistant's companion-app notify service. */
  const phoneCommands: { url: string; body: unknown }[] = [];
  let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>> | undefined;
  /** Calls tools for real, so the command reaches the faked Home Assistant as the agent's would. */
  const callTool: LookupToolCaller = (tool, inputData) => executeTool(tool, inputData);

  beforeEach(() => {
    for (const name of ENVIRONMENT) {
      saved.set(name, process.env[name]);
    }
    process.env.HEY_JARVIS_HOME_ASSISTANT_URL = 'http://home-assistant.test';
    process.env.HEY_JARVIS_HOME_ASSISTANT_TOKEN = 'test-token';
    process.env.HEY_JARVIS_PRIMARY_USER_NOTIFY_SERVICE = 'notify.mobile_app_phone';
    phoneCommands.length = 0;

    fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
      Object.assign(
        async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
          phoneCommands.push({ url: String(input), body: JSON.parse(String(init?.body ?? '{}')) });
          return new Response('[]');
        },
        { preconnect: globalThis.fetch.preconnect },
      ),
    );
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    for (const [name, value] of saved) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  it('sets the alarm Jev is sure of on the phone, and relays what the phone was sent', async () => {
    const text = await setPhoneAlarmDirectly(
      { request: 'wake me at 6:30', minimumConfidence: SURE, callTool },
      classifierAnswering(halfPastSix()),
    );

    expect(phoneCommands).toEqual([
      {
        url: 'http://home-assistant.test/api/services/notify/mobile_app_phone',
        body: expect.objectContaining({ message: 'command_activity' }),
      },
    ]);
    expect(JSON.stringify(phoneCommands[0]?.body)).toContain('android.intent.extra.alarm.HOUR:6:int');
    expect(JSON.stringify(phoneCommands[0]?.body)).toContain('android.intent.extra.alarm.MINUTES:30:int');
    expect(text).toContain('06:30');
  });

  it('sends the phone nothing when Jev is unsure when', async () => {
    const text = await setPhoneAlarmDirectly(
      { request: 'set an alarm for 7', minimumConfidence: SURE, callTool },
      classifierAnswering(
        halfPastSix({ alarmHour: { type: 'choice', choice: 'h7', probabilities: { h7: 0.55, h19: 0.45 } } }),
      ),
    );

    expect(text).toBeUndefined();
    expect(phoneCommands).toEqual([]);
  });
});
