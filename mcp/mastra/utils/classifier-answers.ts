import type { BooleanAnswer, ChoiceAnswer, ScoreAnswer } from '@mastra/core/classifier';

/**
 * Reading a classifier's answers as things it is sure of, or as nothing.
 *
 * Every classifier here is a shortcut in front of a path that already works, so an answer is
 * only worth acting on when the model is sure of it. These helpers draw that line the same way
 * everywhere: an answer counts when its probability reaches the bar, and an answer that came
 * without a distribution counts as unsure, because there is nothing to tell how sure it was.
 */

/** The option a choice question picked, when it is at least `confidence` sure of it. */
export function confidentChoice<OPTION extends string>(
  answer: ChoiceAnswer<OPTION>,
  confidence: number,
): OPTION | undefined {
  return (answer.probabilities?.[answer.choice] ?? 0) >= confidence ? answer.choice : undefined;
}

/**
 * The level of a score question the model is at least `confidence` sure of.
 *
 * A score's probabilities are keyed by the level's index as a string ("0", "1", ...), in the
 * order its criteria were given, which is the order `levels` has to name them in. The score
 * itself is the probability-weighted mean, so it can land between two levels the model is torn
 * between; the distribution is what says whether one of them is a sure thing.
 */
export function confidentScoreLevel<LEVEL>(
  answer: ScoreAnswer,
  levels: readonly LEVEL[],
  confidence: number,
): LEVEL | undefined {
  return levels.find((_level, index) => (answer.probabilities?.[String(index)] ?? 0) >= confidence);
}

/** Any one answer, before it is known which kind of question it answers. */
export type AnyClassifierAnswer = ChoiceAnswer | ScoreAnswer | BooleanAnswer;

/** Answers keyed by question, as a reader that did not write the questions sees them. */
export type ClassifierAnswerSet = Readonly<Record<string, AnyClassifierAnswer | undefined>>;

/** The answer to a choice question, or `undefined` when the question was not asked as one. */
export function choiceAnswerIn(answers: ClassifierAnswerSet, questionId: string): ChoiceAnswer | undefined {
  const answer = answers[questionId];
  return answer?.type === 'choice' ? answer : undefined;
}

/** The answer to a yes/no question, or `undefined` when the question was not asked as one. */
export function booleanAnswerIn(answers: ClassifierAnswerSet, questionId: string): BooleanAnswer | undefined {
  const answer = answers[questionId];
  return answer?.type === 'boolean' ? answer : undefined;
}
