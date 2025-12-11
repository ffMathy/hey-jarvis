import { beforeAll, describe, expect, it } from 'bun:test';
import { isValidationError } from '../../utils/test-helpers/validation-error.js';
import { listUserRepositories, searchRepositories } from './tools';

describe('Coding Tools Integration Tests', () => {
  beforeAll(() => {
    // Verify GitHub token is configured
    if (!process.env.HEY_JARVIS_GITHUB_API_TOKEN) {
      throw new Error(
        'GitHub token is required for coding tools tests. Set HEY_JARVIS_GITHUB_API_TOKEN environment variable.',
      );
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
        throw new Error(`Validation failed: ${result.message}`);
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
    it('should list user repositories', async () => {
      const result = await listUserRepositories.execute({
        maxResults: 5,
      });

      // Check for validation errors
      if (isValidationError(result)) {
        throw new Error(`Validation failed: ${result.message}`);
      }

      // Validate structure
      expect(result).toBeDefined();
      expect(Array.isArray(result.repositories)).toBe(true);

      console.log('✅ User repositories retrieved');
      console.log('   - Repository count:', result.repositories.length);
    }, 30000);
  });
});
