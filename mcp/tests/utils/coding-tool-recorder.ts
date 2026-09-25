import { spyOn } from 'bun:test';
import { createGitHubIssue, startCodingSession } from '../../mastra/verticals/coding/tools.js';

/**
 * Stands in for the two tools `implementFeatureWorkflow` ends with, which would otherwise file a
 * real GitHub issue and start a real Claude cloud session.
 *
 * Spied on rather than replaced with `mock.module`, and that matters. `createToolStep` keeps the
 * tool object it was built with, so a module mock only reaches the workflow if it is registered
 * before anything imports the coding vertical -- and in a `bun test` run every spec shares one
 * process, where some other file has usually imported it already. A spy changes `execute` on
 * that very object, which the step looks up afresh each time it runs.
 */

export interface CreatedIssue {
  owner?: string;
  repo?: string;
  title: string;
  body: string;
  labels?: string[];
}

export interface StartedSession {
  owner?: string;
  repo?: string;
  issue_number: number;
  title?: string;
  instructions?: string;
}

export interface CodingToolRecorder {
  createdIssues: CreatedIssue[];
  startedSessions: StartedSession[];
  /** Puts the real tools back. */
  restore(): void;
}

export const RECORDED_ISSUE_NUMBER = 42;
export const RECORDED_ISSUE_URL = `https://github.com/ffMathy/hey-jarvis/issues/${RECORDED_ISSUE_NUMBER}`;
export const RECORDED_SESSION_URL = 'https://claude.ai/code/session_123';

/** Records every issue filed and session started, and reports both as having succeeded. */
export function recordCodingTools(): CodingToolRecorder {
  const createdIssues: CreatedIssue[] = [];
  const startedSessions: StartedSession[] = [];

  const issueSpy = spyOn(createGitHubIssue, 'execute').mockImplementation(async (inputData) => {
    createdIssues.push(inputData);
    return {
      success: true,
      issue_number: RECORDED_ISSUE_NUMBER,
      issue_url: RECORDED_ISSUE_URL,
      message: `Successfully created issue #${RECORDED_ISSUE_NUMBER}`,
    };
  });

  const sessionSpy = spyOn(startCodingSession, 'execute').mockImplementation(async (inputData) => {
    startedSessions.push(inputData);
    return {
      success: true,
      session_id: 'session_123',
      session_url: RECORDED_SESSION_URL,
      status: 'running',
      message: `Started Claude cloud session session_123 for issue #${inputData.issue_number}`,
    };
  });

  return {
    createdIssues,
    startedSessions,
    restore() {
      issueSpy.mockRestore();
      sessionSpy.mockRestore();
    },
  };
}
