/**
 * What a caller on the other end of the MCP connection actually reads.
 *
 * The ElevenLabs agent acts on the response to `routePromptWorkflow` and nothing else, so the
 * envelope around it is not cosmetic. Mastra repeats the payload of any tool that declares an
 * output schema — once as `structuredContent`, once as escaped JSON in `content` — which had a
 * paragraph written for a voice model arriving twice over, wrapped in field names it has no use
 * for. These cover the two shapes on offer, and the absent output schema is the whole mechanism
 * behind the quiet one.
 */

import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { createInstructionsOnlyWorkflowTool, createSimplifiedWorkflowTool } from './mcp-tool-factory.js';
import { executeTool } from './tool-factory.js';
import { createStep, createWorkflow } from './workflows/workflow-factory.js';

const acknowledgementSchema = z.object({
  instructions: z.string(),
  sessionId: z.string(),
});

/** Stands in for `routePromptWorkflow`: an instruction, plus bookkeeping the caller sent in. */
function createAcknowledgingWorkflow() {
  const inputSchema = z.object({ sessionId: z.string() });

  const step = createStep({
    id: 'acknowledge',
    description: 'Answer with an instruction',
    inputSchema,
    outputSchema: acknowledgementSchema,
    execute: async ({ inputData }) => ({
      instructions: 'Say a short line, then call getNextInstructionsWorkflow.',
      sessionId: inputData.sessionId,
    }),
  });

  return createWorkflow({
    id: 'acknowledgingWorkflow',
    description: 'A workflow whose answer is an instruction',
    inputSchema,
    outputSchema: acknowledgementSchema,
  })
    .then(step)
    .commit();
}

describe('createInstructionsOnlyWorkflowTool', () => {
  it('answers with the instruction alone, so nothing has to be unwrapped to find it', async () => {
    const tool = createInstructionsOnlyWorkflowTool(createAcknowledgingWorkflow());

    const result = await executeTool(tool, { sessionId: 'jarvis-voice' });

    expect(result).toBe('Say a short line, then call getNextInstructionsWorkflow.');
  });

  it('declares no output schema, which is what stops the answer being sent twice', async () => {
    // Mastra fills `structuredContent` for a tool that has one and the MCP spec then repeats
    // that payload as JSON text beside it. No schema, no second copy.
    const tool = createInstructionsOnlyWorkflowTool(createAcknowledgingWorkflow());

    expect(tool.outputSchema).toBeUndefined();
  });

  it('fails loudly when a workflow answers with no instruction to pass on', async () => {
    const inputSchema = z.object({});
    const outputSchema = z.object({ somethingElse: z.string() });
    const step = createStep({
      id: 'answer',
      description: 'Answer with something that is not an instruction',
      inputSchema,
      outputSchema,
      execute: async () => ({ somethingElse: 'not an instruction' }),
    });
    const workflow = createWorkflow({ id: 'answeringWorkflow', inputSchema, outputSchema }).then(step).commit();

    expect(executeTool(createInstructionsOnlyWorkflowTool(workflow), {})).rejects.toThrow('returned no instructions');
  });
});

describe('createSimplifiedWorkflowTool', () => {
  it('hands the whole result over, for callers that read more than the instruction', async () => {
    const tool = createSimplifiedWorkflowTool(createAcknowledgingWorkflow());

    const result = await executeTool(tool, { sessionId: 'caller-a' });

    expect(result).toEqual({
      instructions: 'Say a short line, then call getNextInstructionsWorkflow.',
      sessionId: 'caller-a',
    });
  });
});
