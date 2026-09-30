/**
 * Email triage: which new emails are filed for the reactor, with what, and at what priority.
 *
 * Being unsure is always safe -- the email is filed as it always was -- so what is pinned here is
 * mostly that nothing is left out, labelled or raised unless the classifier is sure of it.
 */

import { describe, expect, it } from 'bun:test';
import { Classifier } from '@mastra/core/classifier';
import {
  classifyEmail,
  EMAIL_KINDS,
  EMAIL_TRIAGE_CONFIDENCE,
  type EmailKind,
  type EmailTriageAnswers,
  emailFilingFrom,
  emailTriageFrom,
  triageEmails,
} from './classifier.js';

/** A complete distribution over the kinds, putting `confidence` on one and the rest spread evenly. */
function kindDistribution(kind: EmailKind, confidence: number): Record<EmailKind, number> {
  const kindCount = Object.keys(EMAIL_KINDS).length;
  const probabilityOf = (name: EmailKind) => (name === kind ? confidence : (1 - confidence) / (kindCount - 1));
  return {
    personal: probabilityOf('personal'),
    work_needs_action: probabilityOf('work_needs_action'),
    security_code_or_login_alert: probabilityOf('security_code_or_login_alert'),
    delivery_or_order_update: probabilityOf('delivery_or_order_update'),
    receipt_or_invoice: probabilityOf('receipt_or_invoice'),
    newsletter_or_promotion: probabilityOf('newsletter_or_promotion'),
    automated_notification: probabilityOf('automated_notification'),
  };
}

/** A complete distribution over the urgency levels, and the mean the score must then be. */
function urgencyAnswer(level: number, confidence: number) {
  const probabilities = Object.fromEntries(
    [0, 1, 2, 3].map((index) => [String(index), index === level ? confidence : (1 - confidence) / 3]),
  );
  const score = Object.entries(probabilities).reduce(
    (sum, [index, probability]) => sum + Number(index) * probability,
    0,
  );
  return { type: 'score' as const, score, probabilities };
}

function answers(kind: EmailKind, kindConfidence: number, urgencyLevel: number, urgencyConfidence: number) {
  return {
    kind: { type: 'choice' as const, choice: kind, probabilities: kindDistribution(kind, kindConfidence) },
    urgency: urgencyAnswer(urgencyLevel, urgencyConfidence),
  } satisfies EmailTriageAnswers;
}

describe('emailTriageFrom', () => {
  it('reads the kind and the urgency it is sure of', () => {
    expect(emailTriageFrom(answers('security_code_or_login_alert', 0.96, 3, 0.9))).toEqual({
      kind: 'security_code_or_login_alert',
      urgency: 'now',
    });
  });

  it('leaves out whatever it is not sure enough of', () => {
    const unsure = EMAIL_TRIAGE_CONFIDENCE - 0.01;

    expect(emailTriageFrom(answers('personal', unsure, 1, 0.95))).toEqual({ urgency: 'fyi' });
    expect(emailTriageFrom(answers('personal', 0.95, 1, unsure))).toEqual({ kind: 'personal' });
  });

  it('is sure of nothing when it gives no distribution to be sure by', () => {
    expect(
      emailTriageFrom({
        kind: { type: 'choice', choice: 'newsletter_or_promotion' },
        urgency: { type: 'score', score: 0 },
      }),
    ).toEqual({});
  });

  it('does not read a mean of fyi as fyi when it is really split between ignore and today', () => {
    const probabilities = { '0': 0.5, '1': 0, '2': 0.5, '3': 0 };

    expect(
      emailTriageFrom({ ...answers('personal', 0.95, 1, 0.95), urgency: { type: 'score', score: 1, probabilities } }),
    ).toEqual({
      kind: 'personal',
    });
  });
});

describe('emailFilingFrom', () => {
  it('leaves out newsletters and emails nobody needs, and counts them', () => {
    const filing = emailFilingFrom([
      { email: 'offer', triage: { kind: 'newsletter_or_promotion', urgency: 'fyi' } },
      { email: 'noise', triage: { kind: 'automated_notification', urgency: 'ignore' } },
      { email: 'friend', triage: { kind: 'personal', urgency: 'today' } },
    ]);

    expect(filing).toEqual({
      kept: [{ email: 'friend', kind: 'personal' }],
      droppedEmailCount: 1 + 1,
      priority: 'low',
    });
  });

  it('keeps an email it is unsure of exactly as it was, without a kind', () => {
    expect(emailFilingFrom([{ email: 'unknown', triage: {} }])).toEqual({
      kept: [{ email: 'unknown' }],
      droppedEmailCount: 0,
      priority: 'low',
    });
  });

  it('raises the priority when one kept email needs the user now', () => {
    const filing = emailFilingFrom([
      { email: 'receipt', triage: { kind: 'receipt_or_invoice', urgency: 'fyi' } },
      { email: 'code', triage: { kind: 'security_code_or_login_alert', urgency: 'now' } },
    ]);

    expect(filing.priority).toBe('high');
  });

  it('leaves nothing to file when every email is left out', () => {
    expect(emailFilingFrom([{ email: 'offer', triage: { kind: 'newsletter_or_promotion' } }]).kept).toEqual([]);
  });
});

/** A classifier on a fake evaluation model that answers every email with `answersFor(state)`. */
function fakeClassifier(answersFor: (state: unknown) => EmailTriageAnswers | Error) {
  const evaluatedStates: unknown[] = [];
  const classifier = new Classifier({
    id: 'emailTriageClassifier',
    model: {
      specificationVersion: 'v4',
      provider: 'fake',
      modelId: 'jev-fake',
      supportedQuestionTypes: ['choice', 'score'],
      doEvaluate: async ({ state }) => {
        evaluatedStates.push(state);
        const result = answersFor(state);
        if (result instanceof Error) {
          throw result;
        }
        return { answers: result, warnings: [] };
      },
    },
  });
  return { classifier, evaluatedStates };
}

const OFFER = { from: 'news@shop.example', subject: '50% off everything', bodyPreview: 'This weekend only' };
const CODE = { from: 'no-reply@bank.example', subject: 'Your sign-in code', bodyPreview: 'Your code is 123456' };

describe('classifyEmail', () => {
  it('shows the classifier the sender, the subject and the preview, and reads its answers', async () => {
    const { classifier, evaluatedStates } = fakeClassifier(() => answers('newsletter_or_promotion', 0.97, 0, 0.9));

    expect(await classifyEmail(classifier, OFFER)).toEqual({ kind: 'newsletter_or_promotion', urgency: 'ignore' });
    expect(evaluatedStates).toEqual([OFFER]);
  });
});

describe('triageEmails', () => {
  it('classifies every email and files only what is left', async () => {
    const { classifier } = fakeClassifier((state) =>
      JSON.stringify(state).includes('sign-in')
        ? answers('security_code_or_login_alert', 0.95, 3, 0.92)
        : answers('newsletter_or_promotion', 0.95, 0, 0.9),
    );

    const filing = await triageEmails([OFFER, CODE], classifier);

    expect(filing).toEqual({
      kept: [{ email: CODE, kind: 'security_code_or_login_alert' }],
      droppedEmailCount: 1,
      priority: 'high',
    });
  });

  it('files an email whose classification fails as it always was', async () => {
    const { classifier } = fakeClassifier((state) =>
      JSON.stringify(state).includes('sign-in')
        ? new Error('Jev is down')
        : answers('newsletter_or_promotion', 0.95, 1, 0.9),
    );

    const filing = await triageEmails([OFFER, CODE], classifier);

    expect(filing).toEqual({ kept: [{ email: CODE }], droppedEmailCount: 1, priority: 'low' });
  });

  it('files every email as it always was without a classifier', async () => {
    expect(await triageEmails([OFFER, CODE], undefined)).toEqual({
      kept: [{ email: OFFER }, { email: CODE }],
      droppedEmailCount: 0,
      priority: 'low',
    });
  });
});
