/**
 * The email reply classifier's fast path: which answers it may read without the model, and every
 * way it declines to.
 *
 * Declining is always safe -- the email parsing agent reads the reply instead -- so what is pinned
 * here is mostly that it declines whenever it is not sure, and that an answer needing text only a
 * person could have written never takes it.
 */

import { describe, expect, it } from 'bun:test';
import { Classifier } from '@mastra/core/classifier';
import { z } from 'zod';
import {
  booleanReplyShapeOf,
  classifiedEmailReplyFrom,
  classifyEmailReply,
  EMAIL_REPLY_CONFIDENCE,
  type EmailReplyAnswers,
  emailReplyQuestions,
} from './classifier.js';

const approvalSchema = z.object({
  approved: z.boolean().describe('Whether the budget is approved'),
  comments: z.string().optional(),
});
const APPROVAL_SHAPE = {
  booleanFields: [{ name: 'approved', description: 'Whether the budget is approved' }],
  textFields: ['comments'],
};
const QUESTION = 'Please approve the budget for project "Atlas".';

function answers(answersTheQuestion: number, approved: number): EmailReplyAnswers {
  return {
    answersTheQuestion: { type: 'boolean', probability: answersTheQuestion },
    field_approved: { type: 'boolean', probability: approved },
  };
}

/** A classifier on a fake Jev that answers every question with the probability staged for it. */
function fakeClassifier(probabilities: Record<string, number>) {
  const evaluated: { state: unknown; questions: Record<string, unknown> }[] = [];
  const classifier = new Classifier({
    id: 'emailReplyClassifier',
    model: {
      specificationVersion: 'v4',
      provider: 'fake',
      modelId: 'jev-fake',
      supportedQuestionTypes: ['boolean'],
      doEvaluate: async ({ state, questions }) => {
        evaluated.push({ state, questions });
        return {
          answers: Object.fromEntries(
            Object.keys(questions).map((id) => [
              id,
              { type: 'boolean' as const, probability: probabilities[id] ?? 0.5 },
            ]),
          ),
          warnings: [],
        };
      },
    },
  });
  return { classifier, evaluated };
}

describe('booleanReplyShapeOf', () => {
  it('reads the yes-or-no fields and the optional text beside them', () => {
    expect(booleanReplyShapeOf(approvalSchema)).toEqual(APPROVAL_SHAPE);
    expect(booleanReplyShapeOf(z.object({ confirmed: z.boolean(), finalNotes: z.string().optional() }))).toEqual({
      booleanFields: [{ name: 'confirmed' }],
      textFields: ['finalNotes'],
    });
  });

  it('leaves an answer that needs text a person wrote to the model', () => {
    expect(booleanReplyShapeOf(z.object({ vendorName: z.string(), justification: z.string() }))).toBeUndefined();
  });

  it("leaves the meal plan's feedback to the model, since it requires the feedback text", () => {
    // The same shape as `mealPlanFeedbackResponseSchema` in `cooking/workflows.ts`.
    const mealPlanFeedbackSchema = z.object({
      feedbackText: z.string().describe('The human feedback text about the meal plan'),
      isApprovalIntent: z.boolean().optional().describe('Initial assessment if this seems like an approval'),
    });

    expect(booleanReplyShapeOf(mealPlanFeedbackSchema)).toBeUndefined();
  });

  it('leaves anything but required booleans and optional strings to the model', () => {
    expect(booleanReplyShapeOf(z.object({ approved: z.boolean(), amount: z.number() }))).toBeUndefined();
    expect(booleanReplyShapeOf(z.object({ approved: z.boolean().optional() }))).toBeUndefined();
    expect(booleanReplyShapeOf(z.object({ comments: z.string().optional() }))).toBeUndefined();
  });
});

describe('emailReplyQuestions', () => {
  it('asks whether the reply decides, and one yes or no per field, naming the question and the field', () => {
    const questions = emailReplyQuestions(QUESTION, APPROVAL_SHAPE);

    expect(Object.keys(questions)).toEqual(['answersTheQuestion', 'field_approved']);
    expect(questions.answersTheQuestion.instructions).toContain(QUESTION);
    expect(questions.field_approved.instructions).toContain(QUESTION);
    expect(questions.field_approved.instructions).toContain('"approved" (Whether the budget is approved)');
  });
});

describe('classifiedEmailReplyFrom', () => {
  it('reads a sure yes, filling the text fields with what the person wrote', () => {
    expect(classifiedEmailReplyFrom(answers(0.97, 0.95), APPROVAL_SHAPE, 'Yeah fine, go ahead')).toEqual({
      kind: 'answer',
      response: { approved: true, comments: 'Yeah fine, go ahead' },
    });
  });

  it('reads a sure no', () => {
    expect(classifiedEmailReplyFrom(answers(0.97, 0.03), APPROVAL_SHAPE, 'No')).toEqual({
      kind: 'answer',
      response: { approved: false, comments: 'No' },
    });
  });

  it('holds the bar at exactly the confidence, in both directions', () => {
    expect(classifiedEmailReplyFrom(answers(0.97, EMAIL_REPLY_CONFIDENCE), APPROVAL_SHAPE, 'Yes')).toMatchObject({
      response: { approved: true },
    });
    expect(classifiedEmailReplyFrom(answers(0.97, 1 - EMAIL_REPLY_CONFIDENCE), APPROVAL_SHAPE, 'No')).toMatchObject({
      response: { approved: false },
    });
  });

  it('leaves the reply to the model when any field is unsure', () => {
    expect(classifiedEmailReplyFrom(answers(0.97, 0.7), APPROVAL_SHAPE, 'Probably')).toBeUndefined();
    expect(classifiedEmailReplyFrom(answers(0.97, 0.2), APPROVAL_SHAPE, 'Probably not')).toBeUndefined();
  });

  it('leaves the reply to the model when it is unsure the reply decides anything, however sure the field is', () => {
    expect(classifiedEmailReplyFrom(answers(0.5, 0.99), APPROVAL_SHAPE, 'Yes, but ask Anna?')).toBeUndefined();
  });

  it('refuses a reply it is sure decides nothing', () => {
    expect(classifiedEmailReplyFrom(answers(0.04, 0.5), APPROVAL_SHAPE, 'Let me think about it')).toEqual({
      kind: 'notAnAnswer',
      reason: 'the reply does not give a decision',
    });
  });

  it('leaves the reply to the model when an answer is missing', () => {
    expect(
      classifiedEmailReplyFrom({ answersTheQuestion: { type: 'boolean', probability: 0.99 } }, APPROVAL_SHAPE, 'Yes'),
    ).toBeUndefined();
  });

  it('leaves the text fields out when nothing of the person was left to fill them with', () => {
    expect(classifiedEmailReplyFrom(answers(0.97, 0.95), APPROVAL_SHAPE, '')).toEqual({
      kind: 'answer',
      response: { approved: true },
    });
  });
});

describe('classifyEmailReply', () => {
  it('evaluates the reply text against the questions and reads the answers', async () => {
    const { classifier, evaluated } = fakeClassifier({ answersTheQuestion: 0.98, field_approved: 0.96 });

    const classified = await classifyEmailReply(classifier, {
      question: QUESTION,
      replyText: 'Yeah fine, go ahead',
      responseSchema: approvalSchema,
    });

    expect(classified).toEqual({ kind: 'answer', response: { approved: true, comments: 'Yeah fine, go ahead' } });
    expect(evaluated).toHaveLength(1);
    expect(evaluated[0].state).toBe('Yeah fine, go ahead');
    expect(Object.keys(evaluated[0].questions)).toEqual(['answersTheQuestion', 'field_approved']);
  });

  it('asks nothing of an answer the model has to read, or of a reply with nothing in it', async () => {
    const { classifier, evaluated } = fakeClassifier({});

    expect(
      await classifyEmailReply(classifier, {
        question: 'Which vendor?',
        replyText: 'Acme, they are cheapest',
        responseSchema: z.object({ vendorName: z.string(), justification: z.string() }),
      }),
    ).toBeUndefined();
    expect(
      await classifyEmailReply(classifier, { question: QUESTION, replyText: '', responseSchema: approvalSchema }),
    ).toBeUndefined();
    expect(evaluated).toHaveLength(0);
  });
});
