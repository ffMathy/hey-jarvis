import { logger } from '../../utils/logger.js';

/**
 * Questions a delegation stopped to ask, and the answers that resume it.
 *
 * Some work cannot be finished on what the request said. The coding agent's
 * `implementFeatureWorkflow` asks sir whatever the codebase could not answer before it starts
 * implementing anything, and each question it asks suspends the workflow -- which, because the
 * agent runs that workflow as a tool, suspends the agent too. That is Mastra's own mechanism, and it says exactly what routing needs to know: the
 * agent run that is waiting, the tool call it is waiting in, what it wants to ask, and the shape
 * of the answer that resumes it.
 *
 * Nothing here is specific to coding. Any tool of any routable agent that suspends with a
 * `question` becomes a question for sir, and is resumed with his answer.
 */

/** A delegation's agent, stopped inside a tool call until someone answers it. */
export interface DelegationSuspension {
  /** The agent run that is suspended, which is what `resumeStream` resumes. */
  agentRunId: string;
  /** The tool call it is suspended in. */
  toolCallId: string;
  /** What the tool suspended with. */
  suspendPayload: unknown;
  /** JSON Schema of the data the tool resumes with, as the agent reports it. */
  resumeSchema: string | undefined;
}

/**
 * A question put to sir, waiting for his answer.
 *
 * Kept past the request that asked it, since the answer only ever arrives as a later request:
 * Jarvis asks, sir replies, and the reply is routed like anything else he says.
 */
export interface OpenQuestion {
  /** Short and unique, so the planner can say which question a request answers. */
  id: string;
  /** The task that asked, which is what the caller is told. */
  taskId: string;
  /** The agent that is waiting. */
  agentId: string;
  question: string;
  agentRunId: string;
  toolCallId: string;
  /** The field of the resume data the answer is written into. */
  answerField: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads a suspension off one chunk of an agent's own stream.
 *
 * The same chunk arrives two ways: straight off `agent.resumeStream`, and wrapped in a
 * `workflow-step-output` when the agent is a step of a routing plan. Both callers unwrap to the
 * agent's chunk and hand it here.
 */
export function asDelegationSuspension(chunk: unknown): DelegationSuspension | undefined {
  if (!isRecord(chunk) || chunk.type !== 'tool-call-suspended' || !isRecord(chunk.payload)) {
    return undefined;
  }

  const { runId } = chunk;
  const { toolCallId, suspendPayload, resumeSchema } = chunk.payload;
  if (typeof runId !== 'string' || typeof toolCallId !== 'string') {
    return undefined;
  }

  return {
    agentRunId: runId,
    toolCallId,
    suspendPayload,
    resumeSchema: typeof resumeSchema === 'string' ? resumeSchema : undefined,
  };
}

/**
 * The one field of a resume schema that a spoken answer can fill.
 *
 * An answer arrives as a sentence, so a tool can be resumed with one only if what it resumes
 * with is a single piece of text -- the coding workflow's `{ userAnswer }`. Anything richer would need
 * the answer taken apart first, and nothing that suspends asks for that today.
 */
function answerFieldOf(resumeSchema: string | undefined): string | undefined {
  if (!resumeSchema) {
    return undefined;
  }

  let schema: unknown;
  try {
    schema = JSON.parse(resumeSchema);
  } catch {
    return undefined;
  }

  if (!isRecord(schema) || !isRecord(schema.properties)) {
    return undefined;
  }

  const textFields = Object.entries(schema.properties)
    .filter(([, property]) => isRecord(property) && property.type === 'string')
    .map(([name]) => name);

  return textFields.length === 1 && Object.keys(schema.properties).length === 1 ? textFields[0] : undefined;
}

/**
 * Turns a suspension into a question sir can answer out loud, or says why it cannot be one.
 *
 * A suspension that cannot be asked is reported as a failed delegation rather than left open:
 * otherwise the request would wait on an answer nobody can ever give.
 */
export function readSuspension(
  suspension: DelegationSuspension,
): { question: string; answerField: string } | { problem: string } {
  const question = isRecord(suspension.suspendPayload) ? suspension.suspendPayload.question : undefined;
  if (typeof question !== 'string' || question.trim().length === 0) {
    return { problem: 'it paused for input without saying what it wanted to ask' };
  }

  const answerField = answerFieldOf(suspension.resumeSchema);
  if (!answerField) {
    return { problem: `it asked "${question}", but wants an answer that cannot be given out loud` };
  }

  return { question: question.trim(), answerField };
}

/** Where a question waits until sir answers it, by id. */
const openQuestionsById = new Map<string, OpenQuestion>();

let questionsAsked = 0;

/** Mints the id a new question is known by. Short, because the planner has to repeat it. */
export function nextQuestionId(): string {
  questionsAsked += 1;
  return `q${questionsAsked}`;
}

/** Keeps questions that were put to sir, so a later request can answer them. */
export function rememberOpenQuestions(questions: OpenQuestion[]): void {
  for (const question of questions) {
    openQuestionsById.set(question.id, question);
  }
}

/** Every question still waiting for an answer, oldest first. */
export function listOpenQuestions(): OpenQuestion[] {
  return [...openQuestionsById.values()];
}

/**
 * Hands a question over to be answered, and stops offering it.
 *
 * Taken rather than read, because an answer resumes the run exactly once. If the answer leads
 * to another question, that one is remembered under an id of its own.
 */
export function takeOpenQuestion(id: string): OpenQuestion | undefined {
  const question = openQuestionsById.get(id);
  if (!question) {
    logger.warn('An answer named a question that is not open', { questionId: id });
    return undefined;
  }

  openQuestionsById.delete(id);
  return question;
}

/** Forgets every open question. Used by tests. */
export function forgetOpenQuestions(): void {
  openQuestionsById.clear();
  questionsAsked = 0;
}
