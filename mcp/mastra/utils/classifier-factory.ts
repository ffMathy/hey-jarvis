import { Classifier } from '@mastra/core/classifier';
import { getEvaluationModel, isEvaluationModelConfigured } from './providers/typesafe-provider.js';

/**
 * Builds a classifier on Jev, or nothing when there is no key to run one with.
 *
 * A classifier here is always a shortcut in front of a language model that could make the same
 * decision more slowly, so returning nothing is not a failure: the caller takes the slow path it
 * had before. That is also why the questions are left to each call rather than fixed here -- the
 * decisions worth classifying tend to depend on what is true right now, like which questions are
 * still waiting on the user.
 */
export function createClassifier(id: string): Classifier | undefined {
  if (!isEvaluationModelConfigured()) {
    return undefined;
  }

  return new Classifier({ id, model: getEvaluationModel() });
}

/**
 * A getter for one classifier per process, built the first time it is asked for.
 *
 * Built lazily rather than at import, so a module that only needs a pure policy function from
 * the same file never touches the key. One instance per getter, so the classifier registered on
 * the Mastra instance -- which is what makes Studio trace its evaluations -- is the same one the
 * calls go through.
 */
export function createLazyClassifier(id: string): () => Classifier | undefined {
  let classifier: Classifier | undefined;
  let built = false;

  return () => {
    if (!built) {
      classifier = createClassifier(id);
      built = true;
    }
    return classifier;
  };
}
