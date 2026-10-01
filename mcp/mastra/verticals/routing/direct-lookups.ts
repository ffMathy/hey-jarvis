import type { DirectLookup } from '../../utils/direct-lookup-factory.js';
import { calendarLookups } from '../calendar/lookups.js';
import { codingLookups } from '../coding/lookups.js';
import { emailLookups } from '../email/lookups.js';
import { shoppingLookups } from '../shopping/lookups.js';
import { todoListLookups } from '../todo-list/lookups.js';
import { weatherLookups } from '../weather/lookups.js';

/**
 * Every lookup routing can answer a request with directly, from every vertical that has some.
 *
 * Gathered here rather than in each agent, because routing is what chooses one: it is offered to
 * Jev only for a request routed to the lookup's own agent (see `classifier.ts`).
 */
export const DIRECT_LOOKUPS: readonly DirectLookup[] = [
  ...weatherLookups,
  ...calendarLookups,
  ...todoListLookups,
  ...shoppingLookups,
  ...emailLookups,
  ...codingLookups,
];

/** A lookup by its id, or `undefined` when there is none by that name. */
export function findDirectLookup(id: string): DirectLookup | undefined {
  return DIRECT_LOOKUPS.find((lookup) => lookup.id === id);
}
