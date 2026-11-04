/**
 * How old the household's baby is, and which of "Mad til små"'s advice holds at that age.
 *
 * The birth date here is made up. The household's own is kept in 1Password and never written into
 * the repository, which is public.
 */

import { describe, expect, it } from 'bun:test';
import {
  BABY_BIRTH_DATE_VARIABLE,
  BABY_FOOD_ADVICE,
  babyAgeInMonths,
  babyFoodAdviceAt,
  babyMealGuidance,
  currentBabyMealGuidance,
  readBabyBirthDate,
  whyBabyMealsAreOff,
} from './baby-food.js';

const EXAMPLE_BIRTH_DATE = '2025-03-15';
const configured = { [BABY_BIRTH_DATE_VARIABLE]: EXAMPLE_BIRTH_DATE };

/** The example baby's birth date, as the cooking vertical reads it. */
function exampleBirthDate() {
  const birthDate = readBabyBirthDate(configured, new Date('2026-01-01T00:00:00Z'));
  if (!birthDate) throw new Error('the example birth date did not parse');
  return birthDate;
}

/** The advice for a baby of `ageInMonths` whose text mentions `words`, ignoring case. */
function adviceMentioning(ageInMonths: number, words: string) {
  return babyFoodAdviceAt(ageInMonths).filter((advice) => advice.text.toLowerCase().includes(words.toLowerCase()));
}

describe('readBabyBirthDate', () => {
  it('has no baby when the variable is unset or blank', () => {
    expect(readBabyBirthDate({})).toBeUndefined();
    expect(readBabyBirthDate({ [BABY_BIRTH_DATE_VARIABLE]: '  ' })).toBeUndefined();
  });

  it("reads the date as midnight on the household's clock", () => {
    expect(exampleBirthDate().toISOString()).toBe('2025-03-14T23:00:00.000Z');
  });

  it('refuses anything but a past date written YYYY-MM-DD, without repeating it', () => {
    const now = new Date('2026-01-01T00:00:00Z');

    for (const value of ['15/03/2025', '2025-02-30', '2025-3-15', 'some day', '2026-06-01']) {
      const read = () => readBabyBirthDate({ [BABY_BIRTH_DATE_VARIABLE]: value }, now);

      expect(read).toThrow(BABY_BIRTH_DATE_VARIABLE);
      expect(read).not.toThrow(value);
    }
  });
});

describe('whyBabyMealsAreOff', () => {
  it('names the variable when no baby is configured', () => {
    expect(whyBabyMealsAreOff({})).toContain(BABY_BIRTH_DATE_VARIABLE);
  });

  it('says nothing when the birth date reads', () => {
    expect(whyBabyMealsAreOff(configured)).toBeUndefined();
  });

  it('warns that cooking will fail on a date it cannot read, without printing it', () => {
    const warning = whyBabyMealsAreOff({ [BABY_BIRTH_DATE_VARIABLE]: '15-03-2025' });

    expect(warning).toContain('will fail');
    expect(warning).not.toContain('15-03-2025');
  });
});

describe('babyAgeInMonths', () => {
  it("turns a month older at midnight on the household's clock, not the server's", () => {
    // 22:00 UTC is midnight in Copenhagen in September.
    expect(babyAgeInMonths(exampleBirthDate(), new Date('2025-09-14T21:59:00Z'))).toBe(5);
    expect(babyAgeInMonths(exampleBirthDate(), new Date('2025-09-14T22:00:00Z'))).toBe(6);
  });
});

describe('BABY_FOOD_ADVICE', () => {
  it('cites a page of the book for every piece, and holds for some age', () => {
    for (const advice of BABY_FOOD_ADVICE) {
      expect(advice.pages.length).toBeGreaterThan(0);
      for (const page of advice.pages) {
        expect(page).toBeGreaterThanOrEqual(1);
        expect(page).toBeLessThanOrEqual(113);
      }
      expect(advice.untilMonths ?? Number.POSITIVE_INFINITY).toBeGreaterThan(advice.fromMonths);
    }
  });
});

describe('babyFoodAdviceAt', () => {
  it('keeps meat, fish and egg out until 6 months (p. 21)', () => {
    expect(adviceMentioning(5, 'No meat, fish or egg')).toHaveLength(1);
    expect(adviceMentioning(6, 'No meat, fish or egg')).toHaveLength(0);
    expect(adviceMentioning(6, 'meat or fish every day')).toHaveLength(1);
  });

  it('keeps fried fish out until 9 months (p. 21)', () => {
    expect(adviceMentioning(8, 'fried fish waits')).toHaveLength(1);
    expect(adviceMentioning(9, 'fried fish waits')).toHaveLength(0);
  });

  it('keeps honey out until 1 year (p. 102)', () => {
    expect(adviceMentioning(11, 'honey')).toHaveLength(1);
    expect(adviceMentioning(12, 'honey')).toHaveLength(0);
  });

  it('keeps nitrate-rich vegetables out until 6 months, and to a tenth of the portion until 1 year (p. 105)', () => {
    expect(adviceMentioning(5, 'No spinach')).toHaveLength(1);
    expect(adviceMentioning(6, 'about a tenth')).toHaveLength(1);
    expect(adviceMentioning(11, 'about a tenth')).toHaveLength(1);
    expect(adviceMentioning(12, 'spinach')).toHaveLength(0);
  });

  it('keeps tinned tuna out until 3 years, and tuna steaks until 14 (pp. 94, 100)', () => {
    expect(adviceMentioning(35, 'tinned tuna')).toHaveLength(1);
    expect(adviceMentioning(36, 'tinned tuna')).toHaveLength(0);
    expect(adviceMentioning(36, 'tuna steaks')).toHaveLength(1);
  });

  it('keeps skyr and the other high-protein dairy out until 2 years (p. 106)', () => {
    expect(adviceMentioning(23, 'skyr')).toHaveLength(1);
    expect(adviceMentioning(24, 'skyr')).toHaveLength(0);
  });

  it('cooks extra for its lunch only once it is 1 year (p. 33)', () => {
    expect(adviceMentioning(11, 'cook a little extra')).toHaveLength(0);
    expect(adviceMentioning(12, 'cook a little extra')).toHaveLength(1);
  });
});

describe('babyMealGuidance', () => {
  it('has nothing to say while the baby only drinks milk (p. 7)', () => {
    expect(babyMealGuidance(exampleBirthDate(), new Date('2025-07-01T12:00:00Z'))).toBeUndefined();
  });

  it('says how old the baby is and gives every kind of advice for that age', () => {
    const guidance = babyMealGuidance(exampleBirthDate(), new Date('2025-09-21T06:00:00Z'));

    expect(guidance).toContain('6 months old');
    for (const heading of [
      'How the baby eats now:',
      'Choosing dinners it can share:',
      'Preparing its portion:',
      'What it must not have yet, or only a little of:',
      'Keeping and reheating its food:',
    ]) {
      expect(guidance).toContain(heading);
    }
    expect(guidance).toContain('No honey');
  });

  it('counts a toddler past 2 in years', () => {
    expect(babyMealGuidance(exampleBirthDate(), new Date('2027-10-01T12:00:00Z'))).toContain('2 years old');
  });
});

describe('currentBabyMealGuidance', () => {
  it('has nothing for a household without a baby', () => {
    expect(currentBabyMealGuidance(new Date('2025-09-21T06:00:00Z'), {})).toBeUndefined();
  });

  it('follows the baby as it grows, on every call', () => {
    expect(currentBabyMealGuidance(new Date('2025-09-21T06:00:00Z'), configured)).toContain('6 months old');
    expect(currentBabyMealGuidance(new Date('2025-12-21T07:00:00Z'), configured)).toContain('9 months old');
  });
});
