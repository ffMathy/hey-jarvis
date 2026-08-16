/**
 * State Change data type
 *
 * A state change is any observable event a vertical reports to Synapse — a
 * weather update, an IoT device flipping state, a new email, and so on.
 */
export interface StateChange {
  source: string;
  stateType: string;
  stateData: Record<string, unknown>;
}

/** Values longer than this are truncated when describing a state change. */
const MAXIMUM_VALUE_LENGTH = 120;

/** Nested objects are flattened no deeper than this. */
const MAXIMUM_FLATTEN_DEPTH = 2;

function describeValue(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);

  if (text === undefined) {
    return 'unknown';
  }

  return text.length > MAXIMUM_VALUE_LENGTH ? `${text.slice(0, MAXIMUM_VALUE_LENGTH)}…` : text;
}

/** Turns `snake_case` identifiers into plain words, which embed far better. */
function humanize(text: string): string {
  return text.replace(/_/g, ' ');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Flattens a state payload into `key is value` fragments, descending into nested
 * objects up to {@link MAXIMUM_FLATTEN_DEPTH} so that keys stay meaningful
 * without the description turning into a wall of JSON.
 */
function flatten(data: Record<string, unknown>, prefix = '', depth = 0): string[] {
  return Object.entries(data).flatMap(([key, value]) => {
    const path = prefix ? `${prefix} ${key}` : key;

    if (isPlainObject(value) && depth < MAXIMUM_FLATTEN_DEPTH) {
      return flatten(value, path, depth + 1);
    }

    return [`${humanize(path)} is ${describeValue(value)}`];
  });
}

/**
 * Renders a state change as a natural-language sentence.
 *
 * The result is what gets embedded and compared against subscriptions, so it
 * deliberately reads like prose rather than JSON — static embeddings are a
 * bag-of-token average, and punctuation-heavy JSON dilutes the signal from the
 * words that actually carry meaning.
 *
 * @example
 * ```typescript
 * describeStateChange({
 *   source: 'weather',
 *   stateType: 'sun_position_changed',
 *   stateData: { event: 'sunset', temperature: 12 },
 * });
 * // "weather sun position changed: event is sunset, temperature is 12"
 * ```
 */
export function describeStateChange(change: StateChange): string {
  const heading = humanize(`${change.source} ${change.stateType}`);
  const details = flatten(change.stateData);

  return details.length > 0 ? `${heading}: ${details.join(', ')}` : heading;
}
