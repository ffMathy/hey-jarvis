/**
 * What the Internet of Things vertical asks about a request routed to it, and every way it declines
 * to answer one without its agent. Declining is always safe -- the agent answers instead -- so most
 * of what is pinned here is that it declines whenever it is not sure.
 */

import { describe, expect, it } from 'bun:test';
import type { ClassifierAnswerSet } from '../../utils/classifier-answers.js';
import type { DirectAnswerChoiceContext } from '../../utils/direct-answer-source.js';
import { homeDirectAnswers } from './direct-answers.js';
import type { HomeService } from './home-commands.js';

const LIGHT_TURN_OFF: HomeService = {
  id: 'light.turn_off',
  domain: 'light',
  service: 'turn_off',
  description: 'Turn off lights',
  requiredFields: [],
  entityDomains: ['light'],
};

const COMMAND: DirectAnswerChoiceContext = { requestKind: 'command', minimumConfidence: 0.85 };
const QUESTION: DirectAnswerChoiceContext = { requestKind: 'question', minimumConfidence: 0.85 };

function sure(choice: string, confidence = 0.97) {
  return { type: 'choice' as const, choice, probabilities: { [choice]: confidence } };
}

function probably(probability: number) {
  return { type: 'boolean' as const, probability };
}

function choose(answers: ClassifierAnswerSet, context: DirectAnswerChoiceContext, domains = ['lock', 'light']) {
  return homeDirectAnswers([LIGHT_TURN_OFF], domains)?.choose(answers, context);
}

describe('homeDirectAnswers', () => {
  it('asks nothing when Home Assistant offered nothing', () => {
    expect(homeDirectAnswers([], [])).toBeUndefined();
  });

  it('asks only about what Home Assistant offered', () => {
    expect(Object.keys(homeDirectAnswers([LIGHT_TURN_OFF], [])?.questions ?? {})).toEqual([
      'homeService',
      'homeCommandGivesSetting',
    ]);
    expect(Object.keys(homeDirectAnswers([], ['lock'])?.questions ?? {})).toEqual([
      'homeQuestionDomain',
      'homeQuestionIsAboutNow',
    ]);
  });

  it('carries out a command whose service it is sure of', () => {
    const direct = choose({ homeService: sure('light.turn_off'), homeCommandGivesSetting: probably(0.02) }, COMMAND);

    expect(direct?.description).toBe('home command light.turn_off');
  });

  it('leaves a command that gives a setting, or an unsure service, to the agent', () => {
    expect(
      choose({ homeService: sure('light.turn_off'), homeCommandGivesSetting: probably(0.6) }, COMMAND),
    ).toBeUndefined();
    expect(
      choose({ homeService: sure('light.turn_off', 0.6), homeCommandGivesSetting: probably(0.02) }, COMMAND),
    ).toBeUndefined();
  });

  it('never picks a service for a question', () => {
    expect(
      choose({ homeService: sure('light.turn_off'), homeCommandGivesSetting: probably(0.02) }, QUESTION),
    ).toBeUndefined();
  });

  it('answers a question about how the house is now from the kind of device it is about', () => {
    const direct = choose({ homeQuestionDomain: sure('lock'), homeQuestionIsAboutNow: probably(0.97) }, QUESTION);

    expect(direct?.description).toBe('home question about lock');
  });

  it('leaves a question about history, or an unsure kind of device, to the agent', () => {
    expect(
      choose({ homeQuestionDomain: sure('lock'), homeQuestionIsAboutNow: probably(0.2) }, QUESTION),
    ).toBeUndefined();
    expect(
      choose({ homeQuestionDomain: sure('lock', 0.6), homeQuestionIsAboutNow: probably(0.97) }, QUESTION),
    ).toBeUndefined();
  });
});
