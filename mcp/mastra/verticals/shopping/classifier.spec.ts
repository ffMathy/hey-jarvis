/**
 * The shopping classifiers: when a product goes in the basket without the agent, and when an
 * email from Bilka counts as an order change although its subject is not the known one.
 *
 * Declining is always safe -- the agent picks the product, or the email is left alone as before --
 * so what is pinned here is mostly that both decline whenever they are not sure.
 */

import { describe, expect, it } from 'bun:test';
import { Classifier } from '@mastra/core/classifier';
import {
  applicableProductChoices,
  canBeSetInCode,
  chooseProducts,
  ORDER_CHANGE_CONFIDENCE,
  orderChangeFrom,
  PRODUCT_CHOICE_CONFIDENCE,
  type ProductCandidate,
  type ProductChoiceAnswers,
  productChoiceFrom,
  productChoiceQuestions,
  type RequestedProduct,
  reportsOrderChange,
} from './classifier.js';

const CUCUMBER = { objectID: '101', name: 'Agurk', brand: 'Øko', size: '1 stk' };
const MINI_CUCUMBERS = { objectID: '102', name: 'Snackagurker', brand: 'Salling', size: '250 g' };
const MILK_IN_BASKET = { objectID: '201', name: 'Letmælk', brand: 'Arla', size: '1 l', basketQuantity: 1 };

function requested(overrides: Partial<RequestedProduct> = {}): RequestedProduct {
  return { operationType: 'set', name: 'agurk', quantity: 2, unitType: 'stk', ...overrides };
}

/** A complete distribution over `options`, putting `confidence` on `choice`. */
function distribution(options: string[], choice: string, confidence: number): Record<string, number> {
  return Object.fromEntries(
    options.map((option) => [option, option === choice ? confidence : (1 - confidence) / (options.length - 1)]),
  );
}

function productAnswer(choice: string, confidence: number): ProductChoiceAnswers {
  return {
    product: { type: 'choice', choice, probabilities: distribution(['101', '102', 'none'], choice, confidence) },
  };
}

describe('canBeSetInCode', () => {
  it('takes a whole count of something to have', () => {
    expect(canBeSetInCode(requested())).toBe(true);
    expect(canBeSetInCode(requested({ unitType: ' Pakker ' }))).toBe(true);
  });

  it('leaves removals, zeroes, fractions and weights to the agent', () => {
    expect(canBeSetInCode(requested({ operationType: 'remove' }))).toBe(false);
    expect(canBeSetInCode(requested({ operationType: null }))).toBe(false);
    expect(canBeSetInCode(requested({ quantity: 0 }))).toBe(false);
    expect(canBeSetInCode(requested({ quantity: 1.5 }))).toBe(false);
    expect(canBeSetInCode(requested({ quantity: 500, unitType: 'g' }))).toBe(false);
    expect(canBeSetInCode(requested({ quantity: 1, unitType: 'kg' }))).toBe(false);
  });
});

describe('productChoiceQuestions', () => {
  it('offers every candidate by object id, described, plus none', () => {
    const { product } = productChoiceQuestions([CUCUMBER, MILK_IN_BASKET]);

    expect(Object.keys(product.criteria)).toEqual(['101', '201', 'none']);
    expect(product.criteria['101']).toBe('Agurk, Øko, 1 stk');
    expect(product.criteria['201']).toBe('Letmælk, Arla, 1 l (already in the basket, 1 of them)');
    expect(product.criteria.none).toBe('No result is the requested product');
  });
});

describe('productChoiceFrom', () => {
  const CANDIDATE_IDS = new Set(['101', '102']);

  it('takes a product it is sure of', () => {
    expect(productChoiceFrom(productAnswer('101', 0.93), CANDIDATE_IDS)).toBe('101');
  });

  it('leaves the item to the agent when it is not sure enough', () => {
    expect(productChoiceFrom(productAnswer('101', PRODUCT_CHOICE_CONFIDENCE - 0.01), CANDIDATE_IDS)).toBeUndefined();
  });

  it('leaves the item to the agent when it gives no distribution to be sure by', () => {
    expect(productChoiceFrom({ product: { type: 'choice', choice: '101' } }, CANDIDATE_IDS)).toBeUndefined();
  });

  it('leaves the item to the agent when none is the product, however sure it is', () => {
    expect(productChoiceFrom(productAnswer('none', 1), CANDIDATE_IDS)).toBeUndefined();
  });

  it('never picks a product that was not a candidate', () => {
    expect(productChoiceFrom(productAnswer('102', 0.95), new Set(['101']))).toBeUndefined();
  });
});

describe('applicableProductChoices', () => {
  it('leaves two items settled on one product to the agent', () => {
    const choices = [
      { product: 'agurk', candidate: CUCUMBER },
      { product: 'økologisk agurk', candidate: CUCUMBER },
      { product: 'snackagurker', candidate: MINI_CUCUMBERS },
    ];

    expect(applicableProductChoices(choices)).toEqual([{ product: 'snackagurker', candidate: MINI_CUCUMBERS }]);
  });
});

/**
 * A product choice classifier on a fake evaluation model. It picks `choiceFor(state)` at
 * `confidence` over whatever options it was offered, or throws when that is an error.
 */
function fakeProductClassifier(choiceFor: (state: unknown) => string | Error, confidence = 0.95) {
  const evaluated: { state: unknown; options: string[] }[] = [];
  const classifier = new Classifier({
    id: 'productChoiceClassifier',
    model: {
      specificationVersion: 'v4',
      provider: 'fake',
      modelId: 'jev-fake',
      supportedQuestionTypes: ['choice'],
      doEvaluate: async ({ state, questions }) => {
        const question = questions.product;
        const options = question?.type === 'choice' ? Object.keys(question.criteria) : [];
        evaluated.push({ state, options });

        const choice = choiceFor(state);
        if (choice instanceof Error) {
          throw choice;
        }
        return {
          answers: { product: { type: 'choice', choice, probabilities: distribution(options, choice, confidence) } },
          warnings: [],
        };
      },
    },
  });
  return { classifier, evaluated };
}

async function searchCatalogue(searchQuery: string): Promise<ProductCandidate[]> {
  if (searchQuery === 'fejl') {
    throw new Error('Algolia is down');
  }
  return searchQuery === 'agurk' ? [CUCUMBER, MINI_CUCUMBERS] : [];
}

describe('chooseProducts', () => {
  it('asks about each item with the basket and its search results, and returns what it is sure of', async () => {
    const { classifier, evaluated } = fakeProductClassifier(() => '101');
    const cucumbers = requested();

    const choices = await chooseProducts([cucumbers], 'to agurker tak', [MILK_IN_BASKET], searchCatalogue, classifier);

    expect(choices).toEqual([{ product: cucumbers, candidate: CUCUMBER }]);
    expect(evaluated).toEqual([
      {
        state: { requestedProduct: { name: 'agurk', quantity: 2, unit: 'stk' }, userRequest: 'to agurker tak' },
        // Object ids are integer-like keys, which JavaScript orders numerically whatever the insertion order.
        options: ['101', '102', '201', 'none'],
      },
    ]);
  });

  it('can pick the product already in the basket, rather than adding another', async () => {
    const { classifier } = fakeProductClassifier(() => '201');

    const choices = await chooseProducts([requested()], 'agurk', [MILK_IN_BASKET], searchCatalogue, classifier);

    expect(choices.map(({ candidate }) => candidate)).toEqual([MILK_IN_BASKET]);
  });

  it('leaves an item to the agent when it is unsure or answers none', async () => {
    const unsure = fakeProductClassifier(() => '101', PRODUCT_CHOICE_CONFIDENCE - 0.05);
    const none = fakeProductClassifier(() => 'none');

    expect(await chooseProducts([requested()], 'agurk', [], searchCatalogue, unsure.classifier)).toEqual([]);
    expect(await chooseProducts([requested()], 'agurk', [], searchCatalogue, none.classifier)).toEqual([]);
  });

  it('leaves an item to the agent when its search finds nothing or fails, without asking', async () => {
    const { classifier, evaluated } = fakeProductClassifier(() => '101');

    expect(await chooseProducts([requested({ name: 'drage' })], 'drage', [], searchCatalogue, classifier)).toEqual([]);
    expect(await chooseProducts([requested({ name: 'fejl' })], 'fejl', [], searchCatalogue, classifier)).toEqual([]);
    expect(evaluated).toEqual([]);
  });

  it('leaves an item whose classification throws to the agent', async () => {
    const { classifier } = fakeProductClassifier(() => new Error('Jev is down'));

    expect(await chooseProducts([requested()], 'agurk', [], searchCatalogue, classifier)).toEqual([]);
  });

  it('leaves two items settled on the same product to the agent', async () => {
    const { classifier } = fakeProductClassifier(() => '101');

    const choices = await chooseProducts(
      [requested(), requested({ unitType: 'pakke' })],
      'agurk og en pakke agurk',
      [],
      searchCatalogue,
      classifier,
    );

    expect(choices).toEqual([]);
  });
});

/** An order change classifier on a fake evaluation model, answering yes with `probability`. */
function fakeOrderChangeClassifier(probability: number) {
  const evaluatedStates: unknown[] = [];
  const classifier = new Classifier({
    id: 'orderChangeClassifier',
    model: {
      specificationVersion: 'v4',
      provider: 'fake',
      modelId: 'jev-fake',
      supportedQuestionTypes: ['boolean'],
      doEvaluate: async ({ state }) => {
        evaluatedStates.push(state);
        return { answers: { reportsOrderChange: { type: 'boolean', probability } }, warnings: [] };
      },
    },
  });
  return { classifier, evaluatedStates };
}

describe('orderChangeFrom', () => {
  it('counts the email as an order change only when it is sure', () => {
    expect(orderChangeFrom({ reportsOrderChange: { type: 'boolean', probability: 0.97 } })).toBe(true);
    expect(
      orderChangeFrom({ reportsOrderChange: { type: 'boolean', probability: ORDER_CHANGE_CONFIDENCE - 0.01 } }),
    ).toBe(false);
  });
});

describe('reportsOrderChange', () => {
  const EMAIL = { subject: 'Ændringer til din ordre', bodyPreview: 'Vi har erstattet 2 varer' };

  it('shows the classifier the subject and the preview, and reads its answer', async () => {
    const { classifier, evaluatedStates } = fakeOrderChangeClassifier(0.94);

    expect(await reportsOrderChange(EMAIL, classifier)).toBe(true);
    expect(evaluatedStates).toEqual([EMAIL]);
  });

  it('says no when it is not sure', async () => {
    expect(await reportsOrderChange(EMAIL, fakeOrderChangeClassifier(0.5).classifier)).toBe(false);
  });

  it('says no without a classifier, as a missed subject always did', async () => {
    expect(await reportsOrderChange(EMAIL, undefined)).toBe(false);
  });
});
