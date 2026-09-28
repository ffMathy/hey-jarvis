import { describe, expect, it } from 'bun:test';
import { buildSessionQuestionInstructions, readSessionQuestion, SESSION_QUESTION_FENCE } from './session-questions.js';

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
    expect(readSessionQuestion(`\`\`\`jarvis-question\n${'why '.repeat(200)}\n\`\`\``)?.length).toBeLessThanOrEqual(300);
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
