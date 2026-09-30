import type { BooleanQuestion, Classifier, ClassifierAnswers } from '@mastra/core/classifier';
import { z } from 'zod';
import { createLazyClassifier } from '../../utils/index.js';

/**
 * The fast path in front of the email parsing agent.
 *
 * Most of the questions this vertical emails are yes-or-no: approve the budget, confirm the order.
 * Reading "yeah fine, go ahead" into `{ approved: true }` is not something a language model has to
 * write -- it is a yes/no question about the reply, which is exactly what an evaluation model (Jev,
 * see `utils/providers/typesafe-provider.ts`) answers, in one short call that returns a probability
 * instead of a generation.
 *
 * So when every field the answer needs is a yes or no, each is asked of the reply as a boolean
 * question, alongside one more: does the reply decide at all, or does it defer, ask back or talk
 * about something else. A reply the classifier is sure of in every respect becomes the answer
 * without the model; a reply it is sure does not decide anything is refused the same way the
 * model's unusable answers are, so the request stays open. Anything else -- an answer that needs a
 * vendor's name or a free-text justification, or a classifier that is not sure -- goes to the
 * model, exactly as before. Being wrong here records a decision nobody made, and being unsure
 * costs one model call, so the bar is set high.
 */

/** Registered on the Mastra instance under this key, so Studio shows its evaluations. */
export const EMAIL_REPLY_CLASSIFIER_ID = 'emailReplyClassifier';

/**
 * How sure the classifier must be of each yes or no, in either direction, before the model is
 * skipped: a probability at or above this reads as yes, and one at or below `1 - this` as no.
 */
export const EMAIL_REPLY_CONFIDENCE = 0.9;

/** The question asking whether the reply decides anything at all. */
const ANSWERS_THE_QUESTION = 'answersTheQuestion';

/** Prefixes each field's question, so no field name can collide with {@link ANSWERS_THE_QUESTION}. */
const FIELD_QUESTION_PREFIX = 'field_';

/** A yes-or-no field of the answer, as the classifier is asked about it. */
export interface BooleanReplyField {
  name: string;
  /** The `.describe()` text of the field, which says what a yes means better than its name does. */
  description?: string;
}

/** The answer fields a reply can be read into without a language model. */
export interface BooleanReplyShape {
  /** The required yes-or-no fields, each asked of the reply. */
  booleanFields: BooleanReplyField[];
  /** The optional text fields, which carry what the person wrote. */
  textFields: string[];
}

/**
 * Says whether an answer can be read off a reply with yes-or-no questions alone.
 *
 * Only an answer whose required fields are all booleans, with nothing else beside them but
 * optional strings, can: a required string is something the person has to have written, like a
 * vendor's name or the feedback on a meal plan, and pulling that out of free text is the model's
 * job. That is also what keeps the meal plan's feedback on the model -- its answer requires the
 * feedback text.
 *
 * @returns The fields to ask about and fill in, or nothing when the model has to read the reply
 */
export function booleanReplyShapeOf(responseSchema: z.ZodObject<z.ZodRawShape>): BooleanReplyShape | undefined {
  const booleanFields: BooleanReplyField[] = [];
  const textFields: string[] = [];

  for (const [name, field] of Object.entries(responseSchema.shape)) {
    if (field instanceof z.ZodBoolean) {
      booleanFields.push({ name, ...(field.description && { description: field.description }) });
    } else if (field instanceof z.ZodOptional && field.unwrap() instanceof z.ZodString) {
      textFields.push(name);
    } else {
      return undefined;
    }
  }

  return booleanFields.length > 0 ? { booleanFields, textFields } : undefined;
}

/** What a reply is, as far as the classifier is sure. */
export type ClassifiedEmailReply =
  | { kind: 'answer'; response: Record<string, boolean | string> }
  | { kind: 'notAnAnswer'; reason: string };

/**
 * Built per call, because the fields and the question asked differ from one request to the next.
 */
export function emailReplyQuestions(question: string, shape: BooleanReplyShape): Record<string, BooleanQuestion> {
  const fieldQuestions = shape.booleanFields.map((field): [string, BooleanQuestion] => [
    `${FIELD_QUESTION_PREFIX}${field.name}`,
    {
      type: 'boolean',
      instructions:
        `This is a person's email reply to the question: "${question}". ` +
        `Does the reply answer yes to "${field.name}"${field.description ? ` (${field.description})` : ''}?`,
    },
  ]);

  return {
    [ANSWERS_THE_QUESTION]: {
      type: 'boolean',
      instructions:
        `This is a person's email reply to the question: "${question}". ` +
        'Does the reply give a decision, rather than deferring it ("let me think about it"), asking something ' +
        'back, or talking about something else?',
    },
    ...Object.fromEntries(fieldQuestions),
  };
}

export type EmailReplyAnswers = ClassifierAnswers<Record<string, BooleanQuestion>>;

/** Reads a probability the classifier is sure of into yes or no, or into nothing when it is not. */
function sureAnswer(probability: number | undefined): boolean | undefined {
  if (probability === undefined) {
    return undefined;
  }
  if (probability >= EMAIL_REPLY_CONFIDENCE) {
    return true;
  }
  if (probability <= 1 - EMAIL_REPLY_CONFIDENCE) {
    return false;
  }
  return undefined;
}

/**
 * Reads the classifier's answers into the reply's answer, a refusal, or nothing when the model
 * should read the reply instead.
 *
 * Pure, so every way of declining the fast path can be tested without a model.
 *
 * @param ownReplyText - What the person wrote, which fills every text field the answer has
 */
export function classifiedEmailReplyFrom(
  answers: EmailReplyAnswers,
  shape: BooleanReplyShape,
  ownReplyText: string,
): ClassifiedEmailReply | undefined {
  const decides = sureAnswer(answers[ANSWERS_THE_QUESTION]?.probability);
  if (decides === false) {
    return { kind: 'notAnAnswer', reason: 'the reply does not give a decision' };
  }
  if (decides === undefined) {
    return undefined;
  }

  const response: Record<string, boolean | string> = {};
  for (const field of shape.booleanFields) {
    const value = sureAnswer(answers[`${FIELD_QUESTION_PREFIX}${field.name}`]?.probability);
    if (value === undefined) {
      return undefined;
    }
    response[field.name] = value;
  }

  if (ownReplyText.length > 0) {
    for (const name of shape.textFields) {
      response[name] = ownReplyText;
    }
  }

  return { kind: 'answer', response };
}

/**
 * The classifier email replies are read with, or nothing when there is no key to run it with.
 *
 * One instance for the process, so the one registered on Mastra is the one replies use.
 */
export const getEmailReplyClassifier = createLazyClassifier(EMAIL_REPLY_CLASSIFIER_ID);

/**
 * Asks the classifier what a reply answers, when its answer is made of yes-or-no fields.
 *
 * @returns What the reply is, or nothing when the answer's shape or the classifier's certainty
 *   leaves it to the model
 */
export async function classifyEmailReply(
  classifier: Classifier,
  {
    question,
    replyText,
    responseSchema,
  }: { question: string; replyText: string; responseSchema: z.ZodObject<z.ZodRawShape> },
): Promise<ClassifiedEmailReply | undefined> {
  const shape = booleanReplyShapeOf(responseSchema);
  if (!shape || replyText.length === 0) {
    return undefined;
  }

  const { answers } = await classifier.evaluate({
    state: replyText,
    questions: emailReplyQuestions(question, shape),
  });

  return classifiedEmailReplyFrom(answers, shape, replyText);
}
