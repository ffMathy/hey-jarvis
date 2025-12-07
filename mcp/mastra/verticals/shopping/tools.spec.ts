// @ts-expect-error - bun:test types are built into Bun runtime
import { beforeAll, describe, expect, it } from 'bun:test';
import { findProductInCatalog, getCurrentCartContents } from './tools';

// Type guard to check if result is a validation error
function isValidationError(result: unknown): result is { error: true; message: string } {
  return (
    typeof result === 'object' && result !== null && 'error' in result && (result as { error: boolean }).error === true
  );
}

describe('Shopping Tools Integration Tests', () => {
  beforeAll(() => {
    // These tools use the Bilka API which may require specific environment setup
    if (!process.env.HEY_JARVIS_BILKA_SESSION) {
      console.log('⚠️  Bilka session not configured - tests will validate error handling');
    }
  });

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
