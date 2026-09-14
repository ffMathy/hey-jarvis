import { describe, expect, it } from 'bun:test';
import {
  extractPreferenceKeywords,
  type RecipeCatalogEntry,
  resolveSelectedRecipeIds,
  shortlistRecipeCandidates,
  toPlainTextSummary,
} from './recipe-catalog';

function entry(overrides: Partial<RecipeCatalogEntry> & { id: number }): RecipeCatalogEntry {
  return {
    title: `Ret ${overrides.id}`,
    categories: ['Aftensmad'],
    summary: '',
    ...overrides,
  };
}

function entries(count: number, overrides: (id: number) => Partial<RecipeCatalogEntry> = () => ({})) {
  return Array.from({ length: count }, (_, index) => entry({ id: index + 1, ...overrides(index + 1) }));
}

/** A `random` that always picks the last remaining item, so shuffling is a reversal. */
const reverseShuffle = () => 0.999999;

describe('toPlainTextSummary', () => {
  it('returns an empty string when there is no description', () => {
    expect(toPlainTextSummary(undefined)).toBe('');
  });

  it('strips markup and collapses whitespace', () => {
    expect(toPlainTextSummary('<p>Lækker  <strong>gryderet</strong>\n med kylling</p>')).toBe(
      'Lækker gryderet med kylling',
    );
  });

  it('decodes the entities the API escapes', () => {
    expect(toPlainTextSummary('Ris &amp; b&#39;nner &quot;nemt&quot;')).toBe(`Ris & b'nner "nemt"`);
  });

  it('keeps a summary that already fits untouched', () => {
    expect(toPlainTextSummary('Kort tekst', 20)).toBe('Kort tekst');
  });

  it('truncates on a word boundary and marks the cut', () => {
    expect(toPlainTextSummary('kylling i fad med kartofler og salat', 20)).toBe('kylling i fad med…');
  });

  it('truncates mid-word rather than losing most of the text', () => {
    expect(toPlainTextSummary('supercalifragilisticexpialidocious', 10)).toBe('supercali…');
  });

  it('never exceeds the requested length', () => {
    const long = 'meget lang beskrivelse '.repeat(50);

    for (const maxLength of [10, 40, 160]) {
      expect(toPlainTextSummary(long, maxLength).length).toBeLessThanOrEqual(maxLength);
    }
  });
});

describe('extractPreferenceKeywords', () => {
  it('has nothing to match on without preferences', () => {
    expect(extractPreferenceKeywords(undefined)).toEqual([]);
    expect(extractPreferenceKeywords('')).toEqual([]);
  });

  it('drops filler words and keeps the ones that describe food', () => {
    expect(extractPreferenceKeywords('Byt ret 1 ud med noget med kylling')).toEqual(['kylling']);
  });

  it('keeps Danish letters intact', () => {
    expect(extractPreferenceKeywords('gerne grøntsager og ærter')).toEqual(['grøntsager', 'ærter']);
  });

  it('deduplicates repeated words', () => {
    expect(extractPreferenceKeywords('kylling, kylling og mere KYLLING')).toEqual(['kylling', 'mere']);
  });
});

describe('shortlistRecipeCandidates', () => {
  it('returns nothing for an empty catalogue', () => {
    expect(shortlistRecipeCandidates([])).toEqual([]);
  });

  it('caps the shortlist at the limit', () => {
    expect(shortlistRecipeCandidates(entries(500), { limit: 120 })).toHaveLength(120);
  });

  it('keeps the whole catalogue when it already fits', () => {
    const catalogue = entries(5);

    expect(
      shortlistRecipeCandidates(catalogue, { limit: 120 })
        .map((e) => e.id)
        .sort(),
    ).toEqual([1, 2, 3, 4, 5]);
  });

  it('only shortlists dinner recipes when there are any', () => {
    const catalogue = [
      entry({ id: 1, categories: ['Morgenmad'] }),
      entry({ id: 2, categories: ['Aftensmad'] }),
      entry({ id: 3, categories: ['Kage'] }),
      entry({ id: 4, categories: ['Hovedret'] }),
    ];

    expect(
      shortlistRecipeCandidates(catalogue, { random: reverseShuffle })
        .map((e) => e.id)
        .sort(),
    ).toEqual([2, 4]);
  });

  it('falls back to the whole catalogue when nothing is marked as dinner', () => {
    const catalogue = entries(3, () => ({ categories: ['Kage'] }));

    expect(
      shortlistRecipeCandidates(catalogue)
        .map((e) => e.id)
        .sort(),
    ).toEqual([1, 2, 3]);
  });

  it('puts recipes matching the preferences first', () => {
    const catalogue = [
      ...entries(50, (id) => ({ title: `Frikadeller ${id}` })),
      entry({ id: 99, title: 'Kylling i karry' }),
    ];

    const shortlist = shortlistRecipeCandidates(catalogue, {
      preferences: 'Byt retten ud med noget med kylling',
      limit: 3,
      random: reverseShuffle,
    });

    expect(shortlist[0].id).toBe(99);
    expect(shortlist).toHaveLength(3);
  });

  it('matches preferences against categories and summaries too', () => {
    const catalogue = [
      entry({ id: 1, title: 'Pasta bolognese' }),
      entry({ id: 2, title: 'Ovnret', summary: 'Med masser af kylling' }),
      entry({ id: 3, title: 'Wok', categories: ['Aftensmad', 'Kylling'] }),
    ];

    const shortlist = shortlistRecipeCandidates(catalogue, {
      preferences: 'noget med kylling',
      limit: 2,
      random: reverseShuffle,
    });

    expect(shortlist.map((e) => e.id).sort()).toEqual([2, 3]);
  });

  it('still fills the shortlist when nothing matches the preferences', () => {
    const shortlist = shortlistRecipeCandidates(entries(10), {
      preferences: 'noget med struds',
      limit: 4,
    });

    expect(shortlist).toHaveLength(4);
  });

  it('varies the shortlist between runs so two weeks differ', () => {
    const catalogue = entries(200);
    const first = shortlistRecipeCandidates(catalogue, { limit: 10 }).map((e) => e.id);
    const second = shortlistRecipeCandidates(catalogue, { limit: 10 }).map((e) => e.id);

    expect(first).not.toEqual(second);
  });

  it('never returns the same recipe twice', () => {
    const shortlist = shortlistRecipeCandidates(entries(300), {
      preferences: 'kylling og pasta',
      limit: 120,
    });

    expect(new Set(shortlist.map((e) => e.id)).size).toBe(shortlist.length);
  });
});

describe('resolveSelectedRecipeIds', () => {
  it('keeps a clean selection as it is', () => {
    expect(resolveSelectedRecipeIds([2, 5], [1, 2, 3, 4, 5], 2)).toEqual([2, 5]);
  });

  it('drops ids that were never on the shortlist', () => {
    expect(resolveSelectedRecipeIds([999, 3], [1, 2, 3], 2)).toEqual([3, 1]);
  });

  it('drops duplicates instead of planning the same dish twice', () => {
    expect(resolveSelectedRecipeIds([3, 3], [1, 2, 3], 2)).toEqual([3, 1]);
  });

  it('tops the selection up when the agent returned too few', () => {
    expect(resolveSelectedRecipeIds([], [7, 8, 9], 2)).toEqual([7, 8]);
  });

  it('trims the selection when the agent returned too many', () => {
    expect(resolveSelectedRecipeIds([1, 2, 3, 4], [1, 2, 3, 4], 2)).toEqual([1, 2]);
  });

  it('trusts the selection when there is no shortlist to check against', () => {
    expect(resolveSelectedRecipeIds([42, 43], [], 2)).toEqual([42, 43]);
  });

  it('returns what it can when the shortlist is shorter than the plan needs', () => {
    expect(resolveSelectedRecipeIds([], [1], 2)).toEqual([1]);
    expect(resolveSelectedRecipeIds([], [], 2)).toEqual([]);
  });
});
