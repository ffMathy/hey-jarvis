import { describe, expect, it } from 'bun:test';
import { retryWithBackoff } from '../../../tests/utils/retry-with-backoff.js';
import { findProductInCatalog, getCurrentCartContents } from './tools';

/**
 * These tests exercise live Bilka APIs (Algolia catalog search and the authenticated
 * cart endpoint), which intermittently return transient errors (rate limiting, momentary
 * 5xx/auth hiccups). Wrap each call so a single transient failure retries with backoff
 * instead of failing the whole CI run.
 */
function callWithRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  return retryWithBackoff(fn, {
    maxRetries: 3,
    initialDelay: 1000,
    onRetry: (error, attempt, delayMs) => {
      console.warn(`⚠️ ${label} attempt ${attempt} failed: ${error.message} — retrying in ${delayMs}ms`);
    },
  });
}

describe('Shopping Tools Integration Tests', () => {
  describe('findProductInCatalog', () => {
    it('should search for products in the catalog', async () => {
      const result = await callWithRetry('findProductInCatalog', () =>
        findProductInCatalog.execute({
          search_query: 'mælk',
        }),
      );

      // Validate structure
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);

      // If results exist, validate structure
      if (result.length > 0) {
        const firstProduct = result[0];
        expect(typeof firstProduct.objectID).toBe('string');
        expect(typeof firstProduct.name).toBe('string');
        expect(typeof firstProduct.brand).toBe('string');
        expect(typeof firstProduct.price).toBe('number');
        expect(Array.isArray(firstProduct.attributes)).toBe(true);

        console.log('✅ Product search successful');
        console.log('   - Found products:', result.length);
        console.log('   - First product:', firstProduct.name);
      } else {
        console.log('✅ Product search returned no results (API may not be configured)');
      }
    }, 60000);
  });

  describe('getCurrentCartContents', () => {
    it('should retrieve cart contents', async () => {
      const result = await callWithRetry('getCurrentCartContents', () => getCurrentCartContents.execute({}));

      // Validate structure
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);

      console.log('✅ Cart contents retrieved');
      console.log('   - Items in cart:', result.length);
    }, 60000);
  });
});
