import type { BooleanAnswer, ChoiceAnswer, RefusalAnswer, ScoreAnswer } from '@mastra/core/classifier';

/**
 * Reading a classifier's answers as things it is sure of, or as nothing.
 *
 * Every classifier here is a shortcut in front of a path that already works, so an answer is
 * only worth acting on when the model is sure of it. These helpers draw that line the same way
 * everywhere: an answer counts when its probability reaches the bar, and an answer that came
 * without a distribution counts as unsure, because there is nothing to tell how sure it was.
 *
 * A refusal -- the decision model declining to answer a question at all -- is unsure too, and is
 * read as such here and nowhere else: every helper below turns one into nothing, so a caller takes
 * the slow path it took before there was a classifier, exactly as it does for an unsure answer.
 */

/** The option a choice question picked, when it is at least `confidence` sure of it. */
export function confidentChoice<OPTION extends string>(
  answer: ChoiceAnswer<OPTION> | RefusalAnswer,
  confidence: number,
): OPTION | undefined {
  if (answer.type === 'refusal') {
    return undefined;
  }
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
  answer: ScoreAnswer | RefusalAnswer,
  levels: readonly LEVEL[],
  confidence: number,
): LEVEL | undefined {
  if (answer.type === 'refusal') {
    return undefined;
  }
  return levels.find((_level, index) => (answer.probabilities?.[String(index)] ?? 0) >= confidence);
}

/**
 * The probability of yes a yes/no question was answered with, or `undefined` when it was declined
 * (or not asked).
 *
 * For a caller that draws its own line, like "above the bar" rather than "at or above it"; one
 * that wants yes or no should use {@link confidentBoolean}.
 */
export function probabilityOfYes(answer: BooleanAnswer | RefusalAnswer | undefined): number | undefined {
  return answer?.type === 'boolean' ? answer.probability : undefined;
}

/**
 * Yes or no, when the model is at least `confidence` sure of it either way: yes at or above the
 * bar, no at or below `1 - confidence`. `undefined` in between, and for a question it declined
 * (or that was not asked).
 *
 * @param confidence - Above one half, so that yes and no can never both be sure
 */
export function confidentBoolean(
  answer: BooleanAnswer | RefusalAnswer | undefined,
  confidence: number,
): boolean | undefined {
  const probability = probabilityOfYes(answer);
  if (probability === undefined) {
    return undefined;
  }
  if (probability >= confidence) {
    return true;
  }
  if (probability <= 1 - confidence) {
    return false;
  }
  return undefined;
}

/** Any one answer, before it is known which kind of question it answers, or whether it was refused. */
export type AnyClassifierAnswer = ChoiceAnswer | ScoreAnswer | BooleanAnswer | RefusalAnswer;

/** Answers keyed by question, as a reader that did not write the questions sees them. */
export type ClassifierAnswerSet = Readonly<Record<string, AnyClassifierAnswer | undefined>>;

/**
 * The answer to a choice question, or `undefined` when the question was not asked as one or the
 * model declined to answer it.
 */
export function choiceAnswerIn(answers: ClassifierAnswerSet, questionId: string): ChoiceAnswer | undefined {
  const answer = answers[questionId];
  return answer?.type === 'choice' ? answer : undefined;
}

/**
 * The answer to a yes/no question, or `undefined` when the question was not asked as one or the
 * model declined to answer it.
 */
export function booleanAnswerIn(answers: ClassifierAnswerSet, questionId: string): BooleanAnswer | undefined {
  const answer = answers[questionId];
  return answer?.type === 'boolean' ? answer : undefined;
}
