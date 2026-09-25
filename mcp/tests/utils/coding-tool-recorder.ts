import { spyOn } from 'bun:test';
import { runCodingTask, startCodingSession } from '../../mastra/verticals/coding/tools.js';
import type { CodebaseAnalysis } from '../../mastra/verticals/coding/workflows.js';

/**
 * Stands in for the two Claude cloud sessions `implementFeatureWorkflow` runs, which would
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
  startedSessions: StartedSession[];
  /** Puts the real tools back. */
  restore(): void;
}

export const RECORDED_SESSION_URL = 'https://claude.ai/code/session_123';

export interface RecordCodingToolsOptions {
  /** What the analysing session reports. Two questions by default. */
  analysis?: CodebaseAnalysis;
  /** How long the analysing session takes, to stand in for one that runs for minutes. */
  analysisDelayMilliseconds?: number;
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
}: RecordCodingToolsOptions = {}): CodingToolRecorder {
  const analysisTasks: string[] = [];
  const startedSessions: StartedSession[] = [];

  const analysisSpy = spyOn(runCodingTask, 'execute').mockImplementation(async (inputData) => {
    analysisTasks.push(inputData.task);
    await new Promise((resolve) => setTimeout(resolve, analysisDelayMilliseconds));
    return {
      success: true,
      session_id: 'session_analysis',
      stop_reason: 'end_turn',
      // The way a session ends its turn: a line of its own, then the object it was asked for.
      final_message: `I have read the codebase.\n\n${JSON.stringify(analysis)}`,
      message: 'Claude cloud session session_analysis stopped with "end_turn".',
    };
  });

  const sessionSpy = spyOn(startCodingSession, 'execute').mockImplementation(async (inputData) => {
    startedSessions.push(inputData);
    return {
      success: true,
      session_id: 'session_123',
      session_url: RECORDED_SESSION_URL,
      status: 'running',
      message: 'Started Claude cloud session session_123 in ffMathy/hey-jarvis',
    };
  });

  return {
    analysisTasks,
    startedSessions,
    restore() {
      analysisSpy.mockRestore();
      sessionSpy.mockRestore();
    },
  };
}
