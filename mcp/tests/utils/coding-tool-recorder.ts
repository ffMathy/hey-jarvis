import { spyOn } from 'bun:test';
import { continueCodingTask, runCodingTask, startCodingSession } from '../../mastra/verticals/coding/tools.js';
import type { CodebaseAnalysis } from '../../mastra/verticals/coding/workflows.js';

/**
 * Stands in for the two Claude Code sessions `implementFeatureWorkflow` runs, which would
 * otherwise read a real codebase and implement a real change.
 *
 * Spied on rather than replaced with `mock.module`, and that matters. `createToolStep` keeps the
 * tool object it was built with, so a module mock only reaches the workflow if it is registered
 * before anything imports the coding vertical -- and in a `bun test` run every spec shares one
 * process, where some other file has usually imported it already. A spy changes `execute` on
 * that very object, which the step looks up afresh each time it runs.
 */

export interface StartedSession {
  owner?: string;
  repo?: string;
  request: string;
  title?: string;
  instructions?: string;
}

export interface CodingToolRecorder {
  /** Every task an analysing session was started on. */
  analysisTasks: string[];
  /** Every follow-up sent to the analysing session after its first turn. */
  analysisFollowUps: string[];
  startedSessions: StartedSession[];
  /** Puts the real tools back. */
  restore(): void;
}

export const RECORDED_SESSION_ID = 'session_123';

export interface RecordCodingToolsOptions {
  /** What the analysing session reports. Two questions by default. */
  analysis?: CodebaseAnalysis;
  /** How long the analysing session takes, to stand in for one that runs for minutes. */
  analysisDelayMilliseconds?: number;
  /**
   * What the analysing session ends each of its turns on, first turn first; the last is repeated
   * for any turn after it. By default a single turn that ends on `analysis`.
   */
  analysisTurns?: string[];
}

export const RECORDED_ANALYSIS: CodebaseAnalysis = {
  title: 'Push reminders for tasks',
  findings: 'Tasks live in the todo-list vertical; notifications go through sendNotification.',
  questions: [
    'Should the reminder go out by email, or as a push notification?',
    'How long before the task is due should it be sent?',
  ],
};

/** Records every session started, and reports each as having succeeded. */
export function recordCodingTools({
  analysis = RECORDED_ANALYSIS,
  analysisDelayMilliseconds = 0,
  // The way a session ends its turn: a line of its own, then the object it was asked for.
  analysisTurns = [`I have read the codebase.\n\n${JSON.stringify(analysis)}`],
}: RecordCodingToolsOptions = {}): CodingToolRecorder {
  const analysisTasks: string[] = [];
  const analysisFollowUps: string[] = [];
  const startedSessions: StartedSession[] = [];

  /** The analysing session's next turn, ending on the next of `analysisTurns`. */
  const finishAnalysisTurn = async () => {
    const turn = analysisTasks.length + analysisFollowUps.length - 1;
    await new Promise((resolve) => setTimeout(resolve, analysisDelayMilliseconds));
    return {
      success: true,
      session_id: 'session_analysis',
      stop_reason: 'end_turn',
      final_message: analysisTurns[Math.min(turn, analysisTurns.length - 1)],
      message: 'Claude Code session session_analysis stopped with "end_turn".',
    };
  };

  const analysisSpy = spyOn(runCodingTask, 'execute').mockImplementation(async (inputData) => {
    analysisTasks.push(inputData.task);
    return await finishAnalysisTurn();
  });

  const followUpSpy = spyOn(continueCodingTask, 'execute').mockImplementation(async (inputData) => {
    analysisFollowUps.push(inputData.message);
    return await finishAnalysisTurn();
  });

  const sessionSpy = spyOn(startCodingSession, 'execute').mockImplementation(async (inputData) => {
    startedSessions.push(inputData);
    return {
      success: true,
      session_id: RECORDED_SESSION_ID,
      status: 'running',
      message: 'Started Claude Code session session_123 in ffMathy/hey-jarvis',
    };
  });

  return {
    analysisTasks,
    analysisFollowUps,
    startedSessions,
    restore() {
      analysisSpy.mockRestore();
      followUpSpy.mockRestore();
      sessionSpy.mockRestore();
    },
  };
}
