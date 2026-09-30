import type { Classifier } from '@mastra/core/classifier';
import { confidentChoice } from '../../utils/classifier-answers.js';
import { createLazyClassifier } from '../../utils/classifier-factory.js';
import { logger } from '../../utils/logger.js';
import { createTtlCache } from '../../utils/ttl-cache.js';
import type { PlannedReport } from './change-reports.js';

/**
 * What kind of thing a Home Assistant report is about, and what that means for filing it.
 *
 * The event monitor files every significant state change and every event in the house for the
 * State Change Reactor. The noise baseline catches readings that only wobble, but not whole
 * entities nobody will ever care about: a Zigbee router's link quality, a phone's Wi-Fi BSSID, a
 * firmware update entity, an integration's internal event. And it treats a water leak exactly
 * like a lamp, filed low and rolled up with everything else.
 *
 * Which kind an entity is does not change from one report to the next, so it is asked once per
 * entity (or per event type) and kept: an evaluation model (Jev, see
 * `utils/providers/typesafe-provider.ts`) picks one of a fixed list of kinds in one short call,
 * from the entity's id, name, domain and device class. With a sure answer:
 *
 * - diagnostics are not reported, unless a synapse subscription could want them -- a user who
 *   asked to hear when the router drops is asking about diagnostics;
 * - safety and security are filed at high priority, so the reactor is woken at once;
 * - everything else is filed exactly as before.
 *
 * No key, an error, or an unsure answer all mean today's behaviour for that report.
 */

/** Registered on the Mastra instance under this key, so Studio shows its evaluations. */
export const CHANGE_RELEVANCE_CLASSIFIER_ID = 'changeRelevanceClassifier';

/**
 * How sure the classifier must be of a kind before a report is dropped or escalated.
 *
 * High because the answer is kept: a wrong "diagnostics" silences an entity until the cache
 * lets it go, while an unsure one only costs the reactor records it read before anyway.
 */
export const CHANGE_RELEVANCE_CONFIDENCE = 0.85;

/** How long an entity's kind is kept before it is asked again, in case it was renamed or relabelled. */
const RELEVANCE_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;

/** Enough for every entity and event type in a large house, with room to spare. */
const RELEVANCE_CACHE_MAX_ENTRIES = 5_000;

const CHANGE_RELEVANCE_CRITERIA = {
  safety_security:
    'Safety or security: alarms, smoke, gas or water leaks, locks, doors and windows, motion, doorbells, cameras',
  presence: 'Who is home or where they are: people, phones and trackers arriving or leaving, room occupancy',
  comfort_control:
    'Something people use or control: lights, climate, blinds, media players, switches, buttons, remotes, appliances',
  energy_telemetry: 'A measurement that keeps changing: power, energy, temperature, humidity, air quality, weather',
  diagnostics:
    'How the equipment is doing rather than the house: signal strength, link quality, battery voltage, firmware, ' +
    'uptime, connectivity, IP addresses, or an integration talking to itself',
};

export type ChangeRelevance = keyof typeof CHANGE_RELEVANCE_CRITERIA;

export function changeRelevanceQuestions() {
  return {
    relevance: {
      type: 'choice' as const,
      instructions:
        'This is an entity or event type in a smart home, whose changes are reported to its voice assistant. ' +
        'What kind of thing is it?',
      criteria: CHANGE_RELEVANCE_CRITERIA,
    },
  };
}

/** What Home Assistant says about an entity beyond its id, from its state attributes. */
export interface EntityDetails {
  friendlyName?: string;
  deviceClass?: string;
}

/** What one report is about: the key its kind is kept under, and how it is described to the classifier. */
export interface RelevanceSubject {
  key: string;
  description: string;
}

/**
 * What a report is about, or nothing when it does not say.
 *
 * An entity is described by its id, name, domain, device class and device; an event only by its
 * type, since the kind is kept per type and one type -- `zha_event`, say -- comes from many devices.
 */
export function relevanceSubjectOf(
  report: PlannedReport,
  entityDetails: ReadonlyMap<string, EntityDetails>,
): RelevanceSubject | undefined {
  const { entityId, deviceName, eventType } = report.stateData;

  if (report.stateType === 'device_state_change' && typeof entityId === 'string') {
    const details = entityDetails.get(entityId);
    const lines = [
      `Entity: ${entityId}`,
      `Name: ${details?.friendlyName ?? 'unknown'}`,
      `Domain: ${entityId.split('.')[0]}`,
      `Device class: ${details?.deviceClass ?? 'none'}`,
      ...(typeof deviceName === 'string' ? [`Device: ${deviceName}`] : []),
    ];
    return { key: `entity:${entityId}`, description: lines.join('\n') };
  }

  if (report.stateType === 'home_assistant_event' && typeof eventType === 'string') {
    return { key: `event:${eventType}`, description: `Home Assistant event type: ${eventType}` };
  }

  return undefined;
}

/** What to do with one report. */
export type ReportFiling = { file: false } | { file: true; priority: 'low' | 'high' };

/**
 * Reads a report's kind into what to do with it.
 *
 * Pure, so each way of filing as before is tested without a model. The kind is only ever a sure
 * one: an unsure answer arrives here as nothing.
 */
export function reportFilingFrom(
  relevance: ChangeRelevance | undefined,
  hasMatchingSubscription: boolean,
): ReportFiling {
  if (relevance === 'safety_security') {
    return { file: true, priority: 'high' };
  }

  if (relevance === 'diagnostics' && !hasMatchingSubscription) {
    return { file: false };
  }

  return { file: true, priority: 'low' };
}

/** A report that is going to be filed, and at what priority. */
export interface TriagedReport {
  report: PlannedReport;
  priority: 'low' | 'high';
}

/** What {@link triageReports} needs from outside, handed in so it is tested without a model or storage. */
export interface ReportTriageDependencies {
  /** The report's kind when the classifier is sure of it. */
  relevanceOf(subject: RelevanceSubject): Promise<ChangeRelevance | undefined>;
  /** Whether any synapse subscription could want this report. */
  hasMatchingSubscription(report: PlannedReport): Promise<boolean>;
}

/**
 * Sorts reports into the ones to file, at their priority, and the diagnostics nobody asked for.
 *
 * Subscriptions are only looked up for a sure diagnostics report, the one case they can change
 * the answer, and a lookup that fails counts as a match: dropping a report takes certainty.
 */
export async function triageReports(
  reports: PlannedReport[],
  entityDetails: ReadonlyMap<string, EntityDetails>,
  dependencies: ReportTriageDependencies,
): Promise<{ filed: TriagedReport[]; droppedAsDiagnostics: PlannedReport[] }> {
  const filed: TriagedReport[] = [];
  const droppedAsDiagnostics: PlannedReport[] = [];

  for (const report of reports) {
    const subject = relevanceSubjectOf(report, entityDetails);
    const relevance = subject ? await dependencies.relevanceOf(subject) : undefined;
    const hasMatchingSubscription =
      relevance === 'diagnostics' ? await dependencies.hasMatchingSubscription(report).catch(() => true) : false;
    const filing = reportFilingFrom(relevance, hasMatchingSubscription);

    if (filing.file) {
      filed.push({ report, priority: filing.priority });
    } else {
      droppedAsDiagnostics.push(report);
    }
  }

  return { filed, droppedAsDiagnostics };
}

/** Asks the classifier what kind of thing a subject is, and keeps the answer only when it is sure. */
export async function classifyRelevance(
  classifier: Classifier,
  subject: RelevanceSubject,
): Promise<ChangeRelevance | undefined> {
  const { answers } = await classifier.evaluate({
    state: subject.description,
    questions: changeRelevanceQuestions(),
  });
  return confidentChoice(answers.relevance, CHANGE_RELEVANCE_CONFIDENCE);
}

/**
 * A lookup of each subject's kind, asked once and then kept.
 *
 * An unsure answer is kept too -- asking again would get the same answer -- but a call that
 * failed is not, so the next report of that entity tries again. Without a classifier, every
 * subject is unknown, which is today's behaviour.
 */
export function createRelevanceLookup(
  classifier: Classifier | undefined,
): (subject: RelevanceSubject) => Promise<ChangeRelevance | undefined> {
  const cache = createTtlCache<ChangeRelevance | undefined>({
    ttlMs: RELEVANCE_CACHE_TTL_MS,
    maxEntries: RELEVANCE_CACHE_MAX_ENTRIES,
  });

  return async (subject) => {
    if (!classifier) {
      return undefined;
    }

    try {
      return await cache.get(subject.key, () => classifyRelevance(classifier, subject));
    } catch (error) {
      logger.warn('Change relevance classifier failed; reporting as before', {
        subject: subject.key,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  };
}

/**
 * The classifier reports are sorted by, or nothing when there is no key to run it with.
 *
 * One instance for the process, so the one registered on Mastra is the one reports go through.
 */
export const getChangeRelevanceClassifier = createLazyClassifier(CHANGE_RELEVANCE_CLASSIFIER_ID);
