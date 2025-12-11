import { beforeAll, describe, expect, it } from 'bun:test';
import { isValidationError } from '../../utils/test-helpers/validation-error.js';
import { findProductInCatalog, getCurrentCartContents } from './tools';

describe('Shopping Tools Integration Tests', () => {
  describe('findProductInCatalog', () => {
    it('should search for products in the catalog', async () => {
      const result = await findProductInCatalog.execute({
        search_query: 'mælk',
      });

      // Check for validation errors
      if (isValidationError(result)) {
        throw new Error(`Validation failed: ${result.message}`);
      }

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
    }, 30000);
  });

  describe('getCurrentCartContents', () => {
    it('should retrieve cart contents', async () => {
      const result = await getCurrentCartContents.execute({});

      // Check for validation errors
      if (isValidationError(result)) {
        throw new Error(`Validation failed: ${result.message}`);
      }

      // Validate structure
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);

      console.log('✅ Cart contents retrieved');
      console.log('   - Items in cart:', result.length);
    }, 30000);
  });
});
