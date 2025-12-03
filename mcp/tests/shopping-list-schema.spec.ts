import { describe, expect, test } from 'bun:test';
import { addToShoppingListSchema } from '../mastra/verticals/api/schemas';

describe('Shopping List API Schema Tests', () => {
  describe('addToShoppingListSchema', () => {
    test('should accept valid prompt', () => {
      const result = addToShoppingListSchema.safeParse({ prompt: 'Add 2 liters of milk' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.prompt).toBe('Add 2 liters of milk');
      }
    });

    test('should reject missing prompt', () => {
      const result = addToShoppingListSchema.safeParse({});
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].path).toContain('prompt');
      }
    });

    test('should reject empty prompt', () => {
      const result = addToShoppingListSchema.safeParse({ prompt: '' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toContain('Prompt is required');
      }
    });

    test('should reject prompt with wrong type', () => {
      const result = addToShoppingListSchema.safeParse({ prompt: 123 });
      expect(result.success).toBe(false);
    });

    test('should accept prompt with special characters', () => {
      const result = addToShoppingListSchema.safeParse({
        prompt: 'Tilføj 2 liter mælk og 500g ost med æ, ø, å',
      });
      expect(result.success).toBe(true);
    });

    test('should accept long prompt', () => {
      const longPrompt = 'Add ' + 'milk '.repeat(100);
      const result = addToShoppingListSchema.safeParse({ prompt: longPrompt });
      expect(result.success).toBe(true);
    });
  });
});
