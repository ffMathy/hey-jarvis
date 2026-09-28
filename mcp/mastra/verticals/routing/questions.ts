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
 *
 * Work that runs outside a routing request asks too. A Claude Code session implementing a change
 * can stop at any point to ask sir something, long after the request that started it has been
 * answered; nothing is suspended then, so its question is opened with the function that hands the
 * answer on (see {@link openAnsweredByQuestion}). Either way the answer arrives the same way -- as
 * whatever sir says next to Jarvis, which the planner matches to the question it answers.
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

/** What every question put to sir carries, however its answer is carried back. */
interface QuestionBase {
  /** Short and unique, so the planner can say which question a request answers. */
  id: string;
  /** The task that asked, which is what the caller is told. */
  taskId: string;
  /** The agent that is waiting, or the vertical whose work is. */
  agentId: string;
  question: string;
}

/** A question an agent suspended on, answered by resuming it where it stopped. */
export interface SuspendedAgentQuestion extends QuestionBase {
  agentRunId: string;
  toolCallId: string;
  /** The field of the resume data the answer is written into. */
  answerField: string;
}

/**
 * A question whose answer is handed to a function, for work nothing suspended for.
 *
 * `deliverAnswer` resolves to what came of it, which is what sir is told once he has answered.
 */
export interface AnsweredByQuestion extends QuestionBase {
  deliverAnswer: (answer: string) => Promise<string>;
}

/**
 * A question put to sir, waiting for his answer.
 *
 * Kept past the request that asked it, since the answer only ever arrives as a later request:
 * Jarvis asks, sir replies, and the reply is routed like anything else he says.
 */
export type OpenQuestion = SuspendedAgentQuestion | AnsweredByQuestion;

/** Whether a question's answer goes to a function rather than to a suspended agent. */
export function isAnsweredByQuestion(question: OpenQuestion): question is AnsweredByQuestion {
  return 'deliverAnswer' in question;
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

/**
 * How long after Jarvis last brought a question up he leaves it alone.
 *
 * Long enough that one conversation hears it once rather than after every request, short enough
 * that the next conversation brings it up again.
 */
export const QUESTION_REMINDER_INTERVAL_MS = 30 * 60 * 1000;

/** When Jarvis last brought each open question up in a reply, by id. */
const lastBroughtUpAtById = new Map<string, number>();

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

/**
 * Opens a question whose answer is handed to `deliverAnswer`, and keeps it until sir answers.
 *
 * Opened before it is asked, because the answer can come back within seconds: a question asked
 * on a call is answered on that same call.
 */
export function openAnsweredByQuestion(question: Omit<AnsweredByQuestion, 'id'>): AnsweredByQuestion {
  const opened = { ...question, id: nextQuestionId() };
  rememberOpenQuestions([opened]);
  return opened;
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
  lastBroughtUpAtById.delete(id);
  return question;
}

/**
 * The open questions Jarvis should bring up in his reply to sir, marked as brought up.
 *
 * A question he was asked on a call he missed, or in a push notification, only gets answered if
 * something reminds him of it, so every reply carries the questions still waiting — except those
 * brought up within {@link QUESTION_REMINDER_INTERVAL_MS}, so a conversation is not nagged with
 * the same one after every request, and those in `excludedIds`, which the reply asks anyway.
 */
export function takeQuestionsToBringUp(excludedIds: ReadonlySet<string>, now = Date.now()): OpenQuestion[] {
  const due = [...openQuestionsById.values()].filter(
    (question) =>
      !excludedIds.has(question.id) &&
      now - (lastBroughtUpAtById.get(question.id) ?? Number.NEGATIVE_INFINITY) >= QUESTION_REMINDER_INTERVAL_MS,
  );

  for (const question of due) {
    lastBroughtUpAtById.set(question.id, now);
  }
  return due;
}

/** Forgets every open question. Used by tests. */
export function forgetOpenQuestions(): void {
  openQuestionsById.clear();
  lastBroughtUpAtById.clear();
  questionsAsked = 0;
}
