import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

/**
 * Test suite to verify Zod V4 compatibility after upgrade
 *
 * These tests ensure that:
 * 1. Zod V4 is properly installed
 * 2. Basic Zod schemas work as expected
 * 3. Schema validation works correctly
 */
describe('Zod V4 Upgrade', () => {
  test('Zod V4 is installed', () => {
    // Check that we're using Zod V4 by verifying the version
    const zodVersion = require('zod/package.json').version;
    expect(zodVersion).toMatch(/^4\./);
  });

  test('Basic schema validation works', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number().optional(),
    });

    const validData = { name: 'Test', age: 25 };
    const result = schema.safeParse(validData);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validData);
    }
  });

  test('Schema with nested objects works', () => {
    const nestedSchema = z.object({
      user: z.object({
        name: z.string(),
        email: z.string(),
      }),
      settings: z
        .object({
          notifications: z.boolean(),
        })
        .optional(),
    });

    const validData = {
      user: { name: 'Test User', email: 'test@example.com' },
      settings: { notifications: true },
    };

    const result = nestedSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  test('Partial schemas work', () => {
    const baseSchema = z.object({
      field1: z.string(),
      field2: z.number(),
      field3: z.boolean(),
    });

    const partialSchema = baseSchema.partial();

    const result = partialSchema.safeParse({ field1: 'test' });
    expect(result.success).toBe(true);
  });

  test('Schema inference works', () => {
    const schema = z.object({
      id: z.string(),
      count: z.number(),
    });

    type SchemaType = z.infer<typeof schema>;

    const data: SchemaType = {
      id: 'test-id',
      count: 42,
    };

    const result = schema.safeParse(data);
    expect(result.success).toBe(true);
  });
});
