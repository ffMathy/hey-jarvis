import { z } from 'zod';
import { createTool } from './tool-factory.js';
import type { AnyWorkflow } from './workflows/workflow-factory.js';

/**
 * Workflows as the MCP server publishes them.
 *
 * A workflow's own schemas are written for the code that runs it. What a caller on the other
 * end of the MCP connection reads is a different question, and for the ElevenLabs voice agent
 * it is the only thing standing between the request and what Jarvis says next — so the shape
 * of the response is decided here rather than falling out of the workflow's output schema.
 */

/** Runs a workflow on behalf of a tool call and hands back what it produced. */
async function runWorkflowForTool(workflow: AnyWorkflow, inputData: unknown): Promise<unknown> {
  const workflowName = workflow.name ?? workflow.id;
  console.log(`Executing workflow tool: ${workflowName}`);

  const run = await workflow.createRun();
  const result = await run.start({
    inputData,
  });
  if (result.status !== 'success') {
    const errorMessage =
      'error' in result && result.error instanceof Error
        ? result.error.message
        : `Workflow failed with status ${result.status}`;
    throw new Error(`Workflow ${workflowName} failed: ${errorMessage}`);
  }

  return result.result;
}

/** A workflow published as a tool, answering with whatever its output schema describes. */
export function createSimplifiedWorkflowTool(workflow: AnyWorkflow) {
  const workflowName = workflow.name ?? workflow.id;
  return createTool({
    id: workflowName,
    description: workflow.description ?? '',
    inputSchema: workflow.inputSchema ?? z.object({}),
    outputSchema: workflow.outputSchema ?? z.unknown(),
    execute: async (context) => runWorkflowForTool(workflow, context),
  });
}

/** The instruction a workflow produced, which for some of them is the whole answer. */
function readInstructions(workflowName: string, result: unknown): string {
  if (
    result !== null &&
    typeof result === 'object' &&
    'instructions' in result &&
    typeof result.instructions === 'string'
  ) {
    return result.instructions;
  }

  throw new Error(`Workflow ${workflowName} returned no instructions`);
}

/**
 * What an instruction-answering tool returns: the instruction, and the two MCP channels it is
 * published through.
 *
 * The shape is dictated by where the schema is enforced. Mastra's tool wrapper validates the
 * *whole* returned value, so `instructions` has to sit at the top level — a value carrying only
 * the channels is rejected outright, with the error going to the agent in place of the
 * instruction. And the schema has to be loose, because a strict object would quietly strip the
 * two channel keys as unknown before `MCPServer` ever got to read them.
 */
const instructionsResultSchema = z.looseObject({
  instructions: z.string().describe('Instructions for Jarvis to follow'),
});

/**
 * A workflow published with a response written for the agent reading it, for when the
 * instruction *is* the answer.
 *
 * Mastra fills `structuredContent` for every tool that declares an `outputSchema`, and then
 * fills `content` with that same payload serialized — so an instruction written to be read by a
 * voice model arrived twice over, the second time escaped inside
 * `{"instructions":"…","sessionId":"jarvis-voice"}`. The session is the one the caller is
 * already in (a caller that names none shares the default), and the escaping is scaffolding
 * around the one sentence saying what to speak and which tool to call next.
 *
 * `MCPServer` only writes `content` itself when the tool supplied none, so supplying it is what
 * keeps the second copy from being the whole payload spelled out again. The instruction stays a
 * property of an object in `structuredContent`, which is the channel a client reads
 * structurally; `content` carries the same sentence as prose for the one that reads text. One
 * copy each, and nothing either of them has no use for.
 */
export function createInstructionsWorkflowTool(workflow: AnyWorkflow) {
  const workflowName = workflow.name ?? workflow.id;
  return createTool({
    id: workflowName,
    description: workflow.description ?? '',
    inputSchema: workflow.inputSchema ?? z.object({}),
    outputSchema: instructionsResultSchema,
    execute: async (context) => {
      const instructions = readInstructions(workflowName, await runWorkflowForTool(workflow, context));
      const payload = { instructions };

      return {
        ...payload,
        structuredContent: payload,
        content: [{ type: 'text', text: instructions }],
      };
    },
  });
}
