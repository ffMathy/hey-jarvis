import { spyOn } from 'bun:test';
import { startCodingSession } from '../../mastra/verticals/coding/tools.js';

/**
 * Stands in for the Claude Code session `implementFeatureWorkflow` starts, which would otherwise
 * read a real codebase and implement a real change.
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
  startedSessions: StartedSession[];
  /** Puts the real tool back. */
  restore(): void;
}

export const RECORDED_SESSION_ID = 'session_123';

/** Records every session started, and reports each as having succeeded. */
export function recordCodingTools(): CodingToolRecorder {
  const startedSessions: StartedSession[] = [];

  const sessionSpy = spyOn(startCodingSession, 'execute').mockImplementation(async (inputData) => {
    startedSessions.push(inputData);
    return {
      success: true,
      session_id: RECORDED_SESSION_ID,
      status: 'running',
      message: `Started Claude Code session ${RECORDED_SESSION_ID} in ffMathy/hey-jarvis`,
    };
  });

  return {
    startedSessions,
    restore() {
      sessionSpy.mockRestore();
    },
  };
}
