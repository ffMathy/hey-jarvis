import { PinoLogger } from '@mastra/loggers';

/**
 * How deep {@link unwrapErrors} walks a log object before it stops rewriting and hands the
 * value to Pino as-is. Deep enough for an error nested in a `details` bag or a two-link
 * `cause` chain, shallow enough that a large payload is not needlessly re-created.
 */
const MAX_DEPTH = 4;

/**
 * Whether a value is a bare object literal — something safe to rebuild key by key.
 *
 * Class instances are deliberately excluded: rewriting one would strip its prototype and
 * change how it prints, and the only instances worth unwrapping are Errors, which are
 * handled before this is ever reached.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Turns an Error into the plain object Pino needs in order to print anything about it.
 */
function describeError(error: Error, depth: number): Record<string, unknown> {
  const described: Record<string, unknown> = {
    name: error.name,
    message: error.message,
  };

  if (error.stack) {
    described.stack = error.stack;
  }

  // Enumerable own properties. A MastraError carries its id, domain, category and details
  // here, and those are the fields that say which error this actually is.
  for (const [key, value] of Object.entries(error)) {
    if (key === 'cause') {
      continue;
    }
    described[key] = unwrapErrors(value, depth + 1);
  }

  if (error.cause !== undefined) {
    described.cause = unwrapErrors(error.cause, depth + 1);
  }

  return described;
}

/**
 * Replaces every Error inside a log object with a printable description of it.
 *
 * Pino serializes a log object with `JSON.stringify`, and `name`, `message` and `stack` are
 * all non-enumerable on an Error — so an error passed as an ordinary field serializes to
 * `{}` and takes its cause to the grave. Mastra logs exactly that way
 * (`logger.error('Failed to restart workflow run', { workflow, runId, error })`), which is
 * how a failed workflow restart reached the console as `error: {}` with nothing left to
 * debug.
 *
 * Exported for the tests that pin this behaviour; production code gets it through
 * {@link createLogger}.
 */
export function unwrapErrors(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) {
    return value;
  }

  if (value instanceof Error) {
    return describeError(value, depth);
  }

  if (Array.isArray(value)) {
    return value.map((entry: unknown) => unwrapErrors(entry, depth + 1));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, unwrapErrors(entry, depth + 1)]));
  }

  return value;
}

/**
 * Creates a Pino logger that prints errors instead of swallowing them.
 *
 * Use this rather than constructing `PinoLogger` directly, so that every logger in the
 * process — including the one handed to Mastra itself, which is what reports workflow and
 * scheduler failures — shares the same error handling.
 */
export function createLogger(name: string): PinoLogger {
  return new PinoLogger({
    name,
    level: 'info',
    formatters: {
      log: (object: Record<string, unknown>) => unwrapErrors(object) as Record<string, unknown>,
    },
  });
}

/**
 * Centralized logger for Mastra verticals
 *
 * Uses Pino logger with console transport enabled by default.
 * This logger should be used instead of console.log throughout the codebase
 * to maintain consistent logging and ensure logs are properly tracked.
 */
export const logger = createLogger('Mastra-Verticals');
