/**
 * The errors and warnings Mastra reports about itself, kept where something can read them
 * back.
 *
 * Everything Mastra says about its own health goes to a logger and nowhere else: a
 * scheduled run that threw (`scheduler.onError` in `mastra/index.ts`), a workflow run
 * retired at boot (`workflow-run-recovery.ts`), an exception an agent handled and tracked
 * (`printTrackedExceptions` in `logger.ts`). Traces record what a *run* did; none of these
 * is a run, so none of them is in a trace. With a console logger and no telemetry backend
 * attached, the only copy is in the terminal scrollback of whichever machine is hosting —
 * which is to say, unreadable from inside the system that produced it.
 *
 * This is the ring the reflection vertical reads (`verticals/reflection/tools.ts`). It is
 * deliberately small and in-process: no schema, no migration, no retention policy, and it
 * empties on restart. That last part is a limit worth stating rather than hiding — these
 * are the failures of the process that is running now, and the reflection agent says so
 * rather than implying it has the whole history.
 */

/** How many records are kept. Older ones fall off the front as new ones arrive. */
const MAX_RECORDS = 200;

/**
 * How long a single stringified field may be.
 *
 * A stack trace or a serialized agent payload is easily tens of kilobytes, and a ring of
 * two hundred of those is a memory leak wearing a bound. Long enough that the first frames
 * of a stack survive, which is the part that names the failure.
 */
const MAX_FIELD_LENGTH = 2000;

/**
 * How deep {@link truncate} walks before it keeps a value whole.
 *
 * Deep enough for an error's own fields and a `cause` beneath them, which is where
 * `unwrapErrors` in `logger.ts` puts the reason a Mastra failure actually happened.
 */
const MAX_DEPTH = 4;

/** One thing Mastra reported about itself. */
export interface DiagnosticRecord {
  /** When it was reported, ISO-8601. */
  at: string;
  level: 'warn' | 'error';
  /** The logger that reported it — `Mastra`, or an agent, workflow or store's component name. */
  component?: string;
  /** The log message, verbatim. */
  message: string;
  /**
   * The fields logged alongside it, with errors already unwrapped and long values cut.
   * Absent when nothing was logged beside the message.
   */
  details?: Record<string, unknown>;
}

/**
 * The ring itself.
 *
 * Module state rather than a class, for the same reason the storage singletons in
 * `storage/index.ts` are: there is one process and one of these in it, and threading an
 * instance from `createLogger` out to a tool would mean inventing a registry to hold it.
 */
const records: DiagnosticRecord[] = [];

/**
 * Cuts a value down to something a ring can hold.
 *
 * Only strings are truncated, and only their tails: the front of a message or a stack is
 * what identifies the failure, and the marker says plainly that the rest was dropped
 * rather than leaving a sentence that stops mid-word.
 */
function truncate(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    return value.length > MAX_FIELD_LENGTH ? `${value.slice(0, MAX_FIELD_LENGTH)}… (truncated)` : value;
  }

  if (depth >= MAX_DEPTH) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry: unknown) => truncate(entry, depth + 1));
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, truncate(entry, depth + 1)]));
  }

  return value;
}

/**
 * The component name a logger's bindings identify it by.
 *
 * Mastra gives every agent, workflow and store `logger.child({ component })`, while the
 * root logger is named through `name`, so both are read.
 */
function componentOf(bindings?: Record<string, unknown>): string | undefined {
  const component = bindings?.component ?? bindings?.name;
  return typeof component === 'string' ? component : undefined;
}

/**
 * Adds a record, dropping the oldest once the ring is full.
 *
 * Never throws. It is called from inside a logger, and a diagnostics buffer that can break
 * logging is worse than no diagnostics buffer.
 */
export function rememberDiagnostic(
  level: DiagnosticRecord['level'],
  message: string,
  args?: Record<string, unknown>,
  bindings?: Record<string, unknown>,
): void {
  try {
    const details = args && Object.keys(args).length > 0 ? (truncate(args) as Record<string, unknown>) : undefined;

    records.push({
      at: new Date().toISOString(),
      level,
      component: componentOf(bindings),
      message: truncate(message) as string,
      ...(details ? { details } : {}),
    });

    if (records.length > MAX_RECORDS) {
      records.splice(0, records.length - MAX_RECORDS);
    }
  } catch {
    // A record that cannot be built is one record lost, not a failed log line.
  }
}

/**
 * What Mastra has reported about itself, newest first.
 *
 * @param options.level - Keep only records at this level. Omitted, both are returned.
 * @param options.since - Keep only records reported at or after this time.
 * @param options.limit - How many to return at most, counting from the newest.
 */
export function recentDiagnostics(
  options: { level?: DiagnosticRecord['level']; since?: Date; limit?: number } = {},
): DiagnosticRecord[] {
  const sinceIso = options.since?.toISOString();

  const matching = records.filter(
    (record) => (!options.level || record.level === options.level) && (sinceIso === undefined || record.at >= sinceIso),
  );

  // `reverse` mutates, so this has to be the filtered copy rather than `records` itself.
  const newestFirst = matching.reverse();
  return options.limit === undefined ? newestFirst : newestFirst.slice(0, Math.max(options.limit, 0));
}

/** How many records the ring is holding. */
export function diagnosticCount(): number {
  return records.length;
}

/** Empties the ring. For tests, which would otherwise see each other's records. */
export function clearDiagnostics(): void {
  records.length = 0;
}
