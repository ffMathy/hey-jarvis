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
  homeCommandDomainFrom,
  homeDomainQuestions,
  homeQuestionDomainFrom,
  runHomeCommand,
} from './home-commands.js';

/**
 * Smart home commands and questions about the house, answered without the Internet of Things agent.
 *
 * Their options are what Home Assistant has right now -- the kinds of device it holds, and the
 * services that act on them -- so the questions are built per request, from caches that never keep
 * routing waiting long, and asked on routing's own classifier call. Everything about reading the
 * answers and carrying the request out is in `home-commands.ts`; routing only knows this is a source
 * for this agent.
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
 * The questions about one request for what Home Assistant holds right now, and how their answers are
 * read: a command on a kind of device Jev is sure of and there is a service for, or a question about
 * how things are now on a kind of device it is sure of. Nothing to ask when Home Assistant listed no
 * kinds of device.
 */
export function homeDirectAnswers(services: HomeService[], domains: string[]): PreparedDirectAnswers | undefined {
  if (domains.length === 0) {
    return undefined;
  }

  return {
    questions: homeDomainQuestions(domains),
    choose: (answers, { requestKind, minimumConfidence }): DirectAnswer | undefined => {
      const homeDomain = choiceAnswerIn(answers, 'homeDomain');
      if (!homeDomain) {
        return undefined;
      }

      if (requestKind === 'command') {
        const homeCommandGivesSetting = booleanAnswerIn(answers, 'homeCommandGivesSetting');
        const domain =
          homeCommandGivesSetting &&
          homeCommandDomainFrom({ homeDomain, homeCommandGivesSetting }, domains, services, minimumConfidence);
        return domain
          ? {
              description: `home command on ${domain}`,
              answer: (request) => runHomeCommand(request, domain, services, minimumConfidence),
            }
          : undefined;
      }

      const homeQuestionIsAboutNow = booleanAnswerIn(answers, 'homeQuestionIsAboutNow');
      const domain =
        homeQuestionIsAboutNow &&
        homeQuestionDomainFrom({ homeDomain, homeQuestionIsAboutNow }, domains, minimumConfidence);
      return domain
        ? {
            description: `home question about ${domain}`,
            answer: (request) => answerHomeQuestion(request, domain, minimumConfidence),
          }
        : undefined;
    },
  };
}
