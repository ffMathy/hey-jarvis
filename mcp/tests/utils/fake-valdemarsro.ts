import { spyOn } from 'bun:test';

/**
 * Valdemarsro's recipe API, faked at `fetch` for the length of a spec.
 *
 * The cooking tools, and the meal plan built on them, call Valdemarsro with plain `fetch`, so a
 * spec sees exactly the requests they make without a request leaving the machine. Restore the
 * spy at the end of the spec with `fetchSpy.mockRestore()`.
 */

/** A recipe as Valdemarsro's API returns it, with everything a tool reads filled in. */
export function valdemarsroRecipe(recipeId: number, overrides: { title?: string; directions?: string } = {}) {
  return {
    recipe_id: recipeId,
    title: overrides.title ?? `Opskrift ${recipeId}`,
    description: '<p>Nem aftensmad</p>',
    directions: overrides.directions ?? 'Kog det hele.',
    categories: [{ name: 'Aftensmad' }],
    ingredients: [{ ingrediens: { name: 'løg' }, maengde: '1', enhed: 'stk' }],
    url: `https://www.valdemarsro.dk/${recipeId}`,
    media: `https://www.valdemarsro.dk/${recipeId}.jpg`,
    fields: {},
  };
}

/**
 * A stand-in for `fetch` that hands each request's URL to `handle`, and records its path.
 *
 * Bun's `fetch` carries a `preconnect` function as well as its call signature, so a bare
 * function is not one; the real `preconnect` is carried over to make it whole.
 */
export function fakeValdemarsro(handle: (url: URL) => unknown) {
  const paths: string[] = [];
  const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (input: Parameters<typeof fetch>[0]) => {
        const url = new URL(String(input));
        paths.push(url.pathname);
        return new Response(JSON.stringify(handle(url)));
      },
      { preconnect: globalThis.fetch.preconnect },
    ),
  );

  return { paths, fetchSpy };
}
