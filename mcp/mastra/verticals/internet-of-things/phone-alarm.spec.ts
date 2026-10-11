/**
 * Alarms set on the phone without the agent: the time Jev is asked to pick, and every way of
 * declining to act on its answer.
 *
 * Declining is always safe -- the agent sets the alarm instead -- so most of what is pinned here is
 * that it declines whenever it is not sure. The phone is faked as the setter the alarm is handed to.
 */

import { describe, expect, it } from 'bun:test';
import { Classifier } from '@mastra/core/classifier';
import {
  type AlarmTime,
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

  it('sets the alarm Jev is sure of, and relays what the phone was sent', async () => {
    const set: AlarmTime[] = [];

    const outcome = await setPhoneAlarmDirectly(
      'wake me at 6:30',
      SURE,
      classifierAnswering(halfPastSix()),
      async (time) => {
        set.push(time);
        return 'Sent the phone a command to set an alarm for 06:30';
      },
    );

    expect(set).toEqual([{ hour: 6, minute: 30 }]);
    expect(outcome).toEqual({ text: 'Sent the phone a command to set an alarm for 06:30', entities: [] });
  });

  it('sets nothing when Jev is unsure when', async () => {
    const set: AlarmTime[] = [];

    const outcome = await setPhoneAlarmDirectly(
      'set an alarm for 7',
      SURE,
      classifierAnswering(
        halfPastSix({ alarmHour: { type: 'choice', choice: 'h7', probabilities: { h7: 0.55, h19: 0.45 } } }),
      ),
      async (time) => {
        set.push(time);
        return 'set';
      },
    );

    expect(outcome).toBeUndefined();
    expect(set).toEqual([]);
  });
});
