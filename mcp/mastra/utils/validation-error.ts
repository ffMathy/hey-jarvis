/**
 * Validation error type returned by tools when input validation fails.
 * This is the standard error shape used across all Mastra tools.
 */
export interface ValidationError {
  error: true;
  message: string;
}

/**
 * Type guard to check if a result is a ValidationError.
 * Use this to narrow types when handling tool execution results.
 *
 * @example
 * ```typescript
 * const result = await someTool.execute(input);
 * if (isValidationError(result)) {
 *   console.error('Validation failed:', result.message);
 *   return;
 * }
 * // TypeScript now knows result is not a ValidationError
 * console.log(result.someProperty);
 * ```
 */
export function isValidationError(result: unknown): result is ValidationError {
  return (
    typeof result === 'object' &&
    result !== null &&
    'error' in result &&
    (result as ValidationError).error === true &&
    'message' in result &&
    typeof (result as ValidationError).message === 'string'
  );
}
