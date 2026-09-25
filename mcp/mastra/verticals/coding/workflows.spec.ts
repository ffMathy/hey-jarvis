/**
 * The path from a spoken request to a coding session, run the way a voice conversation runs it:
 * a session reads the codebase first, its questions are asked one suspension at a time, and once
 * the last one is answered a second session is started on the change — with no issue in between.
 *
 * Both Claude cloud sessions are spied on and recorded, so everything between them — the
 * analysis being read, the suspensions, the state carried across them and what the implementing
 * session is finally told — is the real workflow.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { Mastra } from '@mastra/core';
import { InMemoryStore } from '@mastra/core/storage';
import {
  type CodingToolRecorder,
  RECORDED_ANALYSIS,
  RECORDED_SESSION_URL,
  type RecordCodingToolsOptions,
  recordCodingTools,
} from '../../../tests/utils/coding-tool-recorder.js';
import { isSlowTask } from '../../utils/slow-tasks.js';
import { buildCodebaseAnalysisTask, implementFeatureWorkflow, readCodebaseAnalysis } from './workflows.js';

const REQUEST = 'Remind me about tasks before they are due';
const [FIRST_QUESTION, SECOND_QUESTION] = RECORDED_ANALYSIS.questions;

let codingTools: CodingToolRecorder | undefined;

function startRun(options?: RecordCodingToolsOptions) {
  codingTools = recordCodingTools(options);
  const mastra = new Mastra({
    storage: new InMemoryStore(),
    logger: false,
    workflows: { implementFeatureWorkflow },
  });
  return { recorder: codingTools, createRun: () => mastra.getWorkflow('implementFeatureWorkflow').createRun() };
}

/** A suspended run, read as text, so a spec can look for the question it is waiting on. */
function suspendedRunText(result: { status: string }): string {
  expect(result.status).toBe('suspended');
  return JSON.stringify(result);
}

afterEach(() => {
  codingTools?.restore();
  codingTools = undefined;
});

describe('implementFeatureWorkflow', () => {
  it('is marked slow, so routing can offer to notify rather than hold the line', () => {
    expect(isSlowTask('workflow-implementFeatureWorkflow')).toBe(true);
  });

  it('has the codebase analysed before the first question, and starts nothing yet', async () => {
    const { recorder, createRun } = startRun();
    const run = await createRun();

    const started = await run.start({ inputData: { initialRequest: REQUEST } });

    expect(recorder.analysisTasks).toHaveLength(1);
    expect(recorder.analysisTasks[0]).toContain(REQUEST);
    expect(suspendedRunText(started)).toContain(FIRST_QUESTION);
    expect(recorder.startedSessions).toEqual([]);
  });

  it('asks each of the analysis’s questions in turn', async () => {
    const { recorder, createRun } = startRun();
    const run = await createRun();
    await run.start({ inputData: { initialRequest: REQUEST } });

    const afterFirstAnswer = await run.resume({ resumeData: { userAnswer: 'Push, please.' } });

    expect(suspendedRunText(afterFirstAnswer)).toContain(SECOND_QUESTION);
    expect(recorder.analysisTasks).toHaveLength(1);
    expect(recorder.startedSessions).toEqual([]);
  });

  it('starts the coding session straight after the last answer, with no issue filed', async () => {
    const { recorder, createRun } = startRun();
    const run = await createRun();
    await run.start({ inputData: { initialRequest: REQUEST } });
    await run.resume({ resumeData: { userAnswer: 'Push, please.' } });

    const finished = await run.resume({ resumeData: { userAnswer: 'An hour before.' } });

    expect(finished.status).toBe('success');
    expect(recorder.startedSessions).toEqual([
      expect.objectContaining({ repo: 'hey-jarvis', request: REQUEST, title: 'Push reminders for tasks' }),
    ]);
    if (finished.status === 'success') {
      expect(finished.result).toMatchObject({ success: true, sessionUrl: RECORDED_SESSION_URL });
    }
  });

  it('hands the implementing session the findings and every answer in the user’s own words', async () => {
    const { recorder, createRun } = startRun();
    const run = await createRun();
    await run.start({ inputData: { initialRequest: REQUEST } });
    await run.resume({ resumeData: { userAnswer: 'Push, please.' } });
    await run.resume({ resumeData: { userAnswer: 'An hour before.' } });

    const instructions = recorder.startedSessions[0].instructions ?? '';
    expect(instructions).toContain(RECORDED_ANALYSIS.findings);
    expect(instructions).toContain(FIRST_QUESTION);
    expect(instructions).toContain('Push, please.');
    expect(instructions).toContain(SECOND_QUESTION);
    expect(instructions).toContain('An hour before.');
  });

  it('goes straight to implementation when the codebase settles everything', async () => {
    const { recorder, createRun } = startRun({ analysis: { ...RECORDED_ANALYSIS, questions: [] } });
    const run = await createRun();

    const finished = await run.start({ inputData: { initialRequest: REQUEST } });

    expect(finished.status).toBe('success');
    expect(recorder.startedSessions).toHaveLength(1);
  });

  it('keeps a repository the request did name', async () => {
    const { recorder, createRun } = startRun();
    const run = await createRun();

    await run.start({ inputData: { initialRequest: 'Add a dark mode', owner: 'someone', repository: 'their-app' } });

    expect(recorder.analysisTasks[0]).toContain('someone/their-app');
    expect(recorder.analysisTasks[0]).not.toContain("Jarvis's own codebase");
  });
});

describe('buildCodebaseAnalysisTask', () => {
  it('tells the session the repository is settled, and that it only reads', () => {
    const task = buildCodebaseAnalysisTask(REQUEST, 'ffMathy/hey-jarvis', true);

    expect(task).toContain("ffMathy/hey-jarvis repository — Jarvis's own codebase");
    expect(task).toContain('never ask which one is meant');
    expect(task).toContain('Do not change anything');
  });
});

describe('readCodebaseAnalysis', () => {
  const analysis = { title: 'Dark mode', findings: 'Theme tokens live in one file.', questions: ['Dark by default?'] };

  it('reads the object a session ends its turn on', () => {
    expect(readCodebaseAnalysis(`Done reading.\n\n${JSON.stringify(analysis)}`)).toEqual(analysis);
  });

  it('reads it out of a code fence', () => {
    expect(readCodebaseAnalysis(`Here it is:\n\`\`\`json\n${JSON.stringify(analysis)}\n\`\`\``)).toEqual(analysis);
  });

  it('drops empty questions and keeps at most five', () => {
    const questions = ['One?', ' ', 'Two?', 'Three?', 'Four?', 'Five?', 'Six?'];

    expect(readCodebaseAnalysis(JSON.stringify({ ...analysis, questions })).questions).toEqual([
      'One?',
      'Two?',
      'Three?',
      'Four?',
      'Five?',
    ]);
  });

  it('says what went wrong when there is no object to read', () => {
    expect(() => readCodebaseAnalysis('I could not clone the repository.')).toThrow(
      'did not end with its JSON summary',
    );
  });
});
