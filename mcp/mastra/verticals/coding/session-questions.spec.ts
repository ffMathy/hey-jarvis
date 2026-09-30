import { describe, expect, it } from 'bun:test';
import {
  buildSessionQuestionInstructions,
  readProseQuestion,
  readSessionQuestion,
  SESSION_QUESTION_FENCE,
} from './session-questions.js';

describe('readSessionQuestion', () => {
  it('reads the question a turn ended on', () => {
    expect(readSessionQuestion('I read the code.\n\n```jarvis-question\nDanish, or English?\n```')).toBe(
      'Danish, or English?',
    );
  });

  it('reads nothing from a turn that did not ask', () => {
    expect(readSessionQuestion('Done. ```jarvis-pull-request\n{"branch": "jarvis/x"}\n```')).toBeUndefined();
  });

  it('reads nothing from an empty block', () => {
    expect(readSessionQuestion('```jarvis-question\n\n```')).toBeUndefined();
  });

  it('takes the last block, when the message mentioned the block before writing it', () => {
    const message = 'I will end on a ```jarvis-question``` block.\n\n```jarvis-question\nDark by default?\n```';

    expect(readSessionQuestion(message)).toBe('Dark by default?');
  });

  it('reads a block whose closing fence is missing', () => {
    expect(readSessionQuestion('```jarvis-question\nDark by default?')).toBe('Dark by default?');
  });

  it('keeps a question short enough to be read aloud', () => {
    expect(readSessionQuestion(`\`\`\`jarvis-question\n${'why '.repeat(200)}\n\`\`\``)?.length).toBeLessThanOrEqual(
      300,
    );
  });
});

describe('buildSessionQuestionInstructions', () => {
  it('tells the session to implement straight away when nothing is left to ask', () => {
    expect(buildSessionQuestionInstructions()).toContain('go straight on and implement the change without asking');
  });

  it('shows the block the session asks with', () => {
    expect(buildSessionQuestionInstructions()).toContain(`\`\`\`${SESSION_QUESTION_FENCE}`);
  });
});

describe('readProseQuestion', () => {
  it('takes the last paragraph, on one line', () => {
    expect(readProseQuestion('I read the code.\n\nShould the greeting be\nin Danish, or English?\n')).toBe(
      'Should the greeting be in Danish, or English?',
    );
  });

  it('reads nothing from a message with no text', () => {
    expect(readProseQuestion('')).toBeUndefined();
    expect(readProseQuestion(' \n\n ')).toBeUndefined();
  });

  it('keeps the closing sentences of a long paragraph, where the question is', () => {
    const opening = 'I looked through the notification routing and the settings it reads. '.repeat(5);
    const question = readProseQuestion(`${opening}Should it be email, or a push notification?`);

    expect(question?.endsWith('Should it be email, or a push notification?')).toBe(true);
    expect(question?.length).toBeLessThanOrEqual(300);
    expect(question?.startsWith('I looked')).toBe(true);
  });

  it('cuts a single overlong sentence on a word', () => {
    const question = readProseQuestion(`Should it ${'really '.repeat(60)}be email?`);

    expect(question?.length).toBeLessThanOrEqual(300);
    expect(question?.endsWith('...')).toBe(true);
    expect(question).not.toContain('reall...');
  });
});
