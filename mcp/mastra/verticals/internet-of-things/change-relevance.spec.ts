/**
 * Sorting Home Assistant reports by what kind of thing they are about.
 *
 * Dropping a report is the decision that can lose something, so what is pinned is mostly that a
 * report is filed as before unless the classifier is sure it is diagnostics and no subscription
 * could want it -- and that each entity is only asked about once.
 */

import { describe, expect, it } from 'bun:test';
import { Classifier } from '@mastra/core/classifier';
import {
  type ChangeRelevance,
  changeRelevanceQuestions,
  classifyRelevance,
  createRelevanceLookup,
  type EntityDetails,
  type RelevanceSubject,
  relevanceSubjectOf,
  reportFilingFrom,
  triageReports,
} from './change-relevance.js';
import type { PlannedReport } from './change-reports.js';

const leakReport: PlannedReport = {
  stateType: 'device_state_change',
  stateData: { entityId: 'binary_sensor.kitchen_leak', deviceName: 'Kitchen Leak Sensor', newState: 'on' },
};
const linkQualityReport: PlannedReport = {
  stateType: 'device_state_change',
  stateData: { entityId: 'sensor.router_linkquality', deviceName: 'Router', newState: '80' },
};
const buttonEvent: PlannedReport = {
  stateType: 'home_assistant_event',
  stateData: { eventType: 'zha_event', deviceName: 'Hallway Button' },
};

const ENTITY_DETAILS = new Map<string, EntityDetails>([
  ['binary_sensor.kitchen_leak', { friendlyName: 'Kitchen leak', deviceClass: 'moisture' }],
]);

/** A choice answer as a fake model returns it: a complete distribution that sums to one. */
function choiceAnswer(choice: ChangeRelevance, confidence: number) {
  const kinds = Object.keys(changeRelevanceQuestions().relevance.criteria);
  const rest = (1 - confidence) / (kinds.length - 1);
  return {
    type: 'choice' as const,
    choice,
    probabilities: Object.fromEntries(kinds.map((kind) => [kind, kind === choice ? confidence : rest])),
  };
}

function fakeClassifier(respond: (state: unknown) => ChangeRelevance | Error, confidence = 0.95) {
  const evaluatedStates: unknown[] = [];
  const classifier = new Classifier({
    id: 'changeRelevanceClassifier',
    model: {
      specificationVersion: 'v4',
      provider: 'fake',
      modelId: 'jev-fake',
      supportedQuestionTypes: ['choice'],
      doEvaluate: async ({ state }) => {
        evaluatedStates.push(state);
        const response = respond(state);
        if (response instanceof Error) {
          throw response;
        }
        return { answers: { relevance: choiceAnswer(response, confidence) }, warnings: [] };
      },
    },
  });
  return { classifier, evaluatedStates };
}

describe('relevanceSubjectOf', () => {
  it('describes an entity by its id, name, domain, device class and device', () => {
    expect(relevanceSubjectOf(leakReport, ENTITY_DETAILS)).toEqual({
      key: 'entity:binary_sensor.kitchen_leak',
      description:
        'Entity: binary_sensor.kitchen_leak\nName: Kitchen leak\nDomain: binary_sensor\n' +
        'Device class: moisture\nDevice: Kitchen Leak Sensor',
    });
  });

  it('says so when it knows nothing about an entity beyond its id', () => {
    expect(relevanceSubjectOf(linkQualityReport, new Map())?.description).toContain(
      'Name: unknown\nDomain: sensor\nDevice class: none',
    );
  });

  it('describes an event by its type alone, which is what its kind is kept under', () => {
    expect(relevanceSubjectOf(buttonEvent, new Map())).toEqual({
      key: 'event:zha_event',
      description: 'Home Assistant event type: zha_event',
    });
  });

  it('has nothing to say about a report that names neither', () => {
    expect(relevanceSubjectOf({ stateType: 'device_state_change', stateData: {} }, new Map())).toBeUndefined();
  });
});

describe('reportFilingFrom', () => {
  it('files safety and security at high priority', () => {
    expect(reportFilingFrom('safety_security', false)).toEqual({ file: true, priority: 'high' });
  });

  it('drops diagnostics nobody subscribed to', () => {
    expect(reportFilingFrom('diagnostics', false)).toEqual({ file: false });
  });

  it('files diagnostics a subscription could want', () => {
    expect(reportFilingFrom('diagnostics', true)).toEqual({ file: true, priority: 'low' });
  });

  it('files everything else, and anything unknown, as before', () => {
    for (const relevance of ['presence', 'comfort_control', 'energy_telemetry', undefined] as const) {
      expect(reportFilingFrom(relevance, false)).toEqual({ file: true, priority: 'low' });
    }
  });
});

describe('triageReports', () => {
  const kinds: Record<string, ChangeRelevance> = {
    'entity:binary_sensor.kitchen_leak': 'safety_security',
    'entity:sensor.router_linkquality': 'diagnostics',
    'event:zha_event': 'comfort_control',
  };
  const relevanceOf = async (subject: RelevanceSubject) => kinds[subject.key];

  it('escalates, drops and files each report by its kind', async () => {
    const result = await triageReports([leakReport, linkQualityReport, buttonEvent], ENTITY_DETAILS, {
      relevanceOf,
      hasMatchingSubscription: async () => false,
    });

    expect(result).toEqual({
      filed: [
        { report: leakReport, priority: 'high' },
        { report: buttonEvent, priority: 'low' },
      ],
      droppedAsDiagnostics: [linkQualityReport],
    });
  });

  it('only looks for subscriptions for diagnostics, and keeps the ones that match', async () => {
    const lookedUp: PlannedReport[] = [];

    const result = await triageReports([leakReport, linkQualityReport], ENTITY_DETAILS, {
      relevanceOf,
      hasMatchingSubscription: async (report) => {
        lookedUp.push(report);
        return true;
      },
    });

    expect(lookedUp).toEqual([linkQualityReport]);
    expect(result.droppedAsDiagnostics).toEqual([]);
  });

  it('keeps diagnostics when the subscription lookup fails', async () => {
    const result = await triageReports([linkQualityReport], ENTITY_DETAILS, {
      relevanceOf,
      hasMatchingSubscription: async () => {
        throw new Error('storage is down');
      },
    });

    expect(result.filed).toEqual([{ report: linkQualityReport, priority: 'low' }]);
  });
});

describe('classifyRelevance', () => {
  it('asks about the subject and keeps a sure answer', async () => {
    const { classifier, evaluatedStates } = fakeClassifier(() => 'safety_security');
    const subject = { key: 'entity:lock.front', description: 'Entity: lock.front' };

    expect(await classifyRelevance(classifier, subject)).toBe('safety_security');
    expect(evaluatedStates).toEqual(['Entity: lock.front']);
  });

  it('discards an unsure answer', async () => {
    const { classifier } = fakeClassifier(() => 'diagnostics', 0.6);

    expect(await classifyRelevance(classifier, { key: 'entity:sensor.x', description: 'x' })).toBeUndefined();
  });
});

describe('createRelevanceLookup', () => {
  it('asks about each subject once and keeps the answer', async () => {
    const { classifier, evaluatedStates } = fakeClassifier(() => 'diagnostics');
    const relevanceOf = createRelevanceLookup(classifier);
    const subject = { key: 'entity:sensor.router_linkquality', description: 'router link quality' };

    expect(await relevanceOf(subject)).toBe('diagnostics');
    expect(await relevanceOf(subject)).toBe('diagnostics');
    expect(evaluatedStates).toHaveLength(1);
  });

  it('knows nothing without a classifier', async () => {
    expect(await createRelevanceLookup(undefined)({ key: 'entity:x', description: 'x' })).toBeUndefined();
  });

  it('knows nothing when the classifier fails, and asks again next time', async () => {
    let calls = 0;
    const { classifier } = fakeClassifier(() => {
      calls++;
      return calls === 1 ? new Error('offline') : 'presence';
    });
    const relevanceOf = createRelevanceLookup(classifier);
    const subject = { key: 'entity:person.mathias', description: 'person' };

    expect(await relevanceOf(subject)).toBeUndefined();
    expect(await relevanceOf(subject)).toBe('presence');
  });
});
