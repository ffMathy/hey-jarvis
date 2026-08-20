/**
 * Reads the human-readable message out of whatever ended up in an error slot.
 *
 * The parameter is `unknown` because Mastra's declared type is not what turns up at
 * runtime: the engine serialises the error with `Error.prototype.toJSON` before
 * returning a workflow result, so a failed run carries a plain `{ message, name }`
 * object rather than an `Error`. Runs that never reached the engine still carry a real
 * `Error`, and a message that came back over the wire can be a bare string.
 *
 * Lives in `utils` rather than in one vertical because both the API layer and the email
 * reply handler read errors that have been through that serialisation.
 *
 * @returns The message, or `undefined` when there is no detail to report.
 */
export function extractErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.message || undefined;
  }

  if (typeof error === 'string') {
    return error || undefined;
  }

  if (typeof error === 'object' && error !== null && 'message' in error) {
    const { message } = error;
    if (typeof message === 'string' && message !== '') {
      return message;
    }
  }

  return undefined;
}
