import { z } from 'zod';
import { cleanAffectedEntities } from '../../utils/affected-entities.js';
import { booleanAnswerIn, type ClassifierAnswerSet, choiceAnswerIn } from '../../utils/classifier-answers.js';
import type { DirectAnswerOutcome } from '../../utils/direct-lookup-factory.js';
import { createLazyClassifier } from '../../utils/index.js';
import { logger } from '../../utils/logger.js';
import { createTtlCache } from '../../utils/ttl-cache.js';
import {
  callHomeAssistantApi,
  type EntitySummary,
  entitiesALookupAffects,
  listDomains,
  listEntities,
} from './tools.js';

/**
 * Smart home commands carried out without the Internet of Things agent.
 *
 * "Turn off the living room lights" is one Home Assistant service call, and the agent already
 * makes it in a single step (see `agent.ts`). But that step is still a language model reading its
 * instructions and writing a tool call, after routing has read the request once already. What the
 * call needs is two choices, and both are lists Home Assistant can hand over: which of its
 * services, and which of the entities that service acts on. Those are classifier questions, so Jev
 * answers them instead (see `.claude/rules/jev-classifiers.md`), device first:
 *
 * 1. **Which kind of device.** The domains Home Assistant holds -- lights, switches, covers -- are
 *    put to Jev on the same call routing already makes for the request (see `routing/classifier.ts`),
 *    so choosing one costs no extra round trip.
 * 2. **Which service, and which entities.** Once routing is sure the request is a command for this
 *    vertical, one more call asks both: which of the services that act on that kind of device carries
 *    it out, including the generic ones the kind has no service of its own for (see
 *    {@link servicesFor}), and, one yes/no each, which of its entities -- with name, area and current
 *    state -- since a command usually means several ("the living room lights").
 *
 * Nothing here writes a value. So a service with a required field (a temperature, a colour), or a
 * request that gives a setting of any kind, is left to the agent, and so is anything Jev is not
 * sure of: a service, an entity it cannot call either way, or no entity at all. Jev only ever picks
 * from what Home Assistant listed, so it cannot call a service or touch an entity that does not
 * exist.
 */

/** Domains whose services are about Home Assistant itself rather than the home. */
const EXCLUDED_DOMAINS = new Set(['update', 'hassio', 'frontend', 'logger', 'system_log', 'recorder', 'backup']);

/** The choice for a request that is not one of the listed services as it stands. */
const OTHER_SERVICE = 'other';

/**
 * The most entities put to Jev for one command.
 *
 * Each is a question on the call, and a service whose targets run to more than this is one the
 * agent should narrow down with a search rather than one to ask about entity by entity.
 */
const MAX_ENTITIES_ASKED = 150;

/** How long the list of services is reused. They change when an integration is added. */
const SERVICE_CACHE_TTL_MS = 10 * 60_000;

/**
 * The longest a request waits for the services when none are cached yet.
 *
 * The list only saves time, so a request that would wait long for it goes to the agent instead,
 * which is what it did before any of this existed.
 */
const SERVICE_LOOKUP_TIMEOUT_MS = 2_000;

/** A service Home Assistant offers, as the classifier is told about it. */
export interface HomeService {
  /** `domain.service`, as it is called. */
  id: string;
  domain: string;
  service: string;
  /** Its name and description, as Home Assistant gives them. */
  description: string;
  /** Fields a call must set. Such a service needs a value nothing here can write. */
  requiredFields: string[];
  /** The domains of the entities it acts on. */
  entityDomains: string[];
}

const targetEntitySchema = z.object({ domain: z.union([z.string(), z.array(z.string())]).optional() }).loose();

const servicesResponseSchema = z.array(
  z.object({
    domain: z.string(),
    services: z.record(
      z.string(),
      z
        .object({
          name: z.string().optional(),
          description: z.string().optional(),
          fields: z.record(z.string(), z.object({ required: z.boolean().optional() }).loose()).optional(),
          target: z
            .object({ entity: z.union([targetEntitySchema, z.array(targetEntitySchema)]).optional() })
            .loose()
            .optional(),
        })
        .loose(),
    ),
  }),
);

/**
 * The services a command can call: those that act on entities, from domains about the home.
 *
 * A service with no `target` acts on nothing in particular (reloading an integration, sending a
 * notification), so it has no entities to choose between and is not a command in this sense.
 */
export function homeServicesFrom(response: unknown): HomeService[] {
  return servicesResponseSchema
    .parse(response)
    .filter(({ domain }) => !EXCLUDED_DOMAINS.has(domain))
    .flatMap(({ domain, services }) =>
      Object.entries(services).flatMap(([service, definition]) =>
        definition.target ? [describeService(domain, service, definition)] : [],
      ),
    );
}

type ServiceDefinition = z.infer<typeof servicesResponseSchema>[number]['services'][string];

/** The domains of the entities a service's target accepts, or `undefined` when it names none. */
function targetDomainsOf(target: ServiceDefinition['target']): string[] | undefined {
  const entities = target?.entity;
  const domains = (Array.isArray(entities) ? entities : entities ? [entities] : []).flatMap((entity) =>
    entity.domain === undefined ? [] : [entity.domain].flat(),
  );
  return domains.length > 0 ? [...new Set(domains)] : undefined;
}

function describeService(domain: string, service: string, definition: ServiceDefinition): HomeService {
  const id = `${domain}.${service}`;
  return {
    id,
    domain,
    service,
    description: [definition.name, definition.description].filter(Boolean).join(': ') || id,
    requiredFields: Object.entries(definition.fields ?? {})
      .filter(([, field]) => field.required === true)
      .map(([name]) => name),
    entityDomains: targetDomainsOf(definition.target) ?? [domain],
  };
}

const serviceCache = createTtlCache<HomeService[]>({ ttlMs: SERVICE_CACHE_TTL_MS, maxEntries: 1 });

/** Forgets the cached services, for tests. */
export function resetHomeServicesForTest(): void {
  serviceCache.clear();
}

/**
 * The services a command can call, or an empty list when they cannot be had quickly.
 *
 * Never rejects: without the list, routing simply does not ask which service, and the agent does
 * what it always did.
 */
export async function getHomeServices(): Promise<HomeService[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<HomeService[]>((resolve) => {
    timer = setTimeout(() => resolve([]), SERVICE_LOOKUP_TIMEOUT_MS);
  });

  const loaded = serviceCache
    .get('services', async () => homeServicesFrom(await callHomeAssistantApi('services')))
    .catch((error: unknown) => {
      logger.warn('Could not list the Home Assistant services', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    });

  try {
    return await Promise.race([loaded, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

/** The domain whose services act on an entity of any kind: generic turn on, turn off and toggle. */
const GENERIC_DOMAIN = 'homeassistant';

/**
 * The services a command on one kind of device can call: the kind's own, and the generic ones it
 * has no service of the same name for.
 *
 * Offering both `light.turn_on` and `homeassistant.turn_on` for a light would have Jev split its
 * confidence between two services that do the same thing, and decline. So a generic service stands
 * in only where the kind has none of its own -- turning on a group, which has no `group.turn_on`.
 */
export function servicesFor(domain: string, services: HomeService[]): HomeService[] {
  const own = services.filter(
    (service) => service.domain !== GENERIC_DOMAIN && service.entityDomains.includes(domain),
  );
  const ownNames = new Set(own.map((service) => service.service));
  const generic = services.filter(
    (service) => service.domain === GENERIC_DOMAIN && !ownNames.has(service.service),
  );
  return [...own, ...generic];
}

/** The question that chooses a service, from those a command on one kind of device can call. */
export function homeServiceQuestion(services: HomeService[]) {
  const serviceCriteria: Record<string, string> = {
    ...Object.fromEntries(services.map((service) => [service.id, service.description])),
    [OTHER_SERVICE]: 'None of these, more than one of them, or not a smart home command at all',
  };

  return {
    homeService: {
      type: 'choice' as const,
      instructions: 'Which Home Assistant service carries this smart home command out?',
      criteria: serviceCriteria,
    },
  };
}

/** How sure the classifier is of one choice. */
interface ChoiceAnswer {
  choice: string;
  probabilities?: Record<string, number>;
}

/**
 * Reads the classifier's answer into the service to call, or into nothing when the agent should.
 *
 * Pure, so every way of declining can be tested without a model or a house.
 */
export function homeServiceFrom(
  homeService: ChoiceAnswer | undefined,
  services: HomeService[],
  minimumConfidence: number,
): HomeService | undefined {
  if (!homeService || (homeService.probabilities?.[homeService.choice] ?? 0) < minimumConfidence) {
    return undefined;
  }

  const service = services.find((candidate) => candidate.id === homeService.choice);
  return service && service.requiredFields.length === 0 ? service : undefined;
}

/** The question key an entity is asked under. Keys are kept free of the dots entity ids carry. */
function entityQuestionKey(index: number): string {
  return `entity${index}`;
}

/**
 * One yes/no per entity, each asked as `lead` followed by the entity -- "Should it act on", "Is it
 * about" -- with its name, area and current state.
 */
export function entityQuestions(lead: string, entities: EntitySummary[]) {
  return Object.fromEntries(
    entities.map((entity, index) => [
      entityQuestionKey(index),
      {
        type: 'boolean' as const,
        instructions: `${lead} ${entity.name} (${entity.id}), in ${entity.area ?? 'no area'}, which is currently ${describeState(entity)}?`,
      },
    ]),
  );
}

/** An entity's state as it would be said: "21.5 °C", "on". */
function describeState(entity: EntitySummary): string {
  return entity.unit ? `${entity.state} ${entity.unit}` : entity.state;
}

/**
 * Reads the classifier's answers into the entities to act on, or into nothing when the agent should.
 *
 * Every entity has to be settled one way or the other: a single one it is unsure of means the
 * command might be carried out on the wrong set, and the agent can look closer.
 */
export function entitiesFrom(
  answers: ClassifierAnswerSet,
  entities: EntitySummary[],
  minimumConfidence: number,
): EntitySummary[] | undefined {
  const chosen: EntitySummary[] = [];

  for (const [index, entity] of entities.entries()) {
    const probability = booleanAnswerIn(answers, entityQuestionKey(index))?.probability;
    if (probability === undefined) {
      return undefined;
    }
    if (probability >= minimumConfidence) {
      chosen.push(entity);
    } else if (probability > 1 - minimumConfidence) {
      return undefined;
    }
  }

  return chosen.length > 0 ? chosen : undefined;
}

/**
 * The classifier that chooses which entities a command acts on or a question asks about, or nothing
 * when there is no key.
 */
export const getHomeCommandClassifier = createLazyClassifier('homeCommandClassifier');

/** Everything of one kind of device, or `undefined` when it is too many or none to ask about. */
async function candidateEntities(domain: string): Promise<EntitySummary[] | undefined> {
  const entities = await listEntities(domain);
  return entities.length > 0 && entities.length <= MAX_ENTITIES_ASKED ? entities : undefined;
}

/**
 * Carries out a command on one kind of device, and says what came of it in words the voice model can
 * relay, and which entities it acted on.
 *
 * Which of that kind's services to call and which of its entities to call it on are asked of Jev
 * together, in one call: the service as a choice from {@link servicesFor}, the entities as one
 * yes/no each.
 *
 * The entities are the ones the service was called on, each with its name, for sir's headset to
 * light up. Reported here because no agent ran: `callIoTService` reports the same thing when the
 * agent makes the call (see `utils/affected-entities.ts`), and a command taking this path must
 * light up just as one taking that path would.
 *
 * Resolves to `undefined` when it declines -- no classifier, no service to offer, too many or no
 * entities, or Jev not sure which service or which entities -- so the caller hands the request to the
 * agent. Home Assistant answers a service call with the states that changed. None changing is not an
 * error, since they may already have been that way, but it is not proof either, so the result says so
 * rather than claiming success.
 *
 * @throws When listing the entities or the service call fails, so the caller can hand it on too
 */
export async function runHomeCommand(
  command: string,
  domain: string,
  services: HomeService[],
  minimumConfidence: number,
  classifier = getHomeCommandClassifier(),
): Promise<DirectAnswerOutcome | undefined> {
  const offered = servicesFor(domain, services);
  if (!classifier || offered.length === 0) {
    return undefined;
  }

  const entities = await candidateEntities(domain);
  if (!entities) {
    logger.info('Home command left to the agent: too many or no entities to ask about', { domain });
    return undefined;
  }

  const { answers } = await classifier.evaluate({
    state: command,
    questions: {
      ...homeServiceQuestion(offered),
      ...entityQuestions(`Should the command "${command}" act on`, entities),
    },
    // A failed call hands the request to the agent, so retrying would only delay that.
    maxRetries: 0,
  });
  const service = homeServiceFrom(choiceAnswerIn(answers, 'homeService'), offered, minimumConfidence);
  if (!service) {
    logger.info('Home command left to the agent: unsure which service', { domain });
    return undefined;
  }
  const chosen = entitiesFrom(answers, entities, minimumConfidence);
  if (!chosen) {
    logger.info('Home command left to the agent: unsure which entities', { service: service.id });
    return undefined;
  }

  const entityIds = chosen.map((entity) => entity.id);
  const calledAt = Date.now();
  const changed = await callHomeAssistantApi(`services/${service.domain}/${service.service}`, 'POST', {
    entity_id: entityIds,
  });
  const changedCount = Array.isArray(changed) ? changed.length : 0;
  logger.info('Carried out a home command without the agent', {
    service: service.id,
    entityIds,
    changedCount,
    durationMs: Date.now() - calledAt,
  });

  const names = chosen.map((entity) => entity.name).join(', ');
  return {
    text:
      changedCount > 0
        ? `Called ${service.description} on ${names}. ${changedCount} device${changedCount === 1 ? '' : 's'} changed state.`
        : `Called ${service.description} on ${names}, and nothing changed state: they may already have been that way.`,
    entities: cleanAffectedEntities(chosen.map(({ id, name }) => ({ id, name }))),
  };
}

/*
 * Which kind of device a request is about.
 *
 * Asked on routing's own call, for commands and questions alike, since both start there: "turn on
 * the living room light" and "is the living room light on" are both about lights. A command then
 * asks which service and which lights on one more call (see {@link runHomeCommand}); a question asks
 * only which lights, and reads their states (see {@link answerHomeQuestion}).
 *
 * The kinds are few -- a few dozen, where the services are hundreds -- so the routing call stays
 * short, and the services put to Jev are only those that act on the kind it chose.
 */

/** The choice for a request about no single kind of device, or not about the house at all. */
const OTHER_DOMAIN = 'other';

/**
 * What the common domains hold, in words, so a request can be matched to one. A domain not listed
 * is offered under its own name, which is usually plain enough ("vacuum", "camera").
 */
const DOMAIN_DESCRIPTIONS: Record<string, string> = {
  light: 'Lights',
  switch: 'Switches and smart plugs',
  lock: 'Door locks',
  cover: 'Blinds, curtains, shutters and garage doors',
  climate: 'Thermostats, heating and air conditioning',
  fan: 'Fans',
  media_player: 'Speakers, TVs and what is playing on them',
  sensor: 'Measurements: temperature, humidity, power, energy, battery levels and the like',
  binary_sensor: 'Things that are on or off: doors and windows open or closed, motion, leaks, smoke',
  person: 'Whether each person in the household is home',
  alarm_control_panel: 'The alarm system',
  vacuum: 'Robot vacuums',
  weather: 'The weather station',
  scene: 'Scenes, which set several devices at once',
  script: 'Scripts, which run a sequence of actions',
  automation: 'Automations, which run on their own when something happens',
  group: 'Groups of devices controlled together',
  input_boolean: 'Helper toggles',
};

/** Domains that are not about the house at all. */
const EXCLUDED_REQUEST_DOMAINS = new Set(['zone', 'update', 'event', 'conversation', 'tts', 'stt', 'sun']);

/** Domains a command can act on but a question cannot ask about one by one: they have no state worth reading. */
const EXCLUDED_QUESTION_DOMAINS = new Set(['automation', 'script', 'scene', 'button', 'input_button']);

const domainCache = createTtlCache<string[]>({ ttlMs: SERVICE_CACHE_TTL_MS, maxEntries: 1 });

/** Forgets the cached domains, for tests. */
export function resetHomeDomainsForTest(): void {
  domainCache.clear();
}

/**
 * The domains a request can be about, or an empty list when they cannot be had quickly.
 *
 * Never rejects, for the same reason as {@link getHomeServices}.
 */
export async function getHomeDomains(): Promise<string[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<string[]>((resolve) => {
    timer = setTimeout(() => resolve([]), SERVICE_LOOKUP_TIMEOUT_MS);
  });

  const loaded = domainCache
    .get('domains', async () => (await listDomains()).filter((domain) => !EXCLUDED_REQUEST_DOMAINS.has(domain)))
    .catch((error: unknown) => {
      logger.warn('Could not list the Home Assistant domains', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    });

  try {
    return await Promise.race([loaded, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

/** The questions routing's classifier asks about a request to the house, alongside its own. */
export function homeDomainQuestions(domains: string[]) {
  const domainCriteria: Record<string, string> = {
    ...Object.fromEntries(domains.map((domain) => [domain, DOMAIN_DESCRIPTIONS[domain] ?? domain])),
    [OTHER_DOMAIN]: 'More than one of these, none of them, or not about the house',
  };

  return {
    homeDomain: {
      type: 'choice' as const,
      instructions: 'If this is a smart home command or a question about the house, which kind of device is it about?',
      criteria: domainCriteria,
    },
    homeCommandGivesSetting: {
      type: 'boolean' as const,
      instructions:
        'Does the command give a value or setting beyond which devices to act on -- a brightness, colour, warmth, ' +
        'temperature, volume, position, time, duration or source?',
    },
    homeQuestionIsAboutNow: {
      type: 'boolean' as const,
      instructions:
        'Does the question only ask how things are right now -- not what happened earlier, when something last ' +
        'changed, where someone or something is, or what to do about it?',
    },
  };
}

/** The kind of device Jev is sure a request is about, when it is one Home Assistant has. */
function homeDomainFrom(homeDomain: ChoiceAnswer, domains: string[], minimumConfidence: number): string | undefined {
  if ((homeDomain.probabilities?.[homeDomain.choice] ?? 0) < minimumConfidence) {
    return undefined;
  }
  return domains.includes(homeDomain.choice) ? homeDomain.choice : undefined;
}

/**
 * Reads the classifier's answers into the kind of device a command acts on, or nothing when the agent
 * should carry it out: Jev is unsure, the command gives a setting nothing here can write, or there is
 * no service to call on that kind. Pure, so it can be tested without a model or a house.
 */
export function homeCommandDomainFrom(
  answers: { homeDomain: ChoiceAnswer; homeCommandGivesSetting: { probability: number } },
  domains: string[],
  services: HomeService[],
  minimumConfidence: number,
): string | undefined {
  if (answers.homeCommandGivesSetting.probability > 1 - minimumConfidence) {
    return undefined;
  }
  const domain = homeDomainFrom(answers.homeDomain, domains, minimumConfidence);
  return domain && servicesFor(domain, services).length > 0 ? domain : undefined;
}

/**
 * Reads the classifier's answers into the domain a question is about, or nothing when the agent
 * should answer it. Pure, so it can be tested without a model or a house.
 */
export function homeQuestionDomainFrom(
  answers: { homeDomain: ChoiceAnswer; homeQuestionIsAboutNow: { probability: number } },
  domains: string[],
  minimumConfidence: number,
): string | undefined {
  if (answers.homeQuestionIsAboutNow.probability < minimumConfidence) {
    return undefined;
  }
  const domain = homeDomainFrom(answers.homeDomain, domains, minimumConfidence);
  return domain && !EXCLUDED_QUESTION_DOMAINS.has(domain) ? domain : undefined;
}

/** The facts a question is answered with, one entity per line, for the voice model to phrase. */
export function describeEntities(entities: EntitySummary[]): string {
  return entities
    .map((entity) => `${entity.name}${entity.area ? ` (${entity.area})` : ''}: ${describeState(entity)}`)
    .join('\n');
}

/**
 * Answers a question about the house from Home Assistant's own states, without the agent, and says
 * which entities it read.
 *
 * Those are the entities the question is about, reported as the agent's `findEntities` would have
 * reported what it found -- none at all for a question about more than a handful, which is a survey
 * (see {@link entitiesALookupAffects}). "What lights are on in the kitchen" lights the kitchen
 * lights up on sir's headset; "are any lights on" lights up nothing.
 *
 * Resolves to `undefined` when it declines -- no classifier, too many or no entities, or Jev not
 * sure which the question is about -- so the caller hands the request to the agent.
 *
 * @throws When listing the entities fails, so the caller can hand it on too
 */
export async function answerHomeQuestion(
  question: string,
  domain: string,
  minimumConfidence: number,
  classifier = getHomeCommandClassifier(),
): Promise<DirectAnswerOutcome | undefined> {
  if (!classifier) {
    return undefined;
  }

  const entities = await listEntities(domain);
  if (entities.length === 0 || entities.length > MAX_ENTITIES_ASKED) {
    logger.info('Home question left to the agent: too many or no entities to ask about', { domain });
    return undefined;
  }

  const { answers } = await classifier.evaluate({
    state: question,
    questions: entityQuestions(`The question "${question}" is about the house. Is it about`, entities),
    maxRetries: 0,
  });
  const chosen = entitiesFrom(answers, entities, minimumConfidence);
  if (!chosen) {
    logger.info('Home question left to the agent: unsure which entities', { domain });
    return undefined;
  }

  logger.info('Answered a home question without the agent', { domain, entityIds: chosen.map((entity) => entity.id) });
  return { text: describeEntities(chosen), entities: cleanAffectedEntities(entitiesALookupAffects(chosen)) };
}
