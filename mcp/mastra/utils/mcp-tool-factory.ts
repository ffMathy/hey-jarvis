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
 * A workflow published as prose rather than as a JSON object, for when the instruction *is*
 * the answer.
 *
 * Mastra fills `structuredContent` for every tool that declares an `outputSchema`, and the MCP
 * spec then has the same payload repeated as JSON text in `content`. So an instruction written
 * to be read by a voice model arrived twice over, escaped inside
 * `{"instructions":"…","sessionId":"jarvis-voice"}` both times: two copies of a paragraph,
 * wrapped in field names the agent has no use for. The session is the one it is already in — a
 * caller that names none shares the default — and the rest is scaffolding around the one
 * sentence saying what to speak and which tool to call next.
 *
 * Declaring no output schema takes both away. Mastra passes a string straight through as the
 * single text part, so the response is the instruction and nothing else.
 */
export function createInstructionsOnlyWorkflowTool(workflow: AnyWorkflow) {
  const workflowName = workflow.name ?? workflow.id;
  return createTool({
    id: workflowName,
    description: workflow.description ?? '',
    inputSchema: workflow.inputSchema ?? z.object({}),
    // No `outputSchema`, deliberately — see above.
    execute: async (context) => readInstructions(workflowName, await runWorkflowForTool(workflow, context)),
  });
}
