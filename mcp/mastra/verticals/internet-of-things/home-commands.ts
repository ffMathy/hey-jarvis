import { z } from 'zod';
import { createLazyClassifier } from '../../utils/index.js';
import { logger } from '../../utils/logger.js';
import { createTtlCache } from '../../utils/ttl-cache.js';
import { callHomeAssistantApi, type EntitySummary, listDomains, listEntities } from './tools.js';

/**
 * Smart home commands carried out without the Internet of Things agent.
 *
 * "Turn off the living room lights" is one Home Assistant service call, and the agent already
 * makes it in a single step (see `agent.ts`). But that step is still a language model reading its
 * instructions and writing a tool call, after routing has read the request once already. What the
 * call needs is two choices, and both are lists Home Assistant can hand over: which of its
 * services, and which of the entities that service acts on. Those are classifier questions, so Jev
 * answers them instead (see `.claude/rules/jev-classifiers.md`):
 *
 * 1. **Which service.** Every service Home Assistant offers that targets entities, with its own
 *    name and description, is put to Jev on the same call routing already makes for the request
 *    (see `routing/classifier.ts`), so choosing it costs no extra round trip.
 * 2. **Which entities.** Once routing is sure the request is a command for this vertical, every
 *    entity that service can act on is put to Jev -- one yes/no each, since a command usually
 *    means several ("the living room lights") -- with its name, area and current state.
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

/** The questions that choose a service, for routing's classifier to ask alongside its own. */
export function homeServiceQuestions(services: HomeService[]) {
  const serviceCriteria: Record<string, string> = {
    ...Object.fromEntries(services.map((service) => [service.id, service.description])),
    [OTHER_SERVICE]: 'None of these, more than one of them, or not a smart home command at all',
  };

  return {
    homeService: {
      type: 'choice' as const,
      instructions: 'If this is a smart home command, which Home Assistant service carries it out?',
      criteria: serviceCriteria,
    },
    homeCommandGivesSetting: {
      type: 'boolean' as const,
      instructions:
        'Does the command give a value or setting beyond which devices to act on -- a brightness, colour, warmth, ' +
        'temperature, volume, position, time, duration or source?',
    },
  };
}

/** How sure the classifier is of one choice. */
interface ChoiceAnswer {
  choice: string;
  probabilities?: Record<string, number>;
}

/**
 * Reads the classifier's answers into the service to call, or into nothing when the agent should.
 *
 * Pure, so every way of declining can be tested without a model or a house.
 */
export function homeServiceFrom(
  answers: { homeService: ChoiceAnswer; homeCommandGivesSetting: { probability: number } },
  services: HomeService[],
  minimumConfidence: number,
): HomeService | undefined {
  const { homeService, homeCommandGivesSetting } = answers;
  if ((homeService.probabilities?.[homeService.choice] ?? 0) < minimumConfidence) {
    return undefined;
  }
  if (homeCommandGivesSetting.probability > 1 - minimumConfidence) {
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
  answers: Record<string, { probability: number } | undefined>,
  entities: EntitySummary[],
  minimumConfidence: number,
): EntitySummary[] | undefined {
  const chosen: EntitySummary[] = [];

  for (const [index, entity] of entities.entries()) {
    const probability = answers[entityQuestionKey(index)]?.probability;
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

/** Everything one of the service's domains holds, or `undefined` when it is too many to ask about. */
async function candidateEntities(service: HomeService): Promise<EntitySummary[] | undefined> {
  const entities = (await Promise.all(service.entityDomains.map((domain) => listEntities(domain)))).flat();
  return entities.length > 0 && entities.length <= MAX_ENTITIES_ASKED ? entities : undefined;
}

/**
 * Carries a command out, and says what came of it in words the voice model can relay.
 *
 * Resolves to `undefined` when it declines -- no classifier, too many or no entities, or Jev not
 * sure which -- so the caller hands the request to the agent. Home Assistant answers a service call
 * with the states that changed. None changing is not an error, since they may already have been
 * that way, but it is not proof either, so the result says so rather than claiming success.
 *
 * @throws When listing the entities or the service call fails, so the caller can hand it on too
 */
export async function runHomeCommand(
  command: string,
  service: HomeService,
  minimumConfidence: number,
  classifier = getHomeCommandClassifier(),
): Promise<string | undefined> {
  if (!classifier) {
    return undefined;
  }

  const entities = await candidateEntities(service);
  if (!entities) {
    logger.info('Home command left to the agent: too many or no entities to ask about', { service: service.id });
    return undefined;
  }

  const { answers } = await classifier.evaluate({
    state: command,
    questions: entityQuestions(
      `The command "${command}" is carried out by ${service.description}. Should it act on`,
      entities,
    ),
    // A failed call hands the request to the agent, so retrying would only delay that.
    maxRetries: 0,
  });
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
  return changedCount > 0
    ? `Called ${service.description} on ${names}. ${changedCount} device${changedCount === 1 ? '' : 's'} changed state.`
    : `Called ${service.description} on ${names}, and nothing changed state: they may already have been that way.`;
}

/*
 * Questions about the house, answered the same way.
 *
 * "Is the front door locked?" needs no language model either. Which entities it is about is the
 * same per-entity yes/no a command asks, and their states are read straight from Home Assistant.
 * The answer is handed back as plain facts -- "Front door lock (Hallway): locked" -- and the voice
 * model, which phrases every result anyway, says it. Only questions about how things are right now
 * qualify: history, locations and anything Jev is unsure of are left to the agent, which has the
 * logbook and the location tools.
 */

/** The choice for a question about no single kind of device, or not about the house at all. */
const OTHER_DOMAIN = 'other';

/**
 * What the common domains hold, in words, so a question can be matched to one. A domain not listed
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
};

/** Domains whose entities cannot be asked about one by one, or are not about the house. */
const EXCLUDED_QUESTION_DOMAINS = new Set([
  'automation',
  'script',
  'scene',
  'zone',
  'update',
  'button',
  'input_button',
  'event',
  'conversation',
  'tts',
  'stt',
  'sun',
]);

const domainCache = createTtlCache<string[]>({ ttlMs: SERVICE_CACHE_TTL_MS, maxEntries: 1 });

/** Forgets the cached domains, for tests. */
export function resetHomeDomainsForTest(): void {
  domainCache.clear();
}

/**
 * The domains a question can be about, or an empty list when they cannot be had quickly.
 *
 * Never rejects, for the same reason as {@link getHomeServices}.
 */
export async function getHomeDomains(): Promise<string[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<string[]>((resolve) => {
    timer = setTimeout(() => resolve([]), SERVICE_LOOKUP_TIMEOUT_MS);
  });

  const loaded = domainCache
    .get('domains', async () => (await listDomains()).filter((domain) => !EXCLUDED_QUESTION_DOMAINS.has(domain)))
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

/** The questions that choose which kind of device a question is about, for routing's classifier. */
export function homeQuestionQuestions(domains: string[]) {
  const domainCriteria: Record<string, string> = {
    ...Object.fromEntries(domains.map((domain) => [domain, DOMAIN_DESCRIPTIONS[domain] ?? domain])),
    [OTHER_DOMAIN]: 'More than one of these, none of them, or not a question about the house',
  };

  return {
    homeQuestionDomain: {
      type: 'choice' as const,
      instructions: 'If this is a question about the house, which kind of device is it about?',
      criteria: domainCriteria,
    },
    homeQuestionIsAboutNow: {
      type: 'boolean' as const,
      instructions:
        'Does the question only ask how things are right now -- not what happened earlier, when something last ' +
        'changed, where someone or something is, or what to do about it?',
    },
  };
}

/**
 * Reads the classifier's answers into the domain a question is about, or nothing when the agent
 * should answer it. Pure, so it can be tested without a model or a house.
 */
export function homeQuestionDomainFrom(
  answers: { homeQuestionDomain: ChoiceAnswer; homeQuestionIsAboutNow: { probability: number } },
  domains: string[],
  minimumConfidence: number,
): string | undefined {
  const { homeQuestionDomain, homeQuestionIsAboutNow } = answers;
  if ((homeQuestionDomain.probabilities?.[homeQuestionDomain.choice] ?? 0) < minimumConfidence) {
    return undefined;
  }
  if (homeQuestionIsAboutNow.probability < minimumConfidence) {
    return undefined;
  }
  return domains.includes(homeQuestionDomain.choice) ? homeQuestionDomain.choice : undefined;
}

/** The facts a question is answered with, one entity per line, for the voice model to phrase. */
export function describeEntities(entities: EntitySummary[]): string {
  return entities
    .map((entity) => `${entity.name}${entity.area ? ` (${entity.area})` : ''}: ${describeState(entity)}`)
    .join('\n');
}

/**
 * Answers a question about the house from Home Assistant's own states, without the agent.
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
): Promise<string | undefined> {
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
  return describeEntities(chosen);
}
