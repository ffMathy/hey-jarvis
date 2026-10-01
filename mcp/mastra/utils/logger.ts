import type { LoggerTransport } from '@mastra/core/logger';
import { PinoLogger } from '@mastra/loggers';
import { rememberDiagnostic } from './diagnostics.js';

/**
 * How deep {@link unwrapErrors} walks a log object before it stops rewriting and hands the
 * value to Pino as-is — any but an error, which is named instead. Deep enough for an error
 * nested in a `details` bag or a two-link `cause` chain, shallow enough that a large payload
 * is not needlessly re-created.
 */
const MAX_DEPTH = 4;

/**
 * What an error's `requestBodyValues` is printed as: everything the failed call sent a model.
 *
 * The AI SDK's `APICallError` — what a model call that failed throws, and what a `RetryError` keeps
 * one of for every attempt, in `errors` and again as `lastError` — carries the whole request body
 * there, enumerably. Mastra logs that error when a model call fails ("Upstream LLM API error", "Error
 * in agent stream"), so describing it field by field would print every agent's full prompt, emails
 * and calendar entries included, and a photo the photo reader was shown as Gemini's
 * `inlineData.data`: hundreds of kilobytes of base64, once per attempt, into a log the add-on keeps
 * on disk, where the privacy policy promises a photo never goes. What is left says which call failed
 * and why — the URL, the status, and what the provider answered, which for Gemini names the failure
 * rather than repeating the request.
 */
export const REQUEST_BODY_LEFT_OUT = '[request body left out]';

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
 *
 * Past {@link MAX_DEPTH} it is named and nothing more. Handed to Pino as it is, an error would print
 * every enumerable field it has — a request body included, see {@link REQUEST_BODY_LEFT_OUT} — and
 * neither its message nor its stack.
 */
function describeError(error: Error, depth: number): Record<string, unknown> {
  const described: Record<string, unknown> = {
    name: error.name,
    message: error.message,
  };

  if (depth > MAX_DEPTH) {
    return described;
  }

  if (error.stack) {
    described.stack = error.stack;
  }

  // Enumerable own properties. A MastraError carries its id, domain, category and details
  // here, and those are the fields that say which error this actually is.
  for (const [key, value] of Object.entries(error)) {
    if (key === 'cause') {
      continue;
    }
    described[key] = key === 'requestBodyValues' ? REQUEST_BODY_LEFT_OUT : unwrapErrors(value, depth + 1);
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
  if (value instanceof Error) {
    return describeError(value, depth);
  }

  if (depth > MAX_DEPTH) {
    return value;
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
 * Makes a logger print the exceptions Mastra hands it, and its children do the same.
 *
 * `trackException` is how Mastra reports an error it has already handled — and
 * `PinoLogger`'s implementation forwards it to the observability adapter and nowhere else,
 * so with no telemetry backend attached the error is simply gone. Nothing prints it.
 *
 * That is not a theoretical gap. Routing delegations are wrapped in a `MastraError` whose
 * message is `[Agent:RoutingSupervisor] - Failed agent tool execution for calendar`, the
 * real failure kept only as its `cause`; the wrapper is tracked and then thrown. A live run
 * failed every delegation it made and the log named the agents without once saying what
 * went wrong, because the only copy of the reason went to an adapter that was not there.
 *
 * The children matter as much as the root. `MastraBase.__setLogger` gives every agent,
 * workflow and storage provider `logger.child({ component })`, and a child is built by
 * Pino's own class — so behaviour added by subclassing the root is exactly what an agent
 * does not get. Patching the instance, and its children as they are made, is what reaches
 * the loggers that actually report these failures.
 *
 * `cause` is what {@link unwrapErrors} was written to follow, so printing the tracked error
 * as an ordinary field is all it takes to get the reason back.
 */
function printTrackedExceptions(logger: PinoLogger): PinoLogger {
  const trackException = logger.trackException.bind(logger);
  const child = logger.child.bind(logger);

  logger.trackException = (error: Error, metadata?: Record<string, unknown>) => {
    logger.error('Tracked exception', { ...metadata, error });
    trackException(error, metadata);
  };
  logger.child = (bindings: Record<string, unknown>) => printTrackedExceptions(child(bindings));

  return logger;
}

/**
 * Keeps a copy of every warning and error the logger is given, so something can read them
 * back later.
 *
 * Printing a failure answers "what went wrong" only for whoever is watching the terminal
 * at the time. Nothing Mastra reports about itself is a run, so none of it is in a trace,
 * and with no telemetry backend attached the console is the only copy — see
 * `utils/diagnostics.ts` for what that cost and what the ring does about it.
 *
 * Applied *around* {@link printTrackedExceptions} in {@link createLogger}, which matters
 * in both directions. Its `trackException` calls `logger.error` on this same object, so a
 * tracked exception is recorded here too; and its `child` is the one this wraps, so a
 * child gets both behaviours rather than whichever patch was applied last.
 *
 * Recording happens before the underlying log call, so a logger that throws on write still
 * leaves the record behind.
 */
function recordDiagnostics(logger: PinoLogger, bindings?: Record<string, unknown>): PinoLogger {
  const error = logger.error.bind(logger);
  const warn = logger.warn.bind(logger);
  const child = logger.child.bind(logger);

  logger.error = (message: string, args?: Record<string, unknown>) => {
    rememberDiagnostic('error', message, unwrapErrors(args) as Record<string, unknown> | undefined, bindings);
    error(message, args);
  };
  logger.warn = (message: string, args?: Record<string, unknown>) => {
    rememberDiagnostic('warn', message, unwrapErrors(args) as Record<string, unknown> | undefined, bindings);
    warn(message, args);
  };
  logger.child = (childBindings: Record<string, unknown>) =>
    recordDiagnostics(child(childBindings), { ...bindings, ...childBindings });

  return logger;
}

/**
 * A logger that prints the errors it is given, keeps the warnings and errors for reading back, and
 * never prints what a failed model call sent.
 *
 * `transports` are where it writes besides the console, as `PinoLogger` takes them; its spec hands
 * it one, to read what is actually written rather than what was meant to be.
 */
export function createLogger(name: string, transports: Record<string, LoggerTransport> = {}): PinoLogger {
  return recordDiagnostics(
    printTrackedExceptions(
      new PinoLogger({
        name,
        level: 'info',
        transports,
        formatters: {
          log: (object: Record<string, unknown>) => unwrapErrors(object) as Record<string, unknown>,
        },
      }),
    ),
    { name },
  );
}

/**
 * Centralized logger for Mastra verticals
 *
 * Uses Pino logger with console transport enabled by default.
 * This logger should be used instead of console.log throughout the codebase
 * to maintain consistent logging and ensure logs are properly tracked.
 */
export const logger = createLogger('Mastra-Verticals');
