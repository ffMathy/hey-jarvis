import { TZDate } from '@date-fns/tz';
import { differenceInMonths } from 'date-fns';
import { HOUSEHOLD_TIME_ZONE } from '../../utils/household.js';

/**
 * The household's baby, how old it is, and what the Danish Health Authority says a baby of that
 * age can be given from the family's dinner.
 *
 * Every piece of advice comes from "Mad til små – fra mælk til familiens mad" (Sundhedsstyrelsen,
 * Fødevarestyrelsen and Komiteen for Sundhedsoplysning, 5th edition, 2020) and names the pages it
 * is on, so each can be checked against the book. Each holds for an age window: the guidance for a
 * day is every piece whose window holds the baby's age that day, so the advice grows up with the
 * baby without anyone touching it.
 */

/**
 * The variable the baby's birth date is read from, as `YYYY-MM-DD`.
 *
 * Kept in 1Password and resolved through `mcp/op.optional.env`, never written into the code: the
 * repository is public, and a Danish birth date is the first six digits of a CPR number.
 */
export const BABY_BIRTH_DATE_VARIABLE = 'HEY_JARVIS_BABY_BIRTH_DATE';

/** Before this age a baby has nothing but milk, so there is nothing of the dinner to share (p. 7). */
export const FIRST_FOOD_AGE_MONTHS = 4;

/** What a piece of advice is about, in the order the guidance lists them. */
const ADVICE_SECTIONS = ['eating', 'choosing', 'preparing', 'limits', 'keeping'] as const;

type AdviceSection = (typeof ADVICE_SECTIONS)[number];

const SECTION_HEADINGS = {
  eating: 'How the baby eats now',
  choosing: 'Choosing dinners it can share',
  preparing: 'Preparing its portion',
  limits: 'What it must not have yet, or only a little of',
  keeping: 'Keeping and reheating its food',
} satisfies Record<AdviceSection, string>;

interface BabyFoodAdvice {
  readonly section: AdviceSection;
  readonly text: string;
  /** The pages of "Mad til små" it rests on. */
  readonly pages: readonly number[];
  /** The age, in whole months, it starts to hold at. */
  readonly fromMonths: number;
  /** The age it stops holding at; it holds for good when there is none. */
  readonly untilMonths?: number;
}

/** Tinned tuna waits until 3 years, and so does gnawing on hard raw food (pp. 29, 94). */
const THREE_YEARS = 36;

/** Tuna steaks and the other large predatory fish wait until 14 years (pp. 94, 100). */
const FOURTEEN_YEARS = 168;

export const BABY_FOOD_ADVICE: readonly BabyFoodAdvice[] = [
  // How it eats
  {
    section: 'eating',
    fromMonths: 4,
    untilMonths: 6,
    pages: [13, 14],
    text: 'It is just starting on food besides milk, a few small tastes at a time: thin, creamy porridge or smooth potato-and-vegetable mash without lumps, made thicker and then mashed with a fork as it gets used to the spoon',
  },
  {
    section: 'eating',
    fromMonths: 6,
    untilMonths: 8,
    pages: [18],
    text: 'Besides breast or bottle it has 2 meals a day at the start of this period and 3-4 by its end. Its appetite decides how much it eats, and it is never pressed to eat more',
  },
  {
    section: 'eating',
    fromMonths: 6,
    untilMonths: 8,
    pages: [17, 21],
    text: 'Its food is made coarser and firmer quickly: mash is coarse now, and once it can chew, boiled, steamed or oven-baked vegetables are cut into small pieces',
  },
  {
    section: 'eating',
    fromMonths: 6,
    untilMonths: 12,
    pages: [17, 25],
    text: 'It eats with its fingers, helped with a spoon so it gets enough',
  },
  {
    section: 'eating',
    fromMonths: 8,
    untilMonths: 9,
    pages: [18],
    text: 'It chews well now and manages small, soft pieces: soft bits of boiled vegetables, soft fruit such as banana, and soft rye bread with a spread',
  },
  {
    section: 'eating',
    fromMonths: 8,
    untilMonths: 12,
    pages: [24],
    text: 'It has 5-6 meals a day',
  },
  {
    section: 'eating',
    fromMonths: 9,
    untilMonths: 12,
    pages: [25, 26],
    text: 'It eats with the family at almost every meal, as long as the food is soft and cut into suitable pieces: soft, but coarse enough to chew on',
  },
  {
    section: 'eating',
    fromMonths: 12,
    untilMonths: 24,
    pages: [31],
    text: 'It eats all kinds of food, cooked in all kinds of ways. Finger food is still important, and it practises with a spoon and fork',
  },
  {
    section: 'eating',
    fromMonths: 24,
    pages: [92],
    text: "It eats the family's food, which follows the official dietary advice",
  },

  // Choosing the dinners
  {
    section: 'choosing',
    fromMonths: 4,
    untilMonths: 6,
    pages: [11, 14, 21],
    text: 'Only the potatoes and vegetables of a dinner are for it yet, so any dinner with potatoes or vegetables cooked with little salt will do',
  },
  {
    section: 'choosing',
    fromMonths: 6,
    untilMonths: 9,
    pages: [21, 103],
    text: 'It needs meat or fish every day for its iron, so a dinner with meat, poultry or fish is the one to share',
  },
  {
    section: 'choosing',
    fromMonths: 9,
    pages: [27, 103, 108],
    text: 'Meat, poultry or fish at most dinners gives it the iron and zinc it needs; pulses or eggs can stand in for them in a vegetarian dinner',
  },
  {
    section: 'choosing',
    fromMonths: 6,
    pages: [21, 27, 94],
    text: 'It has fish as the main course at least twice a week, varying fat fish (salmon, herring, mackerel) and lean fish (cod, saithe, plaice), with prawns and mussels now and then. When a week is two dinners that each last several days, make one of them a fish dinner',
  },
  {
    section: 'choosing',
    fromMonths: 4,
    pages: [29, 107],
    text: 'It must not have rice every day, because of arsenic: never two dinners in the same week that are both served with rice',
  },
  {
    section: 'choosing',
    fromMonths: 4,
    pages: [34, 96, 106],
    text: 'It cannot share a diet dish, one especially rich in protein, low in carbohydrate or low in fat',
  },
  {
    section: 'choosing',
    fromMonths: 4,
    pages: [27, 47],
    text: 'Dishes whose parts can be served side by side (meat or fish, potatoes, rice or pasta, vegetables) are the easiest to share. A dish is still fine when its chili or most of its salt can be added after its portion is set aside',
  },

  // Preparing its portion
  {
    section: 'preparing',
    fromMonths: 4,
    untilMonths: 6,
    pages: [11, 14],
    text: 'Its potatoes and vegetables are mashed smooth',
  },
  {
    section: 'preparing',
    fromMonths: 6,
    untilMonths: 9,
    pages: [20, 21],
    text: "Meat: mince to begin with, for instance from the family's own dinner, mixed into its vegetable mash. Meat too firm for it, such as chicken or chops, is blended with a little of its cooking water. Whole soft pieces are blended at first, and cut into pea-sized bits by the end of this period",
  },
  {
    section: 'preparing',
    fromMonths: 6,
    untilMonths: 9,
    pages: [21],
    text: 'Fish is steamed, boiled or oven-baked; fried fish waits until it is 9 months',
  },
  {
    section: 'preparing',
    fromMonths: 6,
    untilMonths: 8,
    pages: [20],
    text: 'Boiled and oven-cooked food is softest. Pan-fried or pot-roasted meat, fish and vegetables wait until it chews well enough to break them up between its gums',
  },
  {
    section: 'preparing',
    fromMonths: 6,
    pages: [20, 94],
    text: 'Hard vegetables such as carrot, cauliflower, broccoli and Brussels sprouts are boiled first, grated or finely shredded; soft ones (peas, sweetcorn, peeled tomato, cucumber, avocado) can be given fresh, cut small',
  },
  {
    section: 'preparing',
    fromMonths: 8,
    untilMonths: 12,
    pages: [22, 27],
    text: 'A warm meal for it is potatoes, now and then rice, pasta or bulgur; vegetables; meat, fish, pulses or egg; a little fat as a sauce or dressing; and fruit for dessert',
  },
  {
    section: 'preparing',
    fromMonths: 9,
    untilMonths: 12,
    pages: [27],
    text: 'Fillets, chops and other cuts are cut into small pieces, with the fried or roasted edges cut away so it gets the soft meat inside. Raw vegetables are fine too: finely grated carrot, or peas, sweetcorn, cucumber and pepper in pea-sized cubes',
  },
  {
    section: 'preparing',
    fromMonths: 6,
    pages: [27, 47],
    text: 'Its plate has the parts of the dinner side by side, not mixed together, cut into small bite-sized pieces, so it can see and choose what it eats',
  },
  {
    section: 'preparing',
    fromMonths: 4,
    untilMonths: 12,
    pages: [12, 22, 96],
    text: 'Its food must not be low in fat: a little oil, butter or a blend in its mash, and fat as a sauce or dressing',
  },
  {
    section: 'preparing',
    fromMonths: 6,
    untilMonths: 12,
    pages: [104],
    text: "Milk, cream and cheese cooked into the family's food are fine; only milk to drink waits until it is 1 year",
  },
  {
    section: 'preparing',
    fromMonths: 12,
    pages: [34],
    text: 'It needs no more fat than the rest of the family',
  },
  {
    section: 'preparing',
    fromMonths: 12,
    pages: [32],
    text: 'Its plate is about 2/5 vegetables, 2/5 bread, potatoes, rice or pasta, and 1/5 meat, fish, egg or cheese, with fruit beside it. A stew has at least twice as much vegetables as meat',
  },
  {
    section: 'preparing',
    fromMonths: 12,
    pages: [33],
    text: 'Cook a little extra of the dinner for it, such as meatballs, chicken or fish cakes, for its lunch the next day, and set that aside straight away',
  },
  {
    section: 'preparing',
    fromMonths: 4,
    pages: [20, 64, 66, 74],
    text: "It should learn many tastes, sour and bitter too, and the family's spices are fine: the book's own family dinners use garlic, curry, cumin, ginger and pepper. Chili at most as a hint, and it can be left out",
  },

  // What it must not have
  {
    section: 'limits',
    fromMonths: 4,
    untilMonths: 6,
    pages: [11, 21],
    text: 'No meat, fish or egg until it is 6 months',
  },
  {
    section: 'limits',
    fromMonths: 4,
    untilMonths: 6,
    pages: [11, 105],
    text: 'No spinach, beetroot, fennel or celery until it is 6 months',
  },
  {
    section: 'limits',
    fromMonths: 6,
    untilMonths: 12,
    pages: [105],
    text: 'Spinach, beetroot, fennel and celery only as about a tenth of its portion, because of nitrate; a dish where they are more than that, only about every 14 days',
  },
  {
    section: 'limits',
    fromMonths: 4,
    pages: [14, 20, 96],
    text: 'No salt added to its food: potatoes, rice, pasta and vegetables are cooked with only a little salt, the rest of the dinner is salted lightly or after its portion is set aside, and salty dishes and salty meat and fish products stay out of its share',
  },
  {
    section: 'limits',
    fromMonths: 4,
    untilMonths: 12,
    pages: [102],
    text: 'No honey in anything it eats, cooked or not, until it is 1 year, because of infant botulism',
  },
  {
    section: 'limits',
    fromMonths: 4,
    untilMonths: THREE_YEARS,
    pages: [94, 100],
    text: 'No tinned tuna until it is 3 years; after that at most one ordinary tin a week, and never white or albacore tuna',
  },
  {
    section: 'limits',
    fromMonths: 4,
    untilMonths: FOURTEEN_YEARS,
    pages: [94, 100],
    text: 'No tuna steaks or other large predatory fish, because of mercury: pike, halibut, swordfish, perch, zander, oilfish, escolar, ray and shark',
  },
  {
    section: 'limits',
    fromMonths: 6,
    pages: [21, 22],
    text: 'Meat cooked through, never raw inside. Eggs only hard-boiled or cooked through, as in mince, bakes or egg pancakes; an omelette or scrambled egg only from pasteurised eggs. Every fish bone removed',
  },
  {
    section: 'limits',
    fromMonths: 4,
    pages: [101],
    text: 'No raw herbs or leafy greens sprinkled on its warm food; in a warm dish only when boiled thoroughly in it, or baked into mince that is cooked through',
  },
  {
    section: 'limits',
    fromMonths: 4,
    pages: [23, 29, 94, 108],
    text: 'Nothing it can choke on: soft food in small pieces, someone watching it through the whole meal, grapes cut lengthwise with the seeds out, nuts and oily seeds only finely chopped, and no popcorn or peanuts',
  },
  {
    section: 'limits',
    fromMonths: 4,
    untilMonths: THREE_YEARS,
    pages: [29],
    text: 'No hard raw food to gnaw on, such as whole raw carrots or carrot sticks, until it is about 3 years',
  },
  {
    section: 'limits',
    fromMonths: 4,
    untilMonths: 9,
    pages: [25, 106],
    text: 'No yoghurt or A38 until it is 9 months',
  },
  {
    section: 'limits',
    fromMonths: 9,
    untilMonths: 12,
    pages: [25, 106],
    text: 'Whole-milk yoghurt or A38 at most ½ dl a day, rising to 1 dl by 1 year',
  },
  {
    section: 'limits',
    fromMonths: 4,
    untilMonths: 24,
    pages: [29, 106],
    text: 'No skyr, fromage frais, ymer, ylette, quark or cottage cheese until it is 2 years, since they are too rich in protein',
  },
  {
    section: 'limits',
    fromMonths: 4,
    pages: [29, 107],
    text: 'No rice drinks or rice cakes',
  },
  {
    section: 'limits',
    fromMonths: 4,
    pages: [103],
    text: 'Only a little cinnamon',
  },
  {
    section: 'limits',
    fromMonths: 4,
    untilMonths: THREE_YEARS,
    pages: [107],
    text: 'Raisins at most about 50 g a week',
  },
  {
    section: 'limits',
    fromMonths: 4,
    pages: [94, 104],
    text: 'Bread without whole or halved kernels and seeds',
  },
  {
    section: 'limits',
    fromMonths: 4,
    pages: [100, 102],
    text: 'Frozen berries are boiled for a minute before use, and elderberries are never eaten raw, only boiled for 15-20 minutes',
  },

  // Keeping and reheating
  {
    section: 'keeping',
    fromMonths: 4,
    pages: [106, 107],
    text: 'Before the dinner is served, take out the portions for the coming days and put them in the fridge at once. Food that is kept must be cooled to 10 °C within 3 hours',
  },
  {
    section: 'keeping',
    fromMonths: 4,
    pages: [12, 105, 107],
    text: 'Its food is never kept warm for later: it is reheated until it boils, stirred so all of it boils (a microwave heats unevenly), and left to cool so it is not too hot',
  },
  {
    section: 'keeping',
    fromMonths: 4,
    pages: [107],
    text: 'What it leaves on its plate is thrown away, and so are leftovers that had raw herbs sprinkled on them',
  },
  {
    section: 'keeping',
    fromMonths: 4,
    pages: [100, 101],
    text: 'Its portions can be frozen in meal-sized amounts, for at most 1 month at -18 °C. Meat and fish are thawed in the fridge, and nothing is frozen again once thawed',
  },
];

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The variable's value, refused when it is not a day that has already begun on the household's clock. */
function parseBirthDate(value: string, now: Date): TZDate {
  const match = ISO_DATE.exec(value);
  const [year, month, day] = match ? match.slice(1).map(Number) : [Number.NaN, Number.NaN, Number.NaN];
  const birthDate = new TZDate(year, month - 1, day, HOUSEHOLD_TIME_ZONE);

  // A day that does not exist, such as the 30th of February, rolls over into the next month.
  const isRealDay =
    birthDate.getFullYear() === year && birthDate.getMonth() === month - 1 && birthDate.getDate() === day;
  if (!isRealDay || birthDate.getTime() > now.getTime()) {
    throw new Error(`${BABY_BIRTH_DATE_VARIABLE} must be the baby's birth date, written YYYY-MM-DD`);
  }

  return birthDate;
}

/**
 * The baby's birth date, at midnight on the household's clock, or `undefined` when the household
 * has none configured.
 *
 * @throws when the variable is set to anything but a date that has passed: a meal plan meant to
 * feed a baby must not quietly turn into one for adults. The message never repeats the value.
 */
export function readBabyBirthDate(
  environment: Record<string, string | undefined> = process.env,
  now = new Date(),
): TZDate | undefined {
  const value = environment[BABY_BIRTH_DATE_VARIABLE]?.trim();
  return value ? parseBirthDate(value, now) : undefined;
}

/**
 * Why the cooking vertical leaves the baby out, or fails, for the one line the MCP server logs at
 * startup — or `undefined` when the baby is included. Names the variable, never its value.
 */
export function whyBabyMealsAreOff(environment: Record<string, string | undefined> = process.env): string | undefined {
  try {
    return readBabyBirthDate(environment)
      ? undefined
      : `Meal plans and recipe suggestions leave the baby out: ${BABY_BIRTH_DATE_VARIABLE} is not set.`;
  } catch {
    // Translated rather than rethrown: this only reports, at startup, what every cooking request
    // will then refuse with the same error.
    return `Cooking requests and meal plans will fail: ${BABY_BIRTH_DATE_VARIABLE} is not a birth date written YYYY-MM-DD.`;
  }
}

/** How many whole months old the baby is, counted on the household's clock. */
export function babyAgeInMonths(birthDate: TZDate, now: Date): number {
  return differenceInMonths(new TZDate(now, HOUSEHOLD_TIME_ZONE), birthDate);
}

/** The advice that holds for a baby of `ageInMonths`, in the book's order. */
export function babyFoodAdviceAt(ageInMonths: number): BabyFoodAdvice[] {
  return BABY_FOOD_ADVICE.filter(
    (advice) =>
      ageInMonths >= advice.fromMonths && (advice.untilMonths === undefined || ageInMonths < advice.untilMonths),
  );
}

function describeAge(ageInMonths: number): string {
  if (ageInMonths < 24) {
    return `${ageInMonths} months old`;
  }
  return `${Math.floor(ageInMonths / 12)} years old`;
}

/**
 * What the agents planning or suggesting dinners are told about the baby on `now`, or `undefined`
 * when it is too young to eat anything from the dinner.
 */
export function babyMealGuidance(birthDate: TZDate, now: Date): string | undefined {
  const ageInMonths = babyAgeInMonths(birthDate, now);
  if (ageInMonths < FIRST_FOOD_AGE_MONTHS) {
    return undefined;
  }

  const advice = babyFoodAdviceAt(ageInMonths);
  const sections = ADVICE_SECTIONS.flatMap((section) => {
    const lines = advice.filter((piece) => piece.section === section).map((piece) => `- ${piece.text}`);
    return lines.length > 0 ? [`${SECTION_HEADINGS[section]}:\n${lines.join('\n')}`] : [];
  });

  return `# The baby
The household has a baby who is ${describeAge(ageInMonths)} and eats from the family's dinners. Follow the Danish Health Authority's advice for a baby of this age, from "Mad til små - fra mælk til familiens mad" (Sundhedsstyrelsen, 2020). The dinners stay proper adult food; the advice is about the baby's share of them.

${sections.join('\n\n')}`;
}

/**
 * The guidance for the household's baby right now, read afresh on every call: the server runs for
 * days, and the baby keeps growing. `undefined` when there is no baby to plan for.
 */
export function currentBabyMealGuidance(
  now = new Date(),
  environment: Record<string, string | undefined> = process.env,
): string | undefined {
  const birthDate = readBabyBirthDate(environment, now);
  return birthDate ? babyMealGuidance(birthDate, now) : undefined;
}
