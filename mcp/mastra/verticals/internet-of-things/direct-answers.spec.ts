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
  it('asks nothing when Home Assistant listed no kinds of device', () => {
    expect(homeDirectAnswers([LIGHT_TURN_OFF], [])).toBeUndefined();
  });

  it('asks which kind of device, for commands and questions alike, rather than which service', () => {
    // The services are hundreds and the kinds of device a few dozen, so the routing call asks about
    // the kinds, and only a command's own call is offered the services of the kind it chose.
    expect(Object.keys(homeDirectAnswers([LIGHT_TURN_OFF], ['light'])?.questions ?? {})).toEqual([
      'homeDomain',
      'homeCommandGivesSetting',
      'homeQuestionIsAboutNow',
    ]);
  });

  it('carries out a command on a kind of device it is sure of', () => {
    const direct = choose({ homeDomain: sure('light'), homeCommandGivesSetting: probably(0.02) }, COMMAND);

    expect(direct?.description).toBe('home command on light');
  });

  it('leaves a command that gives a setting, an unsure kind of device, or one with no service, to the agent', () => {
    expect(choose({ homeDomain: sure('light'), homeCommandGivesSetting: probably(0.6) }, COMMAND)).toBeUndefined();
    expect(
      choose({ homeDomain: sure('light', 0.6), homeCommandGivesSetting: probably(0.02) }, COMMAND),
    ).toBeUndefined();
    expect(choose({ homeDomain: sure('lock'), homeCommandGivesSetting: probably(0.02) }, COMMAND)).toBeUndefined();
  });

  it('answers a question about how the house is now from the kind of device it is about', () => {
    const direct = choose({ homeDomain: sure('lock'), homeQuestionIsAboutNow: probably(0.97) }, QUESTION);

    expect(direct?.description).toBe('home question about lock');
  });

  it('leaves a question about history, or an unsure kind of device, to the agent', () => {
    expect(choose({ homeDomain: sure('lock'), homeQuestionIsAboutNow: probably(0.2) }, QUESTION)).toBeUndefined();
    expect(
      choose({ homeDomain: sure('lock', 0.6), homeQuestionIsAboutNow: probably(0.97) }, QUESTION),
    ).toBeUndefined();
  });
});
