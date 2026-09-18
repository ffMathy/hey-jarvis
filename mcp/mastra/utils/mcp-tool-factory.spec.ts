/**
 * What a caller on the other end of the MCP connection actually reads.
 *
 * The ElevenLabs agent acts on the response to `routePromptWorkflow` and nothing else, so the
 * envelope around it is not cosmetic. Mastra repeats the payload of any tool that declares an
 * output schema — once as `structuredContent`, once as escaped JSON in `content` — which had a
 * paragraph written for a voice model arriving twice over, wrapped in field names it has no use
 * for. These cover the two shapes on offer, and the supplied `content` is the whole mechanism
 * behind the quiet one.
 */

import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { createInstructionsWorkflowTool, createSimplifiedWorkflowTool } from './mcp-tool-factory.js';
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

describe('createInstructionsWorkflowTool', () => {
  it('keeps the instruction a property of an object, for the client that reads structurally', async () => {
    const tool = createInstructionsWorkflowTool(createAcknowledgingWorkflow());

    const result = await executeTool(tool, { sessionId: 'jarvis-voice' });

    expect(result.structuredContent).toEqual({
      instructions: 'Say a short line, then call getNextInstructionsWorkflow.',
    });
  });

  it('writes the text channel itself, so the payload is not spelled out a second time', async () => {
    // MCPServer serializes the whole payload into `content` when a tool supplies none, which
    // is how one instruction became two copies. Supplying it is the whole mechanism.
    const tool = createInstructionsWorkflowTool(createAcknowledgingWorkflow());

    const result = await executeTool(tool, { sessionId: 'jarvis-voice' });

    expect(result.content).toEqual([
      { type: 'text', text: 'Say a short line, then call getNextInstructionsWorkflow.' },
    ]);
  });

  it('leaves the session out, since the caller is already in it', async () => {
    const tool = createInstructionsWorkflowTool(createAcknowledgingWorkflow());

    const result = await executeTool(tool, { sessionId: 'jarvis-voice' });

    expect(result.structuredContent).not.toHaveProperty('sessionId');
  });

  it('repeats the instruction at the top level, where Mastra validates it', async () => {
    // Mastra checks the *whole* returned value against the output schema before MCP ever sees
    // it, so a value carrying only the two channels is rejected — the first attempt at this
    // tool died exactly there, handing the agent a validation error in place of instructions.
    // `executeTool` throws on that error, so getting an answer back at all is half the proof.
    const tool = createInstructionsWorkflowTool(createAcknowledgingWorkflow());

    const result = await executeTool(tool, { sessionId: 'jarvis-voice' });

    expect(result.instructions).toBe('Say a short line, then call getNextInstructionsWorkflow.');
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

    expect(executeTool(createInstructionsWorkflowTool(workflow), {})).rejects.toThrow('returned no instructions');
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
