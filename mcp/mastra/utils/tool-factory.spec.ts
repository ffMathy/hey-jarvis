import { describe, expect, it } from 'bun:test';
import type { ToolExecuteContext, ToolExecutionContext } from '@mastra/core/tools';
import { createToolExecutionContext, executeTool } from './tool-factory.js';

describe('createToolExecutionContext', () => {
  it('supplies the observability and request-context values the runtime requires', () => {
    const context = createToolExecutionContext();

    expect(context.observe).toBeDefined();
    expect(typeof context.observe.span).toBe('function');
    expect(typeof context.observe.log).toBe('function');
    expect(context.requestContext).toBeDefined();
  });

  it('keeps caller-supplied values', () => {
    const abortSignal = AbortSignal.timeout(1000);
    const context = createToolExecutionContext({ abortSignal });

    expect(context.abortSignal).toBe(abortSignal);
    expect(context.observe).toBeDefined();
  });
});

describe('executeTool', () => {
  it('returns the tool output', async () => {
    const tool = {
      id: 'succeeds',
      execute: async (inputData: { value: number }) => ({ doubled: inputData.value * 2 }),
    };

    expect(await executeTool(tool, { value: 21 })).toEqual({ doubled: 42 });
  });

  it('hands the tool a context carrying observe and requestContext', async () => {
    let seen: ToolExecuteContext<ToolExecutionContext> | undefined;
    const tool = {
      id: 'inspects-context',
      execute: async (_inputData: Record<string, never>, context: ToolExecuteContext<ToolExecutionContext>) => {
        seen = context;
        return { ok: true };
      },
    };

    await executeTool(tool, {});

    expect(seen?.observe).toBeDefined();
    expect(seen?.requestContext).toBeDefined();
  });

  it('throws when the tool has no execute function', async () => {
    await expect(executeTool({ id: 'no-execute' }, {})).rejects.toThrow('no execute function');
  });

  it('throws when the tool reports a validation error', async () => {
    const tool = {
      id: 'invalid',
      execute: async () => ({
        error: true as const,
        message: 'bad input',
        validationErrors: { errors: ['bad input'], fields: {} },
      }),
    };

    await expect(executeTool(tool, {})).rejects.toThrow('Tool invalid failed validation: bad input');
  });

  it('throws when the tool returns nothing', async () => {
    const tool = { id: 'returns-nothing', execute: async () => undefined };

    await expect(executeTool(tool, {})).rejects.toThrow('Tool returns-nothing returned no result');
  });

  it('passes through a null result, which a nullable output schema allows', async () => {
    const tool = { id: 'returns-null', execute: async () => null };

    expect(await executeTool(tool, {})).toBeNull();
  });
});
