import type { Classifier } from '@mastra/core/classifier';
import type { z } from 'zod';
import { createAgent } from '../../utils/agent-factory.js';
import { logger } from '../../utils/logger.js';
import { LOW_THINKING_PROVIDER_OPTIONS } from '../../utils/providers/google-provider.js';
import { type ClassifiedEmailReply, classifyEmailReply, getEmailReplyClassifier } from './classifier.js';
import { ownReplyText } from './reply-text.js';

export async function getEmailParsingAgent() {
  return createAgent({
    id: 'emailResponseParser',
    name: 'EmailResponseParser',
    instructions: `You are an expert at parsing email responses and extracting structured information.

Your role is to:
1. Read the email body text provided by the user
2. Extract the relevant information according to the provided schema
3. Be intelligent about interpreting the user's intent
4. Handle informal language, typos, and varying response formats
5. Return structured data that matches the expected schema

Guidelines:
- If the user says "yes", "approved", "looks good", etc. - interpret as approval
- If the user says "no", "reject", "not approved", etc. - interpret as rejection
- Extract any comments, notes, or additional context provided
- Be flexible with response formats (bullet points, paragraphs, etc.)
- The body may still be HTML, and a reply usually quotes the message it answers.
  Read the person's own words and ignore the markup and the quoted history.
- If information is missing but can be reasonably inferred, make the inference
- If information is truly missing and cannot be inferred, use null or empty values`,
    tools: {},
    // Reading "yeah fine, go ahead" into { approved: true } is extraction, not reasoning, and the
    // run the reply resumes waits on every second of it.
    defaultOptions: { providerOptions: LOW_THINKING_PROVIDER_OPTIONS },
  });
}

/**
 * Builds the prompt that turns one email reply into a structured answer.
 *
 * Kept separate from {@link parseEmailReply} so its wording can be tested without
 * reaching a model.
 */
export function buildEmailParsingPrompt({ question, replyBody }: { question: string; replyBody: string }): string {
  return [
    'A person was asked the following question by email:',
    '',
    question,
    '',
    'This is their reply, exactly as it arrived:',
    '',
    replyBody,
    '',
    'Extract their answer into the requested structure.',
  ].join('\n');
}

/**
 * Asks the classifier what a reply answers, and turns every way of it not knowing into nothing.
 *
 * A failed classification is no worse than an unsure one: the model reads the reply either way.
 */
async function classifyReplyOrSkip(
  classifier: Classifier,
  request: { question: string; replyBody: string; responseSchema: z.ZodObject<z.ZodRawShape> },
): Promise<ClassifiedEmailReply | undefined> {
  try {
    return await classifyEmailReply(classifier, {
      question: request.question,
      replyText: ownReplyText(request.replyBody),
      responseSchema: request.responseSchema,
    });
  } catch (error) {
    logger.warn('Email reply classifier failed; using the email parsing agent', { error });
    return undefined;
  }
}

/**
 * Turns the free text of an email reply into the structured response a suspended
 * step is waiting for.
 *
 * An answer made only of yes-or-no fields is first put to the email reply classifier
 * (`classifier.ts`), which settles most replies without the model; whatever it is not sure of,
 * and every other answer, is read by the model as before.
 *
 * Throws when the reply is not an answer -- the classifier is sure it decides nothing, or the
 * model cannot produce something the schema accepts. Callers are expected to treat that as
 * "this reply did not answer the question" rather than as a failure of the run: a person who
 * writes "let me think about it" has not answered, and the request they were sent is still open.
 *
 * @param classifier - The classifier to try first; nothing skips straight to the model
 */
export async function parseEmailReply<TResponseSchema extends z.ZodObject<z.ZodRawShape>>({
  question,
  replyBody,
  responseSchema,
  classifier = getEmailReplyClassifier(),
}: {
  question: string;
  replyBody: string;
  responseSchema: TResponseSchema;
  classifier?: Classifier;
}): Promise<z.output<TResponseSchema>> {
  const classified = classifier && (await classifyReplyOrSkip(classifier, { question, replyBody, responseSchema }));

  if (classified?.kind === 'notAnAnswer') {
    logger.info('Email reply classifier refused a reply without the model', { question, reason: classified.reason });
    throw new Error(`The email reply classifier found no answer: ${classified.reason}`);
  }

  if (classified?.kind === 'answer') {
    const validated = responseSchema.safeParse(classified.response);
    if (validated.success) {
      logger.info('Email reply classifier read a reply without the model', { question });
      return validated.data;
    }
    logger.warn('Email reply classifier answered outside the schema; using the email parsing agent', {
      question,
      error: validated.error,
    });
  }

  const agent = await getEmailParsingAgent();

  const parsed = await agent.generate([{ role: 'user', content: buildEmailParsingPrompt({ question, replyBody }) }], {
    structuredOutput: { schema: responseSchema },
    toolChoice: 'none',
  });

  if (parsed.object === undefined || parsed.object === null) {
    throw new Error('The email parsing agent returned no structured response');
  }

  return responseSchema.parse(parsed.object);
}
