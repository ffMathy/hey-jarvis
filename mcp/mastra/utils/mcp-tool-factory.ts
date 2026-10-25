import { z } from 'zod';
import { conversationTracingOptions } from './conversation.js';
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

/** The conversation a tool call says it came from, for a workflow whose input names one. */
function conversationIdOf(inputData: unknown): string | undefined {
  return inputData !== null &&
    typeof inputData === 'object' &&
    'conversationId' in inputData &&
    typeof inputData.conversationId === 'string'
    ? inputData.conversationId
    : undefined;
}

/** Runs a workflow on behalf of a tool call and hands back what it produced. */
async function runWorkflowForTool(workflow: AnyWorkflow, inputData: unknown): Promise<unknown> {
  const workflowName = workflow.name ?? workflow.id;
  console.log(`Executing workflow tool: ${workflowName}`);

  const run = await workflow.createRun();
  const result = await run.start({
    inputData,
    ...conversationTracingOptions(conversationIdOf(inputData)),
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

/**
 * What a workflow produced for the caller: its instruction, and whatever report came with it, less
 * the session the caller is already in.
 */
function readInstructions(workflowName: string, result: unknown): Record<string, unknown> & { instructions: string } {
  const parsed = instructionsResultSchema.safeParse(result);
  if (!parsed.success) {
    throw new Error(`Workflow ${workflowName} returned no instructions`);
  }

  const { sessionId: _sessionId, ...payload } = parsed.data;
  return payload;
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
 * The emptiest text channel MCP allows, which is how the instruction is left to travel in one
 * place only.
 *
 * `content` cannot be dropped: `MCPServer` writes the key on every response, and serializes the
 * whole payload into it whenever the tool supplies nothing — an empty array and an absent key
 * both count as nothing and both produce the copy this is here to avoid. One empty text part is
 * supplied instead, which is the shortest thing that counts as supplied.
 */
const EMPTY_TEXT_CONTENT = [{ type: 'text', text: '' }];

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
 * So the instruction goes in `structuredContent` and nowhere else: a property of an object,
 * stated once, with the text channel left empty rather than repeating it. A client that reads
 * only `content` would find nothing to act on — the one that matters here, ElevenLabs, reads
 * the structured channel, and this is the shape it asked for.
 *
 * Anything else the workflow answered with travels beside the instruction, the session aside.
 * `routePromptWorkflow` answers a request that finished before it returned with the whole closing
 * report, and its results are what that instruction tells Jarvis to say.
 */
export function createInstructionsWorkflowTool(workflow: AnyWorkflow) {
  const workflowName = workflow.name ?? workflow.id;
  return createTool({
    id: workflowName,
    description: workflow.description ?? '',
    inputSchema: workflow.inputSchema ?? z.object({}),
    outputSchema: instructionsResultSchema,
    execute: async (context) => {
      const payload = readInstructions(workflowName, await runWorkflowForTool(workflow, context));

      return {
        ...payload,
        structuredContent: payload,
        content: EMPTY_TEXT_CONTENT,
      };
    },
  });
}
