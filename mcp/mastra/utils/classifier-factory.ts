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
 * Built lazily because the key is read when it is built, and a module that is only imported
 * should not decide whether there is one. Kept to one instance so that the classifier registered
 * on the Mastra instance, which is what Studio traces, is the same one the code evaluates with.
 */
export function createLazyClassifier(id: string): () => Classifier | undefined {
  let classifier: Classifier | undefined;
  let classifierBuilt = false;

  return () => {
    if (!classifierBuilt) {
      classifier = createClassifier(id);
      classifierBuilt = true;
    }
    return classifier;
  };
}
