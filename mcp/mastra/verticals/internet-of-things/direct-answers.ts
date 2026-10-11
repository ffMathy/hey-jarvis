import { booleanAnswerIn, choiceAnswerIn } from '../../utils/classifier-answers.js';
import {
  createDirectAnswerSource,
  type DirectAnswer,
  type PreparedDirectAnswers,
} from '../../utils/direct-answer-source.js';
import {
  answerHomeQuestion,
  getHomeDomains,
  getHomeServices,
  type HomeService,
  homeQuestionDomainFrom,
  homeQuestionQuestions,
  homeServiceFrom,
  homeServiceQuestions,
  runHomeCommand,
} from './home-commands.js';

/**
 * Smart home commands and questions about the house, answered without the Internet of Things agent.
 *
 * Their options are what Home Assistant has right now -- its services, the kinds of device it holds
 * -- so the questions are built per request, from caches that never keep routing waiting long, and
 * asked on routing's own classifier call. Everything about reading the answers and carrying the
 * request out is in `home-commands.ts`; routing only knows this is a source for this agent.
 */
export const homeDirectAnswerSource = createDirectAnswerSource({
  id: 'internetOfThings.home',
  agentId: 'internetOfThings',
  prepare: async () => {
    const [services, domains] = await Promise.all([getHomeServices(), getHomeDomains()]);
    return homeDirectAnswers(services, domains);
  },
});

/**
 * The questions about one request for what Home Assistant offers right now, and how their answers
 * are read: a command whose service Jev is sure of, or a question about how things are now whose
 * kind of device it is sure of. Nothing to ask when Home Assistant offered nothing.
 */
export function homeDirectAnswers(services: HomeService[], domains: string[]): PreparedDirectAnswers | undefined {
  if (services.length === 0 && domains.length === 0) {
    return undefined;
  }

  return {
    questions: {
      ...(services.length > 0 && homeServiceQuestions(services)),
      ...(domains.length > 0 && homeQuestionQuestions(domains)),
    },
    choose: (answers, { requestKind, minimumConfidence }): DirectAnswer | undefined => {
      if (requestKind === 'command') {
        const homeService = choiceAnswerIn(answers, 'homeService');
        const homeCommandGivesSetting = booleanAnswerIn(answers, 'homeCommandGivesSetting');
        const service =
          homeService &&
          homeCommandGivesSetting &&
          homeServiceFrom({ homeService, homeCommandGivesSetting }, services, minimumConfidence);
        return service
          ? {
              description: `home command ${service.id}`,
              answer: (request) => runHomeCommand(request, service, minimumConfidence),
            }
          : undefined;
      }

      const homeQuestionDomain = choiceAnswerIn(answers, 'homeQuestionDomain');
      const homeQuestionIsAboutNow = booleanAnswerIn(answers, 'homeQuestionIsAboutNow');
      const domain =
        homeQuestionDomain &&
        homeQuestionIsAboutNow &&
        homeQuestionDomainFrom({ homeQuestionDomain, homeQuestionIsAboutNow }, domains, minimumConfidence);
      return domain
        ? {
            description: `home question about ${domain}`,
            answer: (request) => answerHomeQuestion(request, domain, minimumConfidence),
          }
        : undefined;
    },
  };
}
