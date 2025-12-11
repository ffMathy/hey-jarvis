/**
 * Type guard to check if a result is a validation error
 * Used across integration tests to identify error responses
 */
export function isValidationError(result: unknown): result is { error: true; message: string } {
  return (
    typeof result === 'object' && result !== null && 'error' in result && (result as { error: boolean }).error === true
  );
}
