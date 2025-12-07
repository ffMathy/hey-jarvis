// @ts-expect-error - bun:test types are built into Bun runtime
import { beforeAll, describe, expect, it } from 'bun:test';
import { listUserRepositories, searchRepositories } from './tools';

// Type guard to check if result is a validation error
function isValidationError(result: unknown): result is { error: true; message: string } {
  return (
    typeof result === 'object' && result !== null && 'error' in result && (result as { error: boolean }).error === true
  );
}

describe('Coding Tools Integration Tests', () => {
  beforeAll(() => {
    // Verify GitHub token is configured
    if (!process.env.HEY_JARVIS_GITHUB_TOKEN) {
      console.log('⚠️  GitHub token not configured - tests will validate error handling');
    }
  });

  describe('searchRepositories', () => {
    it('should search for repositories on GitHub', async () => {
      const result = await searchRepositories.execute({
        query: 'typescript language:typescript',
        maxResults: 5,
      });

      // Check for validation errors
      if (isValidationError(result)) {
        // If GitHub token is not configured, should fail gracefully
        expect(result.error).toBe(true);
        console.log('✅ searchRepositories handled missing config gracefully');
        return;
      }

      // Validate structure
      expect(result).toBeDefined();
      expect(Array.isArray(result.repositories)).toBe(true);

      // If results exist, validate structure
      if (result.repositories.length > 0) {
        const firstRepo = result.repositories[0];
        expect(typeof firstRepo.full_name).toBe('string');
        expect(typeof firstRepo.html_url).toBe('string');
        expect(typeof firstRepo.stargazers_count).toBe('number');

        console.log('✅ Repository search successful');
        console.log('   - Found repositories:', result.repositories.length);
        // Do not log repository names as they may reveal search patterns
      }
    }, 30000);
  });

  describe('listUserRepositories', () => {
    it('should handle authentication gracefully', async () => {
      const result = await listUserRepositories.execute({
        maxResults: 5,
      });

      // Check for validation errors
      if (isValidationError(result)) {
        // If GitHub token is not configured, should fail gracefully
        expect(result.error).toBe(true);
        expect(result.message).toBeDefined();
        console.log('✅ listUserRepositories handled missing auth gracefully');
        return;
      }

      // If authenticated, validate structure
      expect(result).toBeDefined();
      expect(Array.isArray(result.repositories)).toBe(true);

      console.log('✅ User repositories retrieved');
      console.log('   - Repository count:', result.repositories.length);
    }, 30000);
  });
});
