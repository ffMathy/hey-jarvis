import type { Classifier, ClassifierAnswers } from '@mastra/core/classifier';
import { createLazyClassifier } from '../../utils/index.js';
import { logger } from '../../utils/logger.js';

/**
 * The shopping vertical's decisions that are a choice from a list, asked of an evaluation model
 * (Jev, see `utils/providers/typesafe-provider.ts`) instead of a language model.
 *
 * Two of them. Which catalogue product a shopping list item is, which the mutator agent used to
 * settle in a tool loop -- search, read the hits, pick one, set the basket -- a model round trip
 * per step. And whether an email from Bilka reports changes to an order when its subject is not
 * the one the trigger knows. In both, being unsure costs nothing, because the path that existed
 * before takes over; being wrong costs a wrong product in the basket, or a notification about an
 * email that was not an order change. So both only act above a high bar.
 */

/** Registered on the Mastra instance under this key, so Studio shows its evaluations. */
export const PRODUCT_CHOICE_CLASSIFIER_ID = 'productChoiceClassifier';

/** Registered on the Mastra instance under this key, so Studio shows its evaluations. */
export const ORDER_CHANGE_CLASSIFIER_ID = 'orderChangeClassifier';

/**
 * How sure the classifier must be of a product before it goes in the basket without the agent.
 *
 * High on purpose: below it the agent picks the product as it always did, so the only cost of a
 * high bar is a slower request, while the cost of a low one is the wrong milk.
 */
export const PRODUCT_CHOICE_CONFIDENCE = 0.85;

/**
 * How sure the classifier must be that an email reports changes to an order before the user is
 * notified about it. It is only asked about emails the exact subject match already missed, so
 * below it nothing happens, which is what happened before.
 */
export const ORDER_CHANGE_CONFIDENCE = 0.85;

/** The choice for a search where no result is the product asked for. */
const NO_PRODUCT = 'none';

/**
 * The units a shopping list item can be counted in for its quantity to be the basket's.
 *
 * The basket counts products, so "2 stk agurk" is two in the basket. "500 g hakket oksekød" is
 * not five hundred, and "1 kg kartofler" depends on the size of the bag -- turning a weight or a
 * volume into a count is judgement, which stays with the agent.
 */
const COUNTED_UNITS = new Set([
  'stk',
  'stk.',
  'styk',
  'styks',
  'stykker',
  'pakke',
  'pakker',
  'pk',
  'pk.',
  'pcs',
  'piece',
  'pieces',
  'pack',
  'packs',
]);

/** One item on the shopping list, as it was extracted from the request. */
export interface RequestedProduct {
  operationType: 'set' | 'remove' | null;
  name: string;
  quantity: number;
  unitType: string;
}

/** A product the item could be: a catalogue search result, or one already in the basket. */
export interface ProductCandidate {
  objectID: string;
  name: string;
  brand: string;
  /** How much of it one is, like "1 l", when that is known. */
  size?: string;
  /** How many are in the basket already, for one that is. */
  basketQuantity?: number;
}

/**
 * Whether an item is one the basket quantity can be set for without the agent, once its product
 * is known.
 *
 * Only a count of something to have: a removal is the agent's, since it has to find the product
 * in the basket by what the user called it; a zero is a removal; and a quantity in any unit but a
 * count is the agent's to turn into one.
 */
export function canBeSetInCode(product: RequestedProduct): boolean {
  return (
    product.operationType === 'set' &&
    Number.isInteger(product.quantity) &&
    product.quantity > 0 &&
    COUNTED_UNITS.has(product.unitType.trim().toLowerCase())
  );
}

function describeCandidate(candidate: ProductCandidate): string {
  const description = [candidate.name, candidate.brand, candidate.size].filter(Boolean).join(', ');
  return candidate.basketQuantity === undefined
    ? description
    : `${description} (already in the basket, ${candidate.basketQuantity} of them)`;
}

/** The question for one item, with one option per product it could be, plus none of them. */
export function productChoiceQuestions(candidates: ProductCandidate[]) {
  // Keyed by object id, so the choice is any string and is checked against the candidates when it
  // is read (see `productChoiceFrom`).
  const criteria: Record<string, string> = {
    ...Object.fromEntries(candidates.map((candidate) => [candidate.objectID, describeCandidate(candidate)])),
    [NO_PRODUCT]: 'No result is the requested product',
  };

  return {
    product: {
      type: 'choice' as const,
      instructions:
        'The user asked for this item on their grocery shopping list. Which of these products is it? ' +
        'Prefer one already in the basket when it is the same product. Choose none when no product is ' +
        'what was asked for, or when it is not clear which one was meant.',
      criteria,
    },
  };
}

export type ProductChoiceAnswers = ClassifierAnswers<ReturnType<typeof productChoiceQuestions>>;

/**
 * Reads the classifier's answer into the object id of the product, or into nothing when the agent
 * should pick it.
 *
 * Pure, so every way of declining can be tested without a model.
 */
export function productChoiceFrom(
  answers: ProductChoiceAnswers,
  candidateObjectIds: ReadonlySet<string>,
): string | undefined {
  const { choice, probabilities } = answers.product;
  if (!candidateObjectIds.has(choice)) {
    return undefined;
  }

  // No distribution means no way of knowing how sure it is, which is the same as not being sure.
  if ((probabilities?.[choice] ?? 0) < PRODUCT_CHOICE_CONFIDENCE) {
    return undefined;
  }

  return choice;
}

/** An item and the product the classifier is sure it is. */
export interface ProductChoice<TProduct> {
  product: TProduct;
  candidate: ProductCandidate;
}

/**
 * Keeps the choices that can be applied without the agent.
 *
 * Two items settled on the same product would each set its quantity, and the second would undo
 * the first; which one the user meant is for the agent to work out, so both go to it. Pure, so it
 * can be tested without a model.
 */
export function applicableProductChoices<TProduct>(choices: ProductChoice<TProduct>[]): ProductChoice<TProduct>[] {
  return choices.filter(
    (choice) => choices.filter((other) => other.candidate.objectID === choice.candidate.objectID).length === 1,
  );
}

/** The classifier product choices run on, or nothing when there is no key to run it with. */
export const getProductChoiceClassifier = createLazyClassifier(PRODUCT_CHOICE_CLASSIFIER_ID);

/** Asks the classifier which of the candidates an item is. */
export async function chooseProduct(
  classifier: Classifier,
  product: RequestedProduct,
  userRequest: string,
  candidates: ProductCandidate[],
): Promise<ProductCandidate | undefined> {
  const { answers } = await classifier.evaluate({
    state: {
      requestedProduct: { name: product.name, quantity: product.quantity, unit: product.unitType },
      userRequest,
    },
    questions: productChoiceQuestions(candidates),
  });

  const objectId = productChoiceFrom(answers, new Set(candidates.map((candidate) => candidate.objectID)));
  return candidates.find((candidate) => candidate.objectID === objectId);
}

/**
 * Picks the product for every item the classifier can, each searched for and asked about in
 * parallel with the others.
 *
 * The candidates for an item are what the catalogue finds for it and what is already in the
 * basket, since the agent would have reused a product already there rather than add a second
 * one. An item whose search fails or finds nothing, or that the classifier is unsure of, fails on,
 * or answers none for, is simply not among the choices, and so goes to the agent.
 */
export async function chooseProducts<TProduct extends RequestedProduct>(
  products: TProduct[],
  userRequest: string,
  basket: ProductCandidate[],
  searchCatalogue: (searchQuery: string) => Promise<ProductCandidate[]>,
  classifier: Classifier,
): Promise<ProductChoice<TProduct>[]> {
  const basketObjectIds = new Set(basket.map((candidate) => candidate.objectID));

  const choices = await Promise.all(
    products.map(async (product): Promise<ProductChoice<TProduct> | undefined> => {
      try {
        const searchResults = await searchCatalogue(product.name);
        if (searchResults.length === 0) {
          return undefined;
        }

        const candidates = [
          ...basket,
          ...searchResults.filter((searchResult) => !basketObjectIds.has(searchResult.objectID)),
        ];
        const candidate = await chooseProduct(classifier, product, userRequest, candidates);
        return candidate && { product, candidate };
      } catch (error: unknown) {
        logger.warn('Choosing a product without the agent failed; leaving it to the agent', { error });
        return undefined;
      }
    }),
  );

  return applicableProductChoices(choices.filter((choice) => choice !== undefined));
}

const ORDER_CHANGE_QUESTIONS = {
  reportsOrderChange: {
    type: 'boolean' as const,
    instructions:
      'This is an email from a grocery delivery service. Does this email report changes to a grocery order, ' +
      'like products that were replaced, removed or out of stock?',
  },
};

export type OrderChangeAnswers = ClassifierAnswers<typeof ORDER_CHANGE_QUESTIONS>;

/** Reads the classifier's answer into whether the email reports an order change. Pure. */
export function orderChangeFrom(answers: OrderChangeAnswers): boolean {
  return answers.reportsOrderChange.probability >= ORDER_CHANGE_CONFIDENCE;
}

/** The classifier the order change trigger runs on, or nothing when there is no key to run it with. */
export const getOrderChangeClassifier = createLazyClassifier(ORDER_CHANGE_CLASSIFIER_ID);

/** What the classifier is shown of an email from the grocery service. */
export interface OrderEmail {
  subject: string;
  bodyPreview: string;
}

/**
 * Asks whether an email reports changes to a grocery order.
 *
 * Without a classifier the answer is no, which is what an email the subject match missed always
 * got.
 */
export async function reportsOrderChange(
  email: OrderEmail,
  classifier: Classifier | undefined = getOrderChangeClassifier(),
): Promise<boolean> {
  if (!classifier) {
    return false;
  }

  const { answers } = await classifier.evaluate({
    state: { subject: email.subject, bodyPreview: email.bodyPreview },
    questions: ORDER_CHANGE_QUESTIONS,
  });

  return orderChangeFrom(answers);
}
